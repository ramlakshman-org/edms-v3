import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Save, RotateCcw, Check, CircleAlert, Info, MessageSquareText, Images, Upload, Trash2, QrCode, ChevronDown, ChevronRight, Search } from 'lucide-react';
import api from '../../api/client.js';
import { PageHeader, Card, Pill, Kpi, inr } from '../../civic/kit.jsx';
import { Button, Alert, Modal, Textarea, loadError, cloudThumb } from '../../civic/ui.jsx';

// Bot Messages & Media (Civic Ops step 8). Every text the WACTO bot sends from
// the backend (EN + TA) and the images it attaches, grouped by conversation
// stage, with a phone preview. APIs: GET /flow-images/bot · POST /flow-images/bot/texts
// · POST /flow-images/upload · DELETE /flow-images/:key · GET /flow-images (legacy).
// The menus and step lists themselves are WACTO flow nodes (Flow Builder, later).

const SAMPLE = {
  name: 'Sim Kumar', mobile: '9000000003', passcode: '482913', assembly: 'Sankarapuram', step: 'Step 3 — Local Body Type',
  plan: 'Up to 5 Booths', price: '₹5,000', booths: '3', service: 'WA Broadcast', support_phone: '+91 79047 59268',
  title: '🏆 Final Step to Secure Your Victory (வெற்றி உறுதி)', assembly_line: 'Assembly: Sankarapuram\n', base: '5,000', gst_rate: '18', total: '5,900',
  upi_id: 'senthilsky2301@okaxis', payee_name: 'senthilkumar nagendren', proof_line: '📸 After payment:\nSend your payment screenshot *here in this chat*. We verify it and confirm.',
  minutes: '30', utr_line: '\nUTR: `412398765432`', wa_link: 'wa.me/917092800426', name_prefix: 'Sim, ', amount: '5,900', answer: 'Monday evening', reason_line: '\n\nReason: amount does not match the plan',
};
const render = (tpl, vars) => String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));

// WhatsApp inline formatting for the preview: *bold* _italic_ `mono`
function waFormat(text) {
  const parts = String(text || '').split(/(\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`)/g);
  return parts.map((p, i) => {
    if (/^\*[^*]+\*$/.test(p)) return <strong key={i}>{p.slice(1, -1)}</strong>;
    if (/^_[^_]+_$/.test(p)) return <em key={i}>{p.slice(1, -1)}</em>;
    if (/^`[^`]+`$/.test(p)) return <code key={i}>{p.slice(1, -1)}</code>;
    return p;
  });
}

const readAsBase64 = (file) => new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result).replace(/^data:[^;]+;base64,/, '')); r.onerror = () => fail(new Error('Could not read the file.')); r.readAsDataURL(file); });

export default function BotContent() {
  const [tab, setTab] = useState('messages');
  const [cat, setCat] = useState(null);           // { groups, texts, images }
  const [loadFailed, setLoadFailed] = useState(false); // the wording didn't load: no figures, no Save
  const [draft, setDraft] = useState({});          // `${key}_${lang}` -> text
  const [sel, setSel] = useState('');
  const [lang, setLang] = useState('en');
  const [q, setQ] = useState('');
  const [legacy, setLegacy] = useState([]);
  const [legacyOpen, setLegacyOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [flash, setFlash] = useState('');
  const [confirmRm, setConfirmRm] = useState(null);
  const fileRefs = useRef({});

  const load = async () => {
    setErr('');
    try {
      const { data } = await api.get('/flow-images/bot');
      setCat(data); setDraft({}); setLoadFailed(false);
      if (!sel && data.texts?.length) setSel(data.texts[0].key);
    } catch (e) { setErr(loadError(e, 'the bot messages')); setLoadFailed(true); }
    api.get('/flow-images').then(({ data }) => setLegacy((data.assets || []).filter((a) => !String(a.key).startsWith('bot_img_')))).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const texts = cat?.texts || [];
  const byKey = useMemo(() => Object.fromEntries(texts.map((t) => [t.key, t])), [texts]);
  const item = byKey[sel];
  const val = (key, l) => (draft[`${key}_${l}`] !== undefined ? draft[`${key}_${l}`] : byKey[key]?.[l] ?? '');
  const isDirty = (key) => ['en', 'ta'].some((l) => draft[`${key}_${l}`] !== undefined && draft[`${key}_${l}`] !== byKey[key]?.[l]);
  const dirtyKeys = texts.filter((t) => isDirty(t.key)).map((t) => t.key);
  // What would break on WhatsApp: too long (blocks Save), an unknown {placeholder} (blocks Save, it
  // would reach users literally), a missing one (warning: e.g. no {passcode} in the credentials).
  // An empty box goes back to the built-in wording, so it has no issues.
  const issuesOf = (key, l) => {
    const t = byKey[key]; const v = val(key, l);
    if (!t || !v.trim()) return { over: false, unknown: [], missing: [] };
    const used = [...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    return { over: v.length > t.max, unknown: [...new Set(used.filter((x) => !t.vars.includes(x)))], missing: t.vars.filter((x) => !used.includes(x)) };
  };
  const blocks = (key) => ['en', 'ta'].some((l) => { const i = issuesOf(key, l); return i.over || i.unknown.length > 0; });
  const blockedKeys = dirtyKeys.filter(blocks);
  const customCount = texts.filter((t) => t.custom_en || t.custom_ta).length;
  const matches = (t) => !q || [t.name, t.when, t.key, t.en, t.ta].some((v) => String(v || '').toLowerCase().includes(q.toLowerCase()));

  const save = async () => {
    if (!dirtyKeys.length) return;
    setBusy('save'); setErr(''); setFlash('');
    try {
      const body = {};
      for (const key of dirtyKeys) for (const l of ['en', 'ta']) if (draft[`${key}_${l}`] !== undefined) body[`${key}_${l}`] = draft[`${key}_${l}`];
      const { data } = await api.post('/flow-images/bot/texts', body);
      if (!data.success) throw new Error(data.message || 'Could not save.');
      setFlash(data.message || 'Saved.');
      await load();
    } catch (e) { setErr(e.response?.data?.message || e.message); } finally { setBusy(''); }
  };

  const uploadImage = async (assetKey, file) => {
    if (!file) return;
    if (!/^image\//.test(file.type)) { setErr('Choose an image file (JPG or PNG).'); return; }
    if (file.size > 5 * 1024 * 1024) { setErr('Image is too large (max 5 MB).'); return; }
    setBusy(assetKey); setErr(''); setFlash('');
    try {
      const { data } = await api.post('/flow-images/upload', { key: assetKey, filename: file.name, mime: file.type, fileBase64: await readAsBase64(file) });
      if (!data.success) throw new Error(data.message || 'Upload failed.');
      setFlash('Image uploaded. The bot sends it from now on.');
      await load();
    } catch (e) { setErr(e.response?.data?.message || e.message); } finally { setBusy(''); }
  };

  const removeImage = async () => {
    if (!confirmRm) return;
    setBusy(confirmRm.key); setErr(''); setFlash(''); setConfirmRm((c) => c && { ...c, err: '' });
    try {
      await api.delete(`/flow-images/${encodeURIComponent(confirmRm.key)}`);
      setFlash(confirmRm.bot ? 'Back to the default image.' : 'Asset removed.');
      setConfirmRm(null);
      await load();
    } catch (e) { setConfirmRm((c) => c && { ...c, err: e.response?.data?.message || e.message }); } finally { setBusy(''); } // shown inside the dialog
  };

  const previewText = item ? render(val(item.key, lang), SAMPLE) : '';
  const previewImage = item?.image === 'payment_qr' ? (cat?.payment_qr_url || null) : item?.image ? cat?.images?.find((i) => i.key === item.image)?.url : null;

  return (
    <div className="cv-page">
      <PageHeader
        title="Bot Messages & Media"
        subtitle="Every reply the WhatsApp bot sends from our side, in English and Tamil, and the images it attaches. Menus and step lists live in the WACTO flow."
        actions={<>
          {dirtyKeys.length > 0 && <Button variant="ghost" icon={RotateCcw} onClick={() => setDraft({})}>Discard</Button>}
          {!loadFailed && <Button icon={Save} onClick={save} disabled={!dirtyKeys.length || blockedKeys.length > 0 || busy === 'save'} title={blockedKeys.length ? `Fix ${blockedKeys.map((k) => byKey[k].name).join(', ')} first` : undefined}>{busy === 'save' ? 'Saving…' : dirtyKeys.length ? `Save ${dirtyKeys.length} change${dirtyKeys.length === 1 ? '' : 's'}` : 'Saved'}</Button>}
        </>}
      />
      {err && <Alert tone="bad"><CircleAlert size={16} /> {err}</Alert>}
      {blockedKeys.length > 0 && <Alert tone="bad"><CircleAlert size={16} /> Can’t save yet: {blockedKeys.map((k) => byKey[k].name).join(', ')} {blockedKeys.length === 1 ? 'has' : 'have'} a problem marked in red.</Alert>}
      {flash && <Alert tone="ok"><Check size={16} /> {flash}</Alert>}

      {/* when the wording didn't load, the tiles say so instead of showing a healthy-looking 0 */}
      {loadFailed ? (
      <div className="cv-kpis cv-kpis--4">
        {['Messages', 'Customised', 'Unsaved', 'Images'].map((l) => <Kpi key={l} label={l} value="—" note="couldn't load" tone="bad" />)}
      </div>
      ) : (
      <div className="cv-kpis cv-kpis--4">
        <Kpi label="Messages" value={inr(texts.length)} note="sent by the backend, EN + TA each" />
        <Kpi label="Customised" value={inr(customCount)} note={customCount ? 'differ from the built-in wording' : 'all on the built-in wording'} />
        <Kpi label="Unsaved" value={inr(dirtyKeys.length)} note={dirtyKeys.length ? 'click Save to apply' : 'nothing pending'} tone={dirtyKeys.length ? 'warn' : undefined} />
        <Kpi label="Images" value={inr((cat?.images || []).length + 1)} note="2 bot headers + the payment QR" />
      </div>
      )}

      <div className="cv-tabs-row cv-tabs-row--bare">
        <div className="cv-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'messages'} className={`cv-tab ${tab === 'messages' ? 'cv-tab--on' : ''}`} onClick={() => setTab('messages')}><MessageSquareText size={15} /> Messages<span className="cv-tab-count">{texts.length}</span></button>
          <button type="button" role="tab" aria-selected={tab === 'media'} className={`cv-tab ${tab === 'media' ? 'cv-tab--on' : ''}`} onClick={() => setTab('media')}><Images size={15} /> Media<span className="cv-tab-count">{(cat?.images || []).length + 1}</span></button>
        </div>
        {tab === 'messages' && <label className="cv-search cv-tabs-search"><Search size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a message…" aria-label="Search messages" /></label>}
      </div>

      {/* nothing to edit or preview when the wording didn't load (the alert above says why) */}
      {tab === 'messages' && !loadFailed && (
        <div className="cv-bot">
          <nav className="cv-bot-nav" aria-label="Messages">
            {(cat?.groups || []).map((g) => {
              const items = texts.filter((t) => t.group === g.id && matches(t));
              if (!items.length) return null;
              return (
                <div key={g.id} className="cv-bot-group">
                  <h3 title={g.note}>{g.name}</h3>
                  {items.map((t) => (
                    <button key={t.key} type="button" className={`cv-bot-item ${sel === t.key ? 'cv-on' : ''}`} onClick={() => setSel(t.key)}>
                      <span>{t.name}</span>
                      {isDirty(t.key) && blocks(t.key) ? <i className="cv-dot cv-dot--bad" title="Can’t be saved as it is" /> : isDirty(t.key) ? <i className="cv-dot cv-dot--warn" title="Unsaved" /> : (t.custom_en || t.custom_ta) ? <i className="cv-dot cv-dot--accent" title="Customised" /> : null}
                    </button>
                  ))}
                </div>
              );
            })}
          </nav>

          {item ? (
            <section className="cv-bot-editor">
              <header className="cv-bot-head">
                <div>
                  <h2>{item.name}</h2>
                  <p className="cv-muted">{item.when}</p>
                </div>
                <div className="cv-row-actions">{(item.custom_en || item.custom_ta) && <Pill tone="info">Customised</Pill>}{item.image && <Pill tone="neutral">With image · caption</Pill>}</div>
              </header>
              {item.vars.length > 0 && (
                <p className="cv-bot-vars">Filled in by the bot: {item.vars.map((v) => <code key={v} className="cv-chip-code" title={`Example: ${String(SAMPLE[v] ?? '').replace(/\n/g, ' ')}`}>{`{${v}}`}</code>)}</p>
              )}
              <div className="cv-bot-langs">
                {['en', 'ta'].map((l) => {
                  const v = val(item.key, l);
                  const { over, unknown, missing } = issuesOf(item.key, l);
                  const changed = draft[`${item.key}_${l}`] !== undefined && draft[`${item.key}_${l}`] !== item[l];
                  const isDefault = v === item[`default_${l}`];
                  return (
                    <div key={l} className={`cv-bot-lang ${lang === l ? 'cv-on' : ''}`}>
                      <div className="cv-bot-lang-head">
                        <strong>{l === 'en' ? 'English' : 'தமிழ் · Tamil'}</strong>
                        <span className={`cv-count ${over ? 'cv-text-bad' : ''}`}>{inr(v.length)} / {inr(item.max)}</span>
                      </div>
                      <Textarea rows={10} value={v} lang={l === 'ta' ? 'ta' : 'en'} onFocus={() => setLang(l)} onChange={(e) => setDraft((d) => ({ ...d, [`${item.key}_${l}`]: e.target.value }))} />
                      <div className="cv-bot-lang-foot">
                        {isDefault ? <span className="cv-muted">Built-in wording</span> : <button type="button" className="cv-link" onClick={() => setDraft((d) => ({ ...d, [`${item.key}_${l}`]: item[`default_${l}`] }))}><RotateCcw size={12} /> Reset to built-in</button>}
                        {changed && <Pill tone="warn">Unsaved</Pill>}
                        {over && <span className="cv-text-bad">Too long for WhatsApp</span>}
                      </div>
                      {unknown.length > 0 && <p className="cv-bot-issue cv-text-bad">{unknown.map((x) => `{${x}}`).join(', ')}: the bot doesn’t fill {unknown.length === 1 ? 'this' : 'these'} in, so users would see {unknown.length === 1 ? 'it' : 'them'} as typed. Use only {item.vars.length ? item.vars.map((x) => `{${x}}`).join(', ') : 'no placeholders here'}.</p>}
                      {missing.length > 0 && <p className="cv-bot-issue cv-text-warn">Missing {missing.map((x) => `{${x}}`).join(', ')}: users won’t get {missing.length === 1 ? 'this detail' : 'these details'}.</p>}
                    </div>
                  );
                })}
              </div>
            </section>
          ) : <section className="cv-bot-editor"><div className="cv-table-empty">Pick a message on the left.</div></section>}

          <aside className="cv-bot-preview">
            <div className="cv-bot-preview-head">
              <strong>Preview</strong>
              <div className="cv-seg">
                <button type="button" className={`cv-seg-btn ${lang === 'en' ? 'cv-seg-btn--on' : ''}`} onClick={() => setLang('en')}>EN</button>
                <button type="button" className={`cv-seg-btn ${lang === 'ta' ? 'cv-seg-btn--on' : ''}`} onClick={() => setLang('ta')}>TA</button>
              </div>
            </div>
            <div className="cv-phone">
              <div className="cv-phone-bar"><span className="cv-phone-avatar">E</span><span>EDMS<small>WhatsApp bot</small></span></div>
              <div className="cv-wa cv-wa--tall">
                {item && (
                  <div className="cv-wa-bubble">
                    {previewImage && <img src={previewImage} alt="" className="cv-wa-img" />}
                    <div className="cv-wa-text">{waFormat(previewText)}</div>
                    <span className="cv-wa-time">{new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</span>
                  </div>
                )}
              </div>
            </div>
            <p className="cv-foot"><Info size={14} /> Sample values stand in for the variables. The bot uses new wording within a minute of saving.</p>
          </aside>
        </div>
      )}

      {tab === 'media' && (
        <div className="cv-media">
          <Card title="Images the bot sends" meta="Replace to change what every candidate receives from now on">
            <div className="cv-media-grid">
              {(cat?.images || []).map((im) => (
                <div key={im.key} className="cv-media-card">
                  <div className="cv-media-thumb"><img src={cloudThumb(im.url, 280, 140, 'fit')} alt={im.name} /></div>
                  <div className="cv-media-meta">
                    <strong>{im.name}</strong>
                    <span className="cv-muted">{im.when}</span>
                    <span>{im.custom ? <Pill tone="info">Uploaded</Pill> : <Pill tone="neutral">Built-in</Pill>}</span>
                  </div>
                  <input ref={(el) => { fileRefs.current[im.asset_key] = el; }} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { uploadImage(im.asset_key, e.target.files?.[0]); e.target.value = ''; }} />
                  <div className="cv-row-actions">
                    <Button size="sm" variant="ghost" icon={Upload} onClick={() => fileRefs.current[im.asset_key]?.click()} disabled={busy === im.asset_key}>{busy === im.asset_key ? 'Uploading…' : 'Replace'}</Button>
                    {im.custom && <Button size="sm" variant="ghost" icon={Trash2} className="cv-btn--danger" onClick={() => setConfirmRm({ key: im.asset_key, name: im.name, bot: true })}>Back to built-in</Button>}
                  </div>
                </div>
              ))}
              <div className="cv-media-card cv-media-card--link">
                <div className="cv-media-thumb cv-media-thumb--icon"><QrCode size={28} /></div>
                <div className="cv-media-meta">
                  <strong>Payment QR</strong>
                  <span className="cv-muted">Sent after registration and on “pay”, with the UPI ID</span>
                </div>
                <Link className="cv-btn cv-btn--ghost cv-btn--sm" to="/payments/setup">Open Payment setup</Link>
              </div>
            </div>
          </Card>

          <Card title={<button type="button" className="cv-collapse" onClick={() => setLegacyOpen((v) => !v)}>{legacyOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />} Older flow assets <span className="cv-tab-count">{legacy.length}</span></button>} meta="Headers, icons, banners and party flags of the earlier Meta Cloud API flow. The current WACTO bot does not send these; kept for reference.">
            {legacyOpen && (
              <div className="cv-media-grid cv-media-grid--dense">
                {legacy.map((a) => (
                  <div key={a.key} className="cv-media-card">
                    <div className="cv-media-thumb">{a.url ? (a.type === 'video' ? <video src={a.url} muted /> : <img src={cloudThumb(a.url, 280, 140, 'fit')} alt={a.name} />) : <span className="cv-muted">No file</span>}</div>
                    <div className="cv-media-meta"><strong>{a.name}</strong><span className="cv-muted cv-mono-sm">{a.key}</span></div>
                    <input ref={(el) => { fileRefs.current[a.key] = el; }} type="file" accept="image/*,video/mp4" style={{ display: 'none' }} onChange={(e) => { uploadImage(a.key, e.target.files?.[0]); e.target.value = ''; }} />
                    <div className="cv-row-actions">
                      <Button size="sm" variant="ghost" icon={Upload} onClick={() => fileRefs.current[a.key]?.click()} disabled={busy === a.key}>{a.url ? 'Replace' : 'Upload'}</Button>
                      {a.url && <Button size="sm" variant="ghost" icon={Trash2} className="cv-btn--danger" onClick={() => setConfirmRm({ key: a.key, name: a.name, bot: false })}>Remove</Button>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      <Modal open={!!confirmRm} title={confirmRm?.bot ? 'Back to the built-in image?' : 'Remove this asset?'} onClose={() => setConfirmRm(null)}>
        {confirmRm && (
          <>
            {confirmRm.err && <Alert tone="bad"><CircleAlert size={16} /> {confirmRm.err}</Alert>}
            <p className="cv-modal-text">{confirmRm.bot ? `The uploaded “${confirmRm.name}” image is deleted and the bot sends the built-in one again.` : `“${confirmRm.name}” is deleted from storage.`}</p>
            <div className="cv-modal-actions"><Button variant="ghost" onClick={() => setConfirmRm(null)}>Cancel</Button><Button className="cv-btn--danger-solid" onClick={removeImage} disabled={!!busy}>{busy ? 'Working…' : confirmRm.bot ? 'Use built-in image' : 'Remove'}</Button></div>
          </>
        )}
      </Modal>
    </div>
  );
}
