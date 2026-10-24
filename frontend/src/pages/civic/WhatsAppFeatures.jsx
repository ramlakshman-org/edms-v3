import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Save, Send, RefreshCw, Check, CircleAlert, Clock, X, Plus, Pencil, QrCode, MessageSquareText, Radio, TriangleAlert, Link2 } from 'lucide-react';
import api from '../../api/client.js';
import { PageHeader, Card, Pill } from '../../civic/kit.jsx';
import { Field, Input, Select, Button, Alert, DataTable, fmtDateTime, loadError } from '../../civic/ui.jsx';

// WhatsApp Features (Civic Ops), layout A "Tabs" — approved by Ram 2026-10-17
// (mockup https://claude.ai/artifact/KQrE8FpGFK2P6rrCzoE7Co). Ported from live's pages/WhatsAppFeatures.jsx (Ram, 2026-10-16).
// Switches tab = what is on, in plain words; Activity tab = next reminders due + the log; Setup tab = test numbers,
// a test message and the WACTO templates. One save bar appears only after a change.
// Every new WhatsApp feature arrives switched OFF. Turn one on for your own test number first, then for everyone.
// Reminders can also run as "Practice" (the API's "dry"): they work out what they would send and send nothing.
// APIs: GET/PUT /whatsapp-features · POST /whatsapp-features/test-send · GET /whatsapp-features/templates.
// The replies the bot sends for these features are edited under Bot Messages & Media ("WhatsApp features" group);
// the QR message is the Payment setup one.

const MODES = {
  off: { label: 'Off', short: 'Off', tone: 'neutral', means: 'Nobody gets it. The bot works as it does today.' },
  dry: { label: 'Practice', short: 'Practice', tone: 'info', means: 'Works out who it would message and lists them under Activity. Sends nothing.' },
  test: { label: 'Test numbers', short: 'Test', tone: 'warn', means: 'Only your test numbers get it. Everyone else sees no change.' },
  all: { label: 'Everyone', short: 'Everyone', tone: 'ok', means: 'Live for every number, within 30 seconds of saving.' },
};
const GROUPS = [
  ['rem', 'Reminders', 'Messages the bot sends by itself, on a timetable.', ['payment_reminders', 'incomplete_reminders']],
  ['bot', 'Bot buttons and replies', 'How the bot answers when someone taps a button or types a word.', ['pay_buttons', 'website_login', 'stop_optout']],
];
const FEATURE_TEXT = {
  payment_reminders: {
    name: 'Payment reminders', tpl: 'payment',
    what: 'Reminds people who registered but have not paid. Up to 5 messages, on day 1, 2, 3, 5 and 7.',
    steps: ['Someone registers and does not pay.', 'On day 1, 2, 3, 5 and 7 they get the payment reminder with Pay Now and Pay Later buttons.', 'It pauses while a payment screenshot is being checked, and stops when they pay or reply STOP.', 'After the 5th reminder they stay on your list for a phone call.'],
  },
  incomplete_reminders: {
    name: 'Finish-registration reminders', tpl: 'incomplete',
    what: 'For people who stopped half-way in the WhatsApp bot. A message after 2 hours, then reminders on day 1 and day 3.',
    steps: ['Someone starts registering in the WhatsApp bot and stops.', 'After 2 hours of silence they get a short message asking them to continue.', 'On day 1 and day 3 they get the "Complete your registration" template with a Register now button, if they chose at least one option.', 'When they finish, they move to Registered on Incomplete registrations.'],
  },
  pay_buttons: {
    name: 'Pay Now / Pay Later buttons', uses: 'payment',
    what: 'Pay Now sends the QR code, UPI ID and amount in one message. Pay Later asks when they will pay and waits 2 days.',
    steps: ['A payment reminder arrives with Pay Now and Pay Later buttons.', 'Pay Now: the bot sends the QR code, UPI ID and amount in one message.', 'Pay Later: the bot asks when they will pay, saves the answer and waits 2 days before the next reminder.'],
  },
  website_login: {
    name: 'Website login on WhatsApp', uses: 'wording',
    what: 'After registering on the website, the person gets their login in WhatsApp instead of on the screen.',
    steps: ['Someone registers on the website.', 'Instead of the passcode, the page shows a green "Send my login to WhatsApp" button.', 'They tap it, WhatsApp opens with a ready message, and the bot replies with their login and payment details.'],
  },
  stop_optout: {
    name: 'Reply STOP to end reminders', uses: 'wording',
    what: 'Anyone who replies STOP gets no more reminders. The bot menu keeps working for them.',
    steps: ['Someone replies STOP (or நிறுத்து).', 'The bot confirms, and no more reminders go to that number.', 'The bot menu still works for them when they send Hi.'],
  },
};
const TEMPLATE_TEXT = {
  payment: { title: 'Payment reminder', used: 'Payment reminders, with the Pay Now / Pay Later buttons' },
  incomplete: { title: 'Complete your registration', used: 'Finish-registration reminders, with the Register now button' },
  activated: { title: 'Account activated', used: 'Test messages only for now' },
};
const TEMPLATE_KEYS = ['payment', 'incomplete', 'activated'];
const STATUS = { APPROVED: ['ok', 'Ready'], PENDING: ['warn', 'Waiting for Meta'], REJECTED: ['bad', 'Rejected by Meta'] };
const TABS = ['switches', 'activity', 'setup'];
const ten = (s) => String(s || '').replace(/\D/g, '').slice(-10);
const nameOf = (k, data) => FEATURE_TEXT[k]?.name || data?.features?.[k]?.label || k;
const whatOf = (l) => (l.kind === 'payment' ? `Payment reminder ${l.step} of ${l.of}`
  : l.kind === 'incomplete' ? (l.step === 'nudge' ? 'Finish-registration: first message' : `Finish-registration: template ${l.step} of 2`)
  : l.kind === 'test' ? `Test message (${l.by || 'admin'})` : `Pay Later answer: "${l.text}"`);

// Off / Practice / Test numbers / Everyone — one radio group per feature
function ModeSwitch({ k, label, modes, value, onChange }) {
  const onKey = (e) => {
    const i = modes.indexOf(value);
    const last = modes.length - 1;
    const n = { ArrowRight: i === last ? 0 : i + 1, ArrowDown: i === last ? 0 : i + 1, ArrowLeft: i === 0 ? last : i - 1, ArrowUp: i === 0 ? last : i - 1, Home: 0, End: last }[e.key];
    if (n === undefined) return;
    e.preventDefault();
    onChange(modes[n]);
    e.currentTarget.querySelectorAll('button')[n]?.focus();
  };
  return (
    <div className="cv-wf-switch" role="radiogroup" aria-label={`${label} setting`} data-feature={k} onKeyDown={onKey}>
      {modes.map((m) => (
        <button key={m} type="button" role="radio" aria-checked={value === m} tabIndex={value === m ? 0 : -1} data-mode={m}
          className={`cv-wf-opt cv-wf-opt--${MODES[m].tone} ${value === m ? 'cv-wf-opt--on' : ''}`} onClick={() => onChange(m)}>
          <span className="cv-wf-dot" aria-hidden="true" />
          <span className="cv-wf-long">{MODES[m].label}</span><span className="cv-wf-short">{MODES[m].short}</span>
        </button>
      ))}
    </div>
  );
}

export default function WhatsAppFeatures() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.includes(params.get('tab')) ? params.get('tab') : 'switches';
  const setTab = (t) => setParams(t === 'switches' ? {} : { tab: t }, { replace: true });

  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [err, setErr] = useState('');
  const [flash, setFlash] = useState('');
  const [saving, setSaving] = useState(false);
  const [newNumber, setNewNumber] = useState('');
  const [numberErr, setNumberErr] = useState('');
  const [editNames, setEditNames] = useState(false);
  // "Send a test message": one template, now, only to a saved test number
  const [test, setTest] = useState({ template: 'payment', lang: 'en', mobile: '' });
  const [testMsg, setTestMsg] = useState(null); // { ok, text }
  const [testing, setTesting] = useState(false);
  const [tpls, setTpls] = useState(null); // Meta status of every template on the account

  const formOf = (d) => ({
    features: Object.fromEntries(Object.entries(d.settings.features).map(([k, v]) => [k, v.mode])),
    test_numbers: [...(d.settings.test_numbers || [])],
    templates: structuredClone(d.settings.templates),
  });
  const load = async ({ keepForm = false } = {}) => {
    setErr('');
    try {
      const { data: d } = await api.get('/whatsapp-features');
      setData(d);
      if (!keepForm) setForm(formOf(d));
    } catch (e) { setErr(loadError(e, 'the WhatsApp features')); }
  };
  const loadTemplates = async () => {
    setTpls(null);
    try { const { data: d } = await api.get('/whatsapp-features/templates'); setTpls({ rows: d.templates || [] }); }
    catch (e) {
      // the server hides 5xx reasons in production ("Internal server error…"), so say what failed in plain words
      const raw = e.response?.data?.message || '';
      const hidden = !raw || (e.response?.status || 0) >= 500 || /internal server error/i.test(raw);
      setTpls({ rows: [], error: hidden ? 'Could not read the template status from WACTO right now. The switches still work; press Refresh status in a minute.' : raw });
    }
  };
  useEffect(() => { load(); loadTemplates(); }, []);

  if (!data || !form) {
    return (
      <div className="cv-page">
        <PageHeader title="WhatsApp Features" subtitle="Turn new WhatsApp features on step by step: your test number first, then everyone." />
        {err ? <Alert tone="bad"><CircleAlert size={16} /> {err}</Alert> : <div className="cv-skeleton-block" />}
      </div>
    );
  }

  const savedModes = Object.fromEntries(Object.entries(data.settings.features).map(([k, v]) => [k, v.mode]));
  const savedNumbers = data.settings.test_numbers || [];
  const changedFeatures = Object.keys(form.features).filter((k) => form.features[k] !== savedModes[k]);
  const numbersChanged = form.test_numbers.join(',') !== savedNumbers.join(',');
  const templatesChanged = JSON.stringify(form.templates) !== JSON.stringify(data.settings.templates);
  const changeCount = changedFeatures.length + (numbersChanged ? 1 : 0) + (templatesChanged ? 1 : 0);
  const goesLive = changedFeatures.filter((k) => form.features[k] === 'all').map((k) => nameOf(k, data));

  const setMode = (k, m) => { setFlash(''); setForm((s) => ({ ...s, features: { ...s.features, [k]: m } })); };
  const setTpl = (key, f) => (e) => setForm((s) => ({ ...s, templates: { ...s.templates, [key]: { ...s.templates[key], [f]: e.target.value } } }));
  const addNumber = () => {
    const n = ten(newNumber);
    if (n.length !== 10) { setNumberErr('Enter a 10-digit WhatsApp number.'); return; }
    if (form.test_numbers.includes(n)) { setNumberErr('That number is already on the list.'); return; }
    if (form.test_numbers.length >= 5) { setNumberErr('Up to 5 test numbers. Remove one first.'); return; }
    setNumberErr(''); setNewNumber(''); setFlash('');
    setForm((s) => ({ ...s, test_numbers: [...s.test_numbers, n] }));
  };
  const removeNumber = (n) => { setFlash(''); setForm((s) => ({ ...s, test_numbers: s.test_numbers.filter((x) => x !== n) })); };

  const save = async () => {
    setSaving(true); setErr(''); setFlash('');
    try {
      await api.put('/whatsapp-features', {
        features: Object.fromEntries(Object.entries(form.features).map(([k, mode]) => [k, { mode }])),
        test_numbers: form.test_numbers,
        templates: form.templates,
      });
      setFlash('Saved. It takes effect within 30 seconds.');
      setEditNames(false);
      await load();
    } catch (e) { setErr(e.response?.data?.message || 'Could not save. Nothing was changed; try again.'); }
    finally { setSaving(false); }
  };
  const discard = () => { setForm(formOf(data)); setEditNames(false); setNumberErr(''); };

  const sendTest = async () => {
    setTesting(true); setTestMsg(null);
    const mobile = test.mobile || savedNumbers[0] || '';
    try {
      const { data: r } = await api.post('/whatsapp-features/test-send', { ...test, mobile });
      setTestMsg({ ok: true, text: `${r.message} Filled in: ${(r.params || []).join(' · ')}` });
    } catch (e) {
      const p = e.response?.data?.params;
      setTestMsg({ ok: false, text: `${e.response?.data?.message || 'Not sent.'}${p ? ` Filled in: ${p.join(' · ')}` : ''}` });
    } finally {
      await load({ keepForm: true }); // the activity log shows every attempt, sent or not
      setTesting(false);
    }
  };

  // template status from Meta, matched by the saved name + language code
  const statusOf = (key, lang) => {
    if (!tpls || tpls.error) return null;
    const t = data.settings.templates[key];
    const row = tpls.rows.find((r) => r.name === t?.name && r.language === t?.[lang]);
    return row ? { status: row.status, reason: row.rejected_reason && row.rejected_reason !== 'NONE' ? row.rejected_reason : '' } : { status: 'MISSING' };
  };
  const statusPill = (s) => {
    if (!s) return <span className="cv-muted">—</span>;
    if (s.status === 'MISSING') return <Pill tone="bad" dot>Not in WACTO</Pill>;
    const [tone, label] = STATUS[s.status] || ['neutral', s.status];
    return <div className="cv-two"><Pill tone={tone} dot>{label}</Pill>{s.reason && <span className="cv-muted">{s.reason}</span>}</div>;
  };
  const readyCount = tpls && !tpls.error ? TEMPLATE_KEYS.reduce((n, k) => n + (statusOf(k, 'en')?.status === 'APPROVED') + (statusOf(k, 'ta')?.status === 'APPROVED'), 0) : null;
  const tplChecks = (key) => {
    const en = statusOf(key, 'en'), ta = statusOf(key, 'ta');
    if (!en || !ta) return tpls?.error ? [['bad', CircleAlert, 'Template status could not be read from WACTO']] : [];
    if (en.status === 'APPROVED' && ta.status === 'APPROVED') return [['ok', Check, 'Template ready in English and Tamil']];
    const out = [];
    for (const [lang, s] of [['English', en], ['Tamil', ta]]) {
      if (s.status === 'APPROVED') out.push(['ok', Check, `${lang} template ready`]);
      else if (s.status === 'PENDING') out.push(['warn', Clock, `${lang} template is waiting for Meta`]);
      else if (s.status === 'REJECTED') out.push(['bad', X, `${lang} template was rejected by Meta`]);
      else out.push(['bad', X, `${lang} template is not in WACTO`]);
    }
    return out;
  };
  const usesOf = (k) => {
    const f = FEATURE_TEXT[k] || {};
    if (f.tpl) return tplChecks(f.tpl);
    if (f.uses === 'payment') return [['', QrCode, <>QR code and UPI ID come from <Link to="/payments/setup">Payment setup</Link></>], ['', Link2, 'Buttons arrive with the payment reminder']];
    return [['', MessageSquareText, <>Reply wording is in <Link to="/flow-images">Bot Messages &amp; Media</Link></>]];
  };

  // "Right now" — the saved state in one sentence
  const by = (m) => Object.values(savedModes).filter((v) => v === m).length;
  const nowParts = [
    by('test') ? `${by('test')} ${by('test') === 1 ? 'feature runs' : 'features run'} only for your test ${savedNumbers.length === 1 ? 'number' : 'numbers'}` : '',
    by('dry') ? `${by('dry')} ${by('dry') === 1 ? 'reminder is' : 'reminders are'} practising and send nothing` : '',
    by('off') ? `${by('off')} off` : '',
  ].filter(Boolean);

  return (
    <div className={`cv-page cv-wf ${changeCount > 0 || flash ? 'cv-wf--bar' : ''}`}>
      <PageHeader
        title="WhatsApp Features"
        subtitle="Turn new WhatsApp features on step by step: your test number first, then everyone."
        actions={<><Link className="cv-btn cv-btn--ghost" to="/flow-images"><MessageSquareText size={15} /> Bot messages</Link><Link className="cv-btn cv-btn--ghost" to="/payments/setup"><QrCode size={15} /> Payment setup</Link></>}
      />
      {err && <Alert tone="bad"><CircleAlert size={16} /> {err}</Alert>}

      <div className="cv-wf-now" data-now>
        <Radio size={16} />
        <div>
          <p>
            {by('off') === Object.keys(savedModes).length ? (
              <><strong>Everything is off.</strong> The bot works as it does today.</>
            ) : (
              <>
                <strong>{by('all') ? `${by('all')} live for everyone.` : 'Nothing is live for everyone yet.'}</strong>
                {nowParts.length > 0 && ` ${nowParts.join(', ').replace(/^./, (c) => c.toUpperCase())}.`}
              </>
            )}
          </p>
          <div className="cv-wf-now-meta">
            <span>Test {savedNumbers.length === 1 ? 'number' : 'numbers'}: {savedNumbers.length ? <span className="cv-mono-sm">{savedNumbers.join(', ')}</span> : 'none yet'}</span>
            {readyCount != null && <span>Templates: {readyCount} of 6 ready</span>}
            {data.settings.updated_at && <span>Last saved {fmtDateTime(data.settings.updated_at)}{data.settings.updated_by ? ` by ${data.settings.updated_by}` : ''}</span>}
          </div>
        </div>
      </div>

      <Card flush className="cv-wf-tabs-card">
        <div className="cv-tabs-row cv-tabs-row--bare">
          <div className="cv-tabs" role="tablist" aria-label="WhatsApp Features">
            {[['switches', 'Switches', Object.keys(savedModes).length], ['activity', 'Activity', data.upcoming.length], ['setup', 'Setup', null]].map(([id, label, count]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} className={`cv-tab ${tab === id ? 'cv-tab--on' : ''}`} onClick={() => setTab(id)} data-tab={id}>
                {label}{count != null && <span className="cv-tab-count">{count}</span>}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {tab === 'switches' && (
        <>
          {GROUPS.map(([g, title, meta, keys]) => (
            <Card key={g} title={title} meta={meta} flush>
              {keys.filter((k) => data.features[k]).map((k) => {
                const f = FEATURE_TEXT[k] || {};
                const changed = changedFeatures.includes(k);
                const since = data.settings.features[k].since;
                return (
                  <div key={k} className={`cv-wf-row ${changed ? 'cv-wf-row--changed' : ''}`} data-row={k}>
                    <div className="cv-wf-text">
                      <div className="cv-wf-title">
                        <strong>{nameOf(k, data)}</strong>
                        <Pill tone={MODES[savedModes[k]].tone} dot>{MODES[savedModes[k]].label}</Pill>
                        {changed && <span className="cv-wf-tag">Not saved</span>}
                      </div>
                      {f.what && <p>{f.what}</p>}
                      <ul className="cv-wf-uses">
                        {usesOf(k).map(([tone, Icon, text], i) => <li key={i} className={tone ? `cv-wf-uses--${tone}` : ''}><Icon size={14} /> <span>{text}</span></li>)}
                        {since && <li><Clock size={14} /> <span>First turned on {fmtDateTime(since)}</span></li>}
                      </ul>
                      {f.steps && (
                        <details className="cv-wf-how">
                          <summary>How it works</summary>
                          <ol>{f.steps.map((s) => <li key={s}>{s}</li>)}</ol>
                        </details>
                      )}
                    </div>
                    <div className="cv-wf-ctl">
                      <ModeSwitch k={k} label={nameOf(k, data)} modes={data.features[k].modes} value={form.features[k]} onChange={(m) => setMode(k, m)} />
                      <span className={`cv-wf-means ${form.features[k] === 'all' ? 'cv-wf-means--all' : ''}`}>{MODES[form.features[k]].means}</span>
                    </div>
                  </div>
                );
              })}
            </Card>
          ))}
          <div className="cv-wf-legend">
            {['off', 'dry', 'test', 'all'].map((m) => <span key={m} className={`cv-wf-opt--${MODES[m].tone}`}><i className="cv-wf-dot" /> <b>{MODES[m].label}</b> {MODES[m].means.replace(/\.$/, '')}</span>)}
          </div>
        </>
      )}

      {tab === 'activity' && (
        <>
          <Card title="Next reminders due" meta={`${data.counts.payment_active} waiting · ${data.counts.payment_done} finished · ${data.counts.opted_out} said STOP. Reminders start for registrations made after the switch is first turned on.`} flush>
            <DataTable
              rowKey={(u) => u.mobile}
              rows={data.upcoming}
              empty="Nothing due."
              columns={[
                { key: 'name', label: 'Name', primary: true, render: (u) => u.name || '—' },
                { key: 'mobile', label: 'Mobile', render: (u) => <span className="cv-mono-sm">{u.mobile}</span> },
                { key: 'step', label: 'Reminder', render: (u) => `${u.step} of ${u.of}` },
                { key: 'due_at', label: 'Due', render: (u) => <span style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(u.due_at)}</span> },
                { key: 'mode', label: 'Will', render: (u) => <Pill tone={u.mode === 'send' ? 'ok' : u.mode === 'dry' ? 'info' : 'neutral'} dot>{u.mode === 'send' ? 'Send' : u.mode === 'dry' ? 'Practice only' : 'Nothing (off)'}</Pill> },
                { key: 'pay_later', label: 'Pay Later answer', wrap: true, render: (u) => (u.pay_later ? `"${u.pay_later.text}" (${fmtDateTime(u.pay_later.at)})` : '—') },
              ]}
            />
          </Card>
          <Card title="Recent activity" meta="The last 100: sent, practice runs, failures, Pay Later answers and test messages" flush>
            <DataTable
              rowKey={(l) => l._id || `${l.at}-${l.mobile}-${l.kind}`}
              rows={data.log}
              empty="Nothing yet."
              columns={[
                { key: 'at', label: 'When', primary: true, render: (l) => <span style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(l.at)}</span> },
                { key: 'mobile', label: 'Mobile', render: (l) => <span className="cv-mono-sm">{l.mobile}</span> },
                { key: 'what', label: 'What', wrap: true, render: whatOf },
                { key: 'template', label: 'Template', wrap: true, render: (l) => `${l.template || '—'}${l.lang ? ` (${l.lang})` : ''}` },
                { key: 'result', label: 'Result', wrap: true, render: (l) => (l.mode === 'dry' ? <Pill tone="info" dot>Practice, not sent</Pill> : l.mode === 'reply' ? <Pill>Their answer</Pill> : l.ok ? <Pill tone="ok" dot>Sent</Pill> : <div className="cv-two"><Pill tone="bad" dot>Failed</Pill><span className="cv-muted">{l.error}</span></div>) },
              ]}
            />
          </Card>
        </>
      )}

      {tab === 'setup' && (
        <>
          <div className="cv-wf-grid">
            <Card title="Test numbers" meta="Features set to Test numbers reach only these. Up to 5.">
              <div className="cv-wf-chips">
                {form.test_numbers.length === 0 && <span className="cv-muted">No test numbers yet. Add your own WhatsApp number first.</span>}
                {form.test_numbers.map((n) => (
                  <span key={n} className="cv-wf-chip"><span className="cv-mono-sm">{n}</span>
                    <button type="button" onClick={() => removeNumber(n)} aria-label={`Remove ${n}`}><X size={13} /></button></span>
                ))}
              </div>
              <div className="cv-wf-add">
                <Field label="Add a number" hint={numberErr || undefined}>
                  <Input value={newNumber} onChange={(e) => { setNewNumber(e.target.value); setNumberErr(''); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addNumber(); } }} placeholder="10-digit WhatsApp number" inputMode="numeric" aria-label="Add a test number" />
                </Field>
                <Button variant="ghost" icon={Plus} onClick={addNumber}>Add</Button>
              </div>
              {numbersChanged && <p className="cv-hint">Save to use the new list.</p>}
            </Card>

            <Card title="Send a test message" meta="Sends one template now, only to a saved test number. It is filled in from that number's account (name, booths, amount).">
              {savedNumbers.length === 0 ? (
                <p className="cv-muted" style={{ margin: 0 }}>Add your number under Test numbers and save first.</p>
              ) : (
                <div className="cv-wf-test">
                  <Field label="Message">
                    <Select value={test.template} onChange={(e) => setTest((s) => ({ ...s, template: e.target.value }))} aria-label="Test template">
                      {TEMPLATE_KEYS.map((k) => <option key={k} value={k}>{TEMPLATE_TEXT[k].title}</option>)}
                    </Select>
                  </Field>
                  <Field label="Language">
                    <Select value={test.lang} onChange={(e) => setTest((s) => ({ ...s, lang: e.target.value }))} aria-label="Test language">
                      <option value="en">English</option>
                      <option value="ta">Tamil</option>
                    </Select>
                  </Field>
                  <Field label="To">
                    <Select value={test.mobile || savedNumbers[0]} onChange={(e) => setTest((s) => ({ ...s, mobile: e.target.value }))} aria-label="Test number">
                      {savedNumbers.map((m) => <option key={m} value={m}>{m}</option>)}
                    </Select>
                  </Field>
                  <Button icon={Send} onClick={sendTest} disabled={testing}>{testing ? 'Sending…' : 'Send test message'}</Button>
                </div>
              )}
              {testMsg && <div style={{ marginTop: 12 }}><Alert tone={testMsg.ok ? 'ok' : 'bad'}>{testMsg.ok ? <Check size={16} /> : <CircleAlert size={16} />} {testMsg.text}</Alert></div>}
            </Card>
          </div>

          <Card
            title="Templates in WACTO"
            meta="Status comes from Meta through WACTO. Names must match WACTO exactly; change them only if a template is renamed there."
            action={<div className="cv-row-actions"><Button variant="ghost" size="sm" icon={RefreshCw} onClick={loadTemplates}>Refresh status</Button><Button variant="ghost" size="sm" icon={Pencil} onClick={() => setEditNames((v) => !v)}>{editNames ? 'Done' : 'Edit names'}</Button></div>}
            flush
          >
            {tpls?.error && <div className="cv-card-body"><Alert tone="bad"><CircleAlert size={16} /> {tpls.error}</Alert></div>}
            <DataTable
              rowKey={(k) => k}
              rows={TEMPLATE_KEYS}
              empty="No templates."
              columns={[
                { key: 'title', label: 'Message', primary: true, wrap: true, render: (k) => <div className="cv-two"><strong>{TEMPLATE_TEXT[k].title}</strong><span className="cv-muted">{TEMPLATE_TEXT[k].used}</span></div> },
                { key: 'name', label: 'Name in WACTO', wrap: true, render: (k) => (editNames ? (
                  <div className="cv-wf-names">
                    <Input value={form.templates[k].name} onChange={setTpl(k, 'name')} aria-label={`${TEMPLATE_TEXT[k].title} template name`} />
                    <label>English code <Input value={form.templates[k].en} onChange={setTpl(k, 'en')} aria-label={`${TEMPLATE_TEXT[k].title} English code`} /></label>
                    <label>Tamil code <Input value={form.templates[k].ta} onChange={setTpl(k, 'ta')} aria-label={`${TEMPLATE_TEXT[k].title} Tamil code`} /></label>
                  </div>
                ) : <span className="cv-mono-sm">{form.templates[k].name}</span>) },
                { key: 'en', label: 'English', render: (k) => (tpls ? statusPill(statusOf(k, 'en')) : <span className="cv-skel" style={{ height: 14, width: 60 }} />) },
                { key: 'ta', label: 'Tamil', render: (k) => (tpls ? statusPill(statusOf(k, 'ta')) : <span className="cv-skel" style={{ height: 14, width: 60 }} />) },
              ]}
            />
          </Card>
        </>
      )}

      {changeCount > 0 ? (
        <div className="cv-wf-savebar" role="region" aria-label="Unsaved changes">
          <span>
            <b>{changeCount} {changeCount === 1 ? 'change' : 'changes'} not saved.</b>{' '}
            {goesLive.length ? <span className="cv-wf-golive"><TriangleAlert size={14} /> {goesLive.join(', ')} will go to everyone.</span> : 'It takes effect within 30 seconds of saving.'}
          </span>
          <span className="cv-wf-savebar-actions">
            <Button variant="ghost" onClick={discard} disabled={saving}>Discard</Button>
            <Button icon={Save} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
          </span>
        </div>
      ) : flash ? (
        <div className="cv-wf-savebar cv-wf-savebar--ok" role="status"><span><Check size={15} /> {flash}</span></div>
      ) : null}
    </div>
  );
}
