import { useEffect, useMemo, useRef, useState } from 'react';
import { Upload, ClipboardPaste, RotateCcw, Smartphone, CircleAlert, AlertTriangle, Info, Search, Play, Braces, Check, ListChecks, Image as ImageIcon, CornerDownLeft, List, Undo2, Redo2, Download, Pencil, Eye, Copy } from 'lucide-react';
import api from '../../api/client.js';
import { PageHeader, Card, Pill, Kpi, inr } from '../../civic/kit.jsx';
import { Button, Alert, Modal, Textarea, Select, Field, Input, loadError } from '../../civic/ui.jsx';
import { parseFlow, resolve, matchKeyword, optionsOf, waTokens } from '../../sim/flowModel.js';
import { RULE_SETS } from '../../sim/backendRules.js';
import * as FE from '../../sim/flowEdit.js';
import NodeEditor from '../../sim/NodeEditor.jsx';
import '../../sim/phone.css';

// Flow Simulator (first piece of the Flow Builder). Loads a WACTO export and
// plays it back exactly as WhatsApp shows it: list messages open the bottom
// sheet, reply buttons sit under the bubble, media nodes show the image with
// its caption. Taps follow the edges (one destination per title, as WACTO
// does); optionally our backend's replies are shown too, with the wording
// saved in Bot Messages & Media. Checks mirror verify_flow / route_check.

const SIM = { name: 'Sim Kumar', mobile: '9000000003', passcode: '482913' };
const stamp = () => new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
let seq = 0; const mid = () => `m${++seq}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (id) => (id === 'root' ? 'root' : String(id || '').slice(0, 8));

function linkify(text, key) {
  const parts = String(text).split(/(https?:\/\/[^\s]+)/g);
  return parts.map((p, i) => (/^https?:\/\//.test(p) ? <a key={`${key}-${i}`} href={p} target="_blank" rel="noreferrer">{p}</a> : p));
}
function Rich({ text }) {
  return <span className="wa-text">{waTokens(text).map((t, i) => (t.t === 'br' ? <br key={i} /> : t.t === 'b' ? <strong key={i}>{t.v}</strong> : t.t === 'i' ? <em key={i}>{t.v}</em> : t.t === 'code' ? <code key={i}>{t.v}</code> : <span key={i}>{linkify(t.v, i)}</span>))}</span>;
}

export default function FlowSimulator() {
  const [flows, setFlows] = useState([]);
  const [flowName, setFlowName] = useState('');
  const [flow, setFlow] = useState(null);
  const [err, setErr] = useState('');
  const [loadIssues, setLoadIssues] = useState([]); // server parts that didn't load (not deployed, offline…)
  const [paste, setPaste] = useState(null);
  const [chat, setChat] = useState([]);
  const [typing, setTyping] = useState(false);
  const [cur, setCur] = useState(null);     // last WACTO node shown
  const [sel, setSel] = useState(null);     // node in the inspector
  const [sheet, setSheet] = useState(null); // message id whose list is open
  const [pick, setPick] = useState(null);   // { title, description }
  const [typed, setTyped] = useState('');
  const [rulesId, setRulesId] = useState('edms');
  const [showBackend, setShowBackend] = useState(true);
  const [content, setContent] = useState({ texts: {}, images: {} });
  const [pay, setPay] = useState(null);
  const [q, setQ] = useState('');
  const [raw, setRaw] = useState(false);
  const [checkLevel, setCheckLevel] = useState('all');
  const ctx = useRef({ lang: 'en', registered: false, flow: null, ...SIM });
  const chatEl = useRef(null);
  const fileRef = useRef(null);
  const flowRef = useRef(null);   // the loaded model, readable from async handlers
  const booted = useRef(false);
  // ── editing ──
  const [mode, setMode] = useState('inspect');
  const [dirty, setDirty] = useState(false);
  const [histN, setHistN] = useState({ past: 0, future: 0 });
  const hist = useRef({ past: [], future: [], lastKey: null, lastAt: 0 });
  const [exp, setExp] = useState(null); // { name, result?, clashes?, errors?, busy, ack }
  const savedIds = useRef(null);

  const rules = RULE_SETS.find((r) => r.id === rulesId) || null;

  useEffect(() => {
    if (booted.current) return; // React StrictMode runs effects twice in dev
    booted.current = true;
    api.get('/flow-sim/flows').then(({ data }) => { setFlows(data.flows || []); const last = (() => { try { return localStorage.getItem('edm_sim_flow'); } catch { return ''; } })(); const first = (data.flows || []).find((f) => f.name === last) || (data.flows || [])[0]; if (first) loadServerFlow(first.name); }).catch((e) => setLoadIssues((l) => [...l, loadError(e, 'the saved flows')]));
    api.get('/flow-images/bot').then(({ data }) => setContent({ texts: Object.fromEntries((data.texts || []).map((t) => [t.key, { en: t.en, ta: t.ta }])), images: Object.fromEntries((data.images || []).map((i) => [i.key, i.url])) })).catch((e) => setLoadIssues((l) => [...l, `${loadError(e, "the bot's own replies")} The chat shows the flow's text only.`]));
    api.get('/payments/settings').then(({ data }) => setPay(data.settings || null)).catch((e) => setLoadIssues((l) => [...l, loadError(e, 'the payment settings')]));
  }, []);
  useEffect(() => { chatEl.current?.scrollTo({ top: chatEl.current.scrollHeight, behavior: 'smooth' }); }, [chat, typing]);

  const loadModel = (rawText, name) => {
    try {
      const m = parseFlow(rawText);
      flowRef.current = m;
      hist.current = { past: [], future: [], lastKey: null, lastAt: 0 }; setHistN({ past: 0, future: 0 }); setDirty(false);
      setFlow(m); setFlowName(name); setErr(''); setSel(m.rootId);
      try { localStorage.setItem('edm_sim_flow', name); } catch { /* ignore */ }
      restart(m);
    } catch (e) { setErr(e.message); }
  };
  const loadServerFlow = (name) => { if (!name) return; api.get(`/flow-sim/flows/${encodeURIComponent(name)}`, { transformResponse: [(d) => d] }).then(({ data }) => loadModel(data, name)).catch((e) => setErr(e.response?.data?.message || 'Could not load that flow.')); };
  const onFile = async (e) => { const f = e.target.files?.[0]; if (!f) return; loadModel(await f.text(), f.name); e.target.value = ''; };

  // ── editing: every change clones the doc, records undo history, rebuilds the model ──
  const applyDoc = (doc) => { const m = parseFlow(doc); flowRef.current = m; setFlow(m); setDirty(true); setHistN({ past: hist.current.past.length, future: hist.current.future.length }); };
  const commit = (key, fn) => {
    const m0 = flowRef.current; if (!m0) return null;
    const next = FE.clone(m0.doc);
    const ret = fn(next, FE);
    const h = hist.current; const now = Date.now();
    if (!(h.lastKey === key && now - h.lastAt < 1500)) h.past.push(m0.doc);
    if (h.past.length > 80) h.past.shift();
    h.future = []; h.lastKey = key; h.lastAt = now;
    applyDoc(next);
    return ret;
  };
  const undo = () => { const h = hist.current; const prev = h.past.pop(); if (!prev) return; h.future.push(flowRef.current.doc); h.lastKey = null; applyDoc(prev); };
  const redo = () => { const h = hist.current; const nx = h.future.pop(); if (!nx) return; h.past.push(flowRef.current.doc); h.lastKey = null; applyDoc(nx); };
  const addNode = (kind, { name, fromTitle } = {}) => { const id = commit('add', (doc, E) => { const nid = E.addNode(doc, kind, { name, nearId: sel }); if (fromTitle && sel) E.setDestination(doc, sel, fromTitle, nid); return nid; }); if (id) { setSel(id); setMode('edit'); } };
  const duplicateNode = () => { const id = commit('dup', (doc, E) => E.duplicateNode(doc, sel)); if (id) setSel(id); };
  const deleteNode = () => { const rootId = flowRef.current?.rootId; commit('del', (doc, E) => E.deleteNode(doc, sel)); setSel(rootId); };

  // ── export with fresh ids (reid_flow.py in the browser) + clash check against saved exports ──
  const suggestName = () => { const n = flowRef.current?.name || 'Flow'; const m = /^(.*?v)(\d+)(.*)$/i.exec(n); return m ? `${m[1]}${Number(m[2]) + 1}${m[3]}` : `${n} edited`; };
  const openExport = () => setExp({ name: suggestName(), busy: false, ack: false });
  const prepareExport = async () => {
    const m = flowRef.current; if (!m) return;
    setExp((x) => ({ ...x, busy: true }));
    const result = FE.reidExport(m.doc, exp.name.trim() || m.name);
    const errors = parseFlow(result.out).checks.filter((c) => c.level === 'error');
    if (!savedIds.current) {
      const ids = new Set();
      for (const f of flows) { try { const { data } = await api.get(`/flow-sim/flows/${encodeURIComponent(f.name)}`, { transformResponse: [(d) => d] }); for (const id of FE.collectIds(JSON.parse(data))) ids.add(id); } catch { /* skip */ } }
      savedIds.current = ids;
    }
    const clashes = [...result.newIds].filter((id) => savedIds.current.has(id));
    setExp((x) => ({ ...x, busy: false, result, errors, clashes, checked: flows.length }));
  };
  const downloadExport = () => {
    const text = JSON.stringify(exp.result.out, null, 2);
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = `${exp.name.trim().replace(/[^\w.()-]+/g, '_') || 'flow'}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  // ── chat helpers ──────────────────────────────────────────────────────────
  const push = (m) => setChat((c) => [...c, { id: mid(), time: stamp(), ...m }]);
  const sys = (text, level = '') => push({ from: 'sys', body: text, level });
  const botText = (key, vars = {}) => {
    const t = content.texts[key]; if (!t) return `[${key}]`;
    const tpl = ctx.current.lang === 'ta' ? (t.ta || t.en) : t.en;
    const all = { ...SIM, ...vars };
    return String(tpl).replace(/\{(\w+)\}/g, (m, k) => (all[k] === undefined || all[k] === null ? m : String(all[k])));
  };
  const payVars = (pv = {}) => {
    const n = Math.max(1, Number(pv.booths) || 1);
    const tiers = pay?.tiers || [{ max_booths: 1, base: 2000 }, { max_booths: 5, base: 5000 }, { max_booths: 10, base: 10000 }, { max_booths: 25, base: 25000 }, { max_booths: 100, base: 50000 }];
    const tier = tiers.find((t) => n <= t.max_booths) || tiers[tiers.length - 1];
    const gst = Math.round(tier.base * (pay?.gst_rate ?? 18) / 100);
    const num = pay?.proof_number || '917092800426';
    return { title: botText(pv.title || 'pay_qr_title', pv.titleVars || {}) + (pv.titleExtra ? `\n\n${botText(pv.titleExtra)}` : ''), assembly_line: pv.assembly ? botText('pay_qr_assembly_line', { assembly: pv.assembly }) : '', booths: n, base: inr(tier.base), gst_rate: pay?.gst_rate ?? 18, total: inr(tier.base + gst), upi_id: pay?.upi_id || 'senthilsky2301@okaxis', payee_name: pay?.payee_name || 'senthilkumar nagendren', proof_line: botText(pay?.proof_mode === 'number' ? 'pay_proof_number' : 'pay_proof_chat', { wa_link: `wa.me/${num}` }), minutes: pay?.activation_minutes || 30 };
  };
  const renderBackend = async (rep) => {
    setTyping(true); await wait(rep.kind === 'dual' ? 900 : 500); setTyping(false);
    const vars = rep.payVars ? payVars(rep.payVars) : (rep.vars || {});
    const image = rep.image === 'payment_qr' ? (pay?.qr_url || null) : rep.image ? content.images[rep.image] || null : null;
    push({ from: 'backend', tag: rep.kind === 'dual' ? 'Our backend · follow-up' : 'Our backend', body: botText(rep.key, vars), image, note: rep.note });
    if (rep.remember) Object.assign(ctx.current, rep.remember);
    if (rep.flow) ctx.current.flow = rep.flow;
    const after = rules?.afterReply?.(rep.key); if (after) Object.assign(ctx.current, after);
  };
  const renderNode = async (id, { jumped = false } = {}) => {
    const n = flowRef.current?.nodes.get(id); if (!n) return;
    const d = n.data || {};
    setTyping(true); await wait(jumped ? 150 : 650); setTyping(false);
    if (n.type === 'media') push({ from: 'bot', nodeId: id, image: d.link, body: d.body, video: d.mediaType === 'video' });
    else if (d.interactiveType === 'list') push({ from: 'bot', nodeId: id, header: d.header, body: d.body, footer: d.footer, list: { button: d.action?.button || d.button || 'Choose', sections: d.action?.sections || [] } });
    else push({ from: 'bot', nodeId: id, header: d.header, body: d.body, footer: d.footer, buttons: optionsOf(n).map((o) => o.title) });
    setCur(id); setSel(id);
  };
  const restart = (m = flowRef.current) => {
    ctx.current = { lang: 'en', registered: false, flow: null, ...SIM };
    setChat([{ id: mid(), from: 'day', body: 'Today' }, { id: mid(), from: 'sys', body: '🔒 Messages are end-to-end encrypted. No one outside of this chat can read them.' }]);
    setCur(null); setSheet(null); setPick(null); setTyped('');
    const kw = (m?.nodes.get(m.rootId)?.keywords || [])[0] || 'Hi';
    setTimeout(() => send(kw), 300);
  };

  // a tap on a row / button
  const tap = async (fromMsg, title, description = '') => {
    const flow = flowRef.current; if (!flow) return;
    setSheet(null); setPick(null);
    push({ from: 'user', body: title, quote: description ? { title, description } : null });
    const l = rules?.langFromLabel?.(title); if (l) ctx.current.lang = l;
    const fromNode = flow.nodes.get(fromMsg.nodeId);
    const r = resolve(flow, fromMsg.nodeId, title);
    const replies = showBackend && rules ? rules.onTap(title, { ...ctx.current, nodeName: fromNode?.name }) : [];
    if (r.to) {
      if (r.clashes.length) sys(`“${title}” also leads to ${r.clashes.map((id) => flow.nodes.get(id)?.name || short(id)).join(', ')}. WACTO keeps one destination per title, so it may open that one instead.`, 'warn');
      await renderNode(r.to);
    } else if (r.dangling) sys('This edge points to a node that does not exist — WACTO sends nothing.', 'bad');
    else if (!replies.some((x) => x.kind === 'backend')) sys(`No edge for “${title}”. WACTO stays silent here.${showBackend ? '' : ' (Backend replies are hidden.)'}`);
    for (const rep of replies) await renderBackend(rep);
  };
  // typed text
  const send = async (text) => {
    const m = flowRef.current;
    const t = String(text || '').trim(); if (!t || !m) return;
    setTyped('');
    push({ from: 'user', body: t });
    const kw = matchKeyword(m, t);
    if (kw) { if (kw === m.rootId) ctx.current.flow = null; await renderNode(kw); return; }
    const replies = showBackend && rules ? rules.onText(t, ctx.current) : [];
    if (!replies.length) { sys(`“${t}” matches no keyword. WACTO stays silent${showBackend ? ' and our backend has nothing to say here' : ''}.`); return; }
    for (const rep of replies) await renderBackend(rep);
  };

  // ── derived ───────────────────────────────────────────────────────────────
  const checks = flow?.checks || [];
  const nErr = checks.filter((c) => c.level === 'error').length;
  const nWarn = checks.filter((c) => c.level === 'warn').length;
  const nodeList = useMemo(() => (flow ? flow.order.map((id) => flow.nodes.get(id)).filter((n) => !q || (n.name || '').toLowerCase().includes(q.toLowerCase()) || optionsOf(n).some((o) => o.title.toLowerCase().includes(q.toLowerCase()))) : []), [flow, q]);
  const selNode = flow && sel ? flow.nodes.get(sel) : null;
  const selOpts = selNode ? optionsOf(selNode).map((o) => ({ ...o, r: resolve(flow, sel, o.title), backend: showBackend && rules ? rules.onTap(o.title, { ...ctx.current, nodeName: selNode.name }) : [] })) : [];
  const selChecks = checks.filter((c) => c.nodeId === sel);
  const sheetMsg = sheet ? chat.find((m) => m.id === sheet) : null;
  const levelOk = (c) => checkLevel === 'all' || c.level === checkLevel;

  return (
    <div className="cv-page">
      <PageHeader
        title="Flow Simulator"
        subtitle="Load a WACTO export and tap through it exactly as a candidate sees it on WhatsApp, before anything is pushed to WACTO."
        actions={<>
          <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={onFile} />
          <Button variant="ghost" icon={Upload} onClick={() => fileRef.current?.click()}>Open JSON</Button>
          <Button variant="ghost" icon={ClipboardPaste} onClick={() => setPaste('')}>Paste JSON</Button>
          <Button variant="ghost" icon={Undo2} onClick={undo} disabled={!histN.past} title="Undo">Undo</Button>
          <Button variant="ghost" icon={Redo2} onClick={redo} disabled={!histN.future} title="Redo">Redo</Button>
          <Button variant="ghost" icon={RotateCcw} onClick={() => restart()} disabled={!flow}>Restart chat</Button>
          <Button icon={Download} onClick={openExport} disabled={!flow}>Export JSON{dirty ? ' · edited' : ''}</Button>
        </>}
      />
      {err && <Alert tone="bad"><CircleAlert size={16} /> {err}</Alert>}
      {/* parts that come from our server: say when they failed instead of showing an empty list */}
      {loadIssues.map((m) => <Alert key={m} tone="warn"><AlertTriangle size={16} /> {m}</Alert>)}

      <div className="sim-wrap"><div className="sim">
        {/* LEFT: source, checks, nodes */}
        <div className="sim-side sim-side--left">
          <Card title="Flow" meta={flow ? `${flow.name}` : 'Nothing loaded'}>
            <Select value={flowName} onChange={(e) => loadServerFlow(e.target.value)} aria-label="Saved flow">
              <option value="">Saved exports (wacto/)</option>
              {flows.map((f) => <option key={f.name} value={f.name}>{f.name}{f.title ? ` — ${f.title}` : ''}</option>)}
            </Select>
            {flow && (
              <div className="sim-stats">
                <span><strong>{inr(flow.nodes.size)}</strong> nodes</span>
                <span><strong>{inr(flow.doc.edges.length)}</strong> edges</span>
                <span><Pill tone={nErr ? 'bad' : 'ok'}>{nErr} error{nErr === 1 ? '' : 's'}</Pill></span>
                <span><Pill tone={nWarn ? 'warn' : 'neutral'}>{nWarn} warn</Pill></span>
              </div>
            )}
            <div className="sim-opts">
              <label className="cv-check-row"><input type="checkbox" checked={showBackend} onChange={(e) => setShowBackend(e.target.checked)} /> Show our backend’s replies</label>
              <Select value={rulesId} onChange={(e) => setRulesId(e.target.value)} aria-label="Backend rules" disabled={!showBackend}>
                {RULE_SETS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </Select>
              <span className="cv-muted" style={{ fontSize: 13 }}>Simulated user: {SIM.name} · {SIM.mobile} · language follows the tapped label.</span>
            </div>
          </Card>

          <Card title={<><ListChecks size={15} /> Checks</>} meta="Same rules as verify_flow / route_check">
            <div className="cv-tabs" role="tablist" style={{ marginBottom: 8 }}>
              {[['all', 'All', checks.length], ['error', 'Errors', nErr], ['warn', 'Warnings', nWarn], ['info', 'Notes', checks.length - nErr - nWarn]].map(([id, label, n]) => <button key={id} type="button" role="tab" aria-selected={checkLevel === id} className={`cv-tab ${checkLevel === id ? 'cv-tab--on' : ''}`} onClick={() => setCheckLevel(id)}>{label}<span className="cv-tab-count">{n}</span></button>)}
            </div>
            <ul className="sim-checks">
              {checks.filter(levelOk).slice(0, 80).map((c, i) => (
                <li key={i} className={`sim-check sim-check--${c.level}`} onClick={() => setSel(c.nodeId)}>
                  {c.level === 'error' ? <CircleAlert size={13} /> : c.level === 'warn' ? <AlertTriangle size={13} /> : <Info size={13} />}
                  <span><strong>{c.node}</strong> — {c.text}</span>
                </li>
              ))}
              {flow && !checks.filter(levelOk).length && <li className="sim-check sim-check--ok"><Check size={13} /> Nothing to report.</li>}
            </ul>
          </Card>

          <Card title="Nodes" meta={flow ? `${nodeList.length} shown` : ''} flush>
            <div style={{ padding: '10px 12px 0' }}><label className="cv-search"><Search size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Node name or option…" aria-label="Find node" /></label></div>
            <ul className="sim-nodes">
              {nodeList.map((n) => (
                <li key={n.nodeId}>
                  <button type="button" className={`sim-node ${sel === n.nodeId ? 'cv-on' : ''} ${cur === n.nodeId ? 'sim-node--live' : ''}`} onClick={() => setSel(n.nodeId)}>
                    {n.type === 'media' ? <ImageIcon size={13} /> : n.data?.interactiveType === 'button' ? <CornerDownLeft size={13} /> : <List size={13} />}
                    <span>{n.name || short(n.nodeId)}</span>
                    {checks.some((c) => c.nodeId === n.nodeId && c.level === 'error') && <i className="cv-dot cv-dot--bad" />}
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        {/* CENTRE: the phone */}
        <div className="sim-phone-col">
          <div className="wa-phone">
            <div className="wa-notch" />
            <div className="wa-screen">
              <div className="wa-status"><span>{new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</span><span>▮▮▮ ◔ 🔋</span></div>
              <div className="wa-header">
                <span className="wa-back">‹</span>
                <span className="wa-avatar">{content.images.credentials ? 'E' : 'E'}</span>
                <div className="wa-header-text"><strong>{flow?.name?.replace(/\s*\(.*\)$/, '') || 'EDMS'}</strong><small>{typing ? 'typing…' : 'Business account'}</small></div>
                <div className="wa-header-icons"><span>📹</span><span>📞</span><span>⋮</span></div>
              </div>
              <div className="wa-chat" ref={chatEl}>
                {chat.map((m) => {
                  if (m.from === 'day') return <div key={m.id} className="wa-day">{m.body}</div>;
                  if (m.from === 'sys') return <div key={m.id} className={`wa-sys ${m.level === 'bad' ? 'wa-sys--bad' : ''}`}>{m.body}</div>;
                  const inbound = m.from !== 'user';
                  return (
                    <div key={m.id} className={`wa-msg ${inbound ? 'wa-msg--in' : 'wa-msg--out'} ${m.from === 'backend' ? 'wa-msg--backend' : ''}`}>
                      <div className="wa-bubble">
                        {m.tag && <span className={`wa-tag ${/follow/.test(m.tag) ? 'wa-tag--dual' : ''}`}>{m.tag}</span>}
                        {m.quote && <div className="wa-quote"><strong>{m.quote.title}</strong><small>{m.quote.description}</small></div>}
                        {m.quote ? null : null}
                        {m.header?.type === 'text' && m.header.text && <div className="wa-hdr">{m.header.text}</div>}
                        {m.header?.type === 'image' && (m.header.link || m.header.url) && <img className="wa-hdr-img" src={m.header.link || m.header.url} alt="" />}
                        {m.header?.type === 'video' && (m.header.link || m.header.url) && <video className="wa-hdr-img" src={`${m.header.link || m.header.url}#t=1`} controls preload="metadata" playsInline />}
                        {m.header?.type === 'document' && <div className="wa-doc"><span className="wa-doc-icon">PDF</span><span>{String(m.header.link || m.header.url || 'document').split('/').pop()}</span></div>}
                        {m.image && (m.video ? <video className="wa-img" src={`${m.image}#t=1`} controls preload="metadata" playsInline /> : <img className="wa-img" src={m.image} alt="" />)}
                        {m.body && !m.quote && <Rich text={m.body} />}
                        {m.footer && <div className="wa-footer">{m.footer}</div>}
                        <div className="wa-meta"><span>{m.time}</span>{!inbound && <span className="wa-ticks">✓✓</span>}</div>
                        {m.list && <div className="wa-listbtn" role="button" onClick={() => { setSheet(m.id); setPick(null); }}><List size={16} /> {m.list.button}</div>}
                      </div>
                      {m.buttons && <div className="wa-btns">{m.buttons.map((b) => <div key={b} className="wa-btn" role="button" onClick={() => tap(m, b)}><CornerDownLeft size={14} /> {b}</div>)}</div>}
                    </div>
                  );
                })}
                {typing && <div className="wa-typing"><i /><i /><i /></div>}
              </div>
              <form className="wa-composer" onSubmit={(e) => { e.preventDefault(); send(typed); }}>
                <span className="wa-emoji">☺</span>
                <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Message" aria-label="Type a message" disabled={!flow} />
                <button type="submit" className="wa-send" aria-label="Send"><Play size={16} /></button>
              </form>
              {sheetMsg && (
                <div className="wa-sheet-scrim" onClick={() => setSheet(null)}>
                  <div className="wa-sheet" onClick={(e) => e.stopPropagation()}>
                    <div className="wa-sheet-head"><span>{sheetMsg.list.button}</span><button type="button" onClick={() => setSheet(null)} aria-label="Close">×</button></div>
                    <div className="wa-sheet-body">
                      {sheetMsg.list.sections.map((s, si) => (
                        <div key={si}>
                          {s.title && <div className="wa-section">{s.title}</div>}
                          {(s.rows || []).map((r) => (
                            <div key={r.id || r.title} className={`wa-row ${pick?.title === r.title ? 'wa-on' : ''}`} onClick={() => setPick({ title: r.title, description: r.description })}>
                              <div className="wa-row-text"><strong>{r.title}</strong>{r.description && <span>{r.description}</span>}</div>
                              <span className="wa-radio" />
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                    <div className="wa-sheet-foot"><button type="button" disabled={!pick} onClick={() => tap(sheetMsg, pick.title, pick.description)}>Send</button></div>
                  </div>
                </div>
              )}
            </div>
          </div>
          <p className="cv-foot"><Smartphone size={14} /> Lists open the WhatsApp sheet; reply buttons sit under the bubble; dashed bubbles are what our backend sends. Type <em>Hi</em> to start over.</p>
        </div>

        {/* RIGHT: inspector */}
        <div className="sim-side sim-side--right">
          {flow && (
            <div className="cv-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={mode === 'inspect'} className={`cv-tab ${mode === 'inspect' ? 'cv-tab--on' : ''}`} onClick={() => setMode('inspect')}><Eye size={14} /> Inspect</button>
              <button type="button" role="tab" aria-selected={mode === 'edit'} className={`cv-tab ${mode === 'edit' ? 'cv-tab--on' : ''}`} onClick={() => setMode('edit')}><Pencil size={14} /> Edit</button>
              {dirty && <span className="cv-tab-count" title="Unsaved edits — export to keep them">edited</span>}
            </div>
          )}
          {mode === 'edit' && selNode ? (
            <Card title="Edit node" meta="Changes apply to the loaded copy. Export gives every id a fresh value.">
              <NodeEditor model={flow} doc={flow.doc} nodeId={sel} checks={selChecks} isLive={cur === sel} onEdit={commit} onSelect={setSel} onShow={() => { sys(`Showing “${selNode.name}”`); renderNode(sel, { jumped: true }); }} onAdd={addNode} onDuplicate={duplicateNode} onDelete={deleteNode} />
            </Card>
          ) : selNode ? (
            <Card title={selNode.name || short(selNode.nodeId)} meta={`${selNode.type === 'media' ? 'Media' : selNode.data?.interactiveType === 'button' ? 'Reply buttons' : 'List'} · id ${short(selNode.nodeId)} · ${flow.into.get(selNode.nodeId) || 0} incoming edge${(flow.into.get(selNode.nodeId) || 0) === 1 ? '' : 's'}`}>
              <div className="cv-row-actions" style={{ marginBottom: 10 }}>
                <Button size="sm" icon={Play} onClick={() => { sys(`Jumped to “${selNode.name}”`); renderNode(selNode.nodeId, { jumped: true }); }}>Show on phone</Button>
                <Button size="sm" variant="ghost" icon={Braces} onClick={() => setRaw((v) => !v)}>{raw ? 'Hide JSON' : 'JSON'}</Button>
                {cur === selNode.nodeId && <Pill tone="ok" dot>On screen</Pill>}
              </div>
              {selNode.nodeId === flow.rootId && <p className="cv-hint">Root keywords: {(selNode.keywords || []).join(', ') || '—'}</p>}
              {selOpts.length > 0 && (
                <table className="cv-table cv-table--plain sim-edges">
                  <thead><tr><th>Option</th><th>Goes to</th></tr></thead>
                  <tbody>
                    {selOpts.map((o) => (
                      <tr key={o.title}>
                        <td><strong>{o.title}</strong>{o.description && <div className="cv-muted" style={{ fontSize: 13 }}>{o.description}</div>}</td>
                        <td>
                          {o.r.to ? <button type="button" className="cv-link" onClick={() => setSel(o.r.to)}>{flow.nodes.get(o.r.to)?.name || short(o.r.to)}</button> : o.r.dangling ? <span className="cv-text-bad">missing node</span> : <span className="cv-muted">no edge</span>}
                          {o.r.clashes.length > 0 && <div className="cv-text-bad" style={{ fontSize: 13 }}>also → {o.r.clashes.map((id) => flow.nodes.get(id)?.name || short(id)).join(', ')}</div>}
                          {o.backend.map((b, i) => <div key={i} style={{ fontSize: 13 }}><Pill tone={b.kind === 'dual' ? 'info' : 'neutral'}>{b.kind === 'dual' ? 'WACTO + backend' : 'backend only'}</Pill></div>)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {selNode.type === 'media' && <p className="cv-hint">Media node: WACTO sends the {selNode.data?.mediaType || 'image'} with this caption and the flow ends here unless our backend follows up.</p>}
              {selChecks.length > 0 && <ul className="sim-checks" style={{ marginTop: 10 }}>{selChecks.map((c, i) => <li key={i} className={`sim-check sim-check--${c.level}`}>{c.level === 'error' ? <CircleAlert size={13} /> : c.level === 'warn' ? <AlertTriangle size={13} /> : <Info size={13} />}<span>{c.text}</span></li>)}</ul>}
              {raw && <pre className="sim-json">{JSON.stringify({ nodeId: selNode.nodeId, name: selNode.name, type: selNode.type, data: selNode.data, keywords: selNode.keywords }, null, 2)}</pre>}
            </Card>
          ) : <Card><div className="cv-table-empty"><Smartphone size={20} /> Load a flow to inspect its nodes.</div></Card>}
          <Card title="How to read this">
            <ul className="cv-uses">
              <li><List size={15} /> White bubbles are WACTO nodes, exactly as WhatsApp renders list and button messages.</li>
              <li><CornerDownLeft size={15} /> Green bubbles are the user’s taps and typed text.</li>
              <li><Braces size={15} /> Dashed bubbles are our backend’s replies, with the wording saved in Bot Messages &amp; Media.</li>
              <li><AlertTriangle size={15} /> Yellow notes flag a silent WACTO, a missing edge, or a title that leads to two nodes.</li>
            </ul>
          </Card>
        </div>
      </div></div>

      <Modal open={!!exp} title="Export for WACTO" onClose={() => setExp(null)} width={620}>
        {exp && (
          <>
            <Field label="Chatbot name" hint="Shown in WACTO after import. Use a new version number so the old bot stays as rollback."><Input value={exp.name} onChange={(e) => setExp({ ...exp, name: e.target.value, result: null })} /></Field>
            <p className="cv-modal-text">Every node, row and button gets a fresh id (WACTO resolves ids account-wide, a reused id sends nothing). Root keeps its id and keywords. The new ids are checked against the {flows.length} saved exports in the wacto folder.</p>
            {!exp.result && <div className="cv-modal-actions"><Button variant="ghost" onClick={() => setExp(null)}>Cancel</Button><Button onClick={prepareExport} disabled={exp.busy || !exp.name.trim()}>{exp.busy ? 'Checking…' : 'Prepare export'}</Button></div>}
            {exp.result && (
              <>
                <ul className="sim-checks sim-checks--stack">
                  <li className="sim-check sim-check--ok"><Check size={13} /><span>{exp.result.renamed} node ids renamed, every row and button id fresh.</span></li>
                  <li className={`sim-check ${exp.result.survived.length ? 'sim-check--error' : 'sim-check--ok'}`}>{exp.result.survived.length ? <CircleAlert size={13} /> : <Check size={13} />}<span>{exp.result.survived.length ? `${exp.result.survived.length} old id(s) survived — do not import` : 'No id from the loaded file survives.'}</span></li>
                  <li className={`sim-check ${exp.clashes.length ? 'sim-check--error' : 'sim-check--ok'}`}>{exp.clashes.length ? <CircleAlert size={13} /> : <Check size={13} />}<span>{exp.clashes.length ? `${exp.clashes.length} id(s) clash with a saved export` : `No clash with the ${exp.checked} saved exports (files in Downloads or other accounts are not checked).`}</span></li>
                  <li className={`sim-check ${exp.errors.length ? 'sim-check--warn' : 'sim-check--ok'}`}>{exp.errors.length ? <AlertTriangle size={13} /> : <Check size={13} />}<span>{exp.errors.length ? `${exp.errors.length} check error(s) remain (see the Checks panel) — known EN/TA shared titles count here too.` : 'Checks: 0 errors.'}</span></li>
                </ul>
                {exp.errors.length > 0 && <label className="cv-check-row" style={{ marginTop: 10 }}><input type="checkbox" checked={!!exp.ack} onChange={(e) => setExp({ ...exp, ack: e.target.checked })} /> I have read the errors and want to export anyway.</label>}
                <p className="cv-hint">After importing in WACTO: keep the old bot switched off as rollback, export the new one again and compare it (diff_export), then test every language live.</p>
                <div className="cv-modal-actions">
                  <Button variant="ghost" onClick={() => setExp(null)}>Close</Button>
                  <Button variant="ghost" icon={Copy} onClick={() => navigator.clipboard?.writeText(JSON.stringify(exp.result.out, null, 2))} disabled={!!exp.result.survived.length || !!exp.clashes.length}>Copy JSON</Button>
                  <Button icon={Download} onClick={downloadExport} disabled={!!exp.result.survived.length || !!exp.clashes.length || (exp.errors.length > 0 && !exp.ack)}>Download {exp.name.trim() || 'flow'}.json</Button>
                </div>
              </>
            )}
          </>
        )}
      </Modal>

      <Modal open={paste !== null} title="Paste a WACTO export" onClose={() => setPaste(null)} width={640}>
        <Textarea rows={12} value={paste || ''} onChange={(e) => setPaste(e.target.value)} placeholder='{"chatbot": {...}, "nodes": [...], "edges": [...]}' />
        <div className="cv-modal-actions"><Button variant="ghost" onClick={() => setPaste(null)}>Cancel</Button><Button onClick={() => { loadModel(paste, 'Pasted JSON'); setPaste(null); }} disabled={!paste?.trim()}>Load</Button></div>
      </Modal>
    </div>
  );
}
