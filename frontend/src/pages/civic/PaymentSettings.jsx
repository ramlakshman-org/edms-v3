import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Save, Upload, Check, CircleAlert, QrCode, MessageCircle, Globe, CreditCard, Info } from 'lucide-react';
import api from '../../api/client.js';
import { PageHeader, Card, Pill, inr } from '../../civic/kit.jsx';
import { Field, Input, Select, Button, Alert, fmtDateTime, loadError } from '../../civic/ui.jsx';

// Payment setup (Civic Ops). One record (GET/PUT /payments/settings) that the
// website purchase popup, the WhatsApp bot and the Payments page all read.
// Tier prices stay in code (same numbers for web, bot and ledger).

const readAsBase64 = (file) => new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => fail(new Error('Could not read the file.')); r.readAsDataURL(file); });
const waMe = (num) => { const d = String(num || '').replace(/\D/g, ''); return `wa.me/${d.length === 10 ? `91${d}` : d}`; };

// English preview of the bot's QR caption (the backend builds the real one).
function previewText(s, booths = 3) {
  const tier = (s.tiers || []).find((t) => booths <= t.max_booths) || (s.tiers || [])[0] || { base: 2000 };
  const gst = Math.round(tier.base * Number(s.gst_rate ?? 18) / 100);
  const proof = s.proof_mode === 'number'
    ? `📸 After payment:\nSend your payment screenshot to:\n👉 ${waMe(s.proof_number)}`
    : '📸 After payment:\nSend your payment screenshot here in this chat. We verify it and confirm.';
  return `🏆 Final Step to Secure Your Victory\n\nAssembly: Sankarapuram\nBooths: ${booths}\nPlan: ₹${inr(tier.base)} + ${s.gst_rate ?? 18}% GST\nTotal: ₹${inr(tier.base + gst)}\n\n🏦 UPI ID: ${s.upi_id}\n👤 ${s.payee_name}\n\n📲 Scan the QR code above or pay directly to the UPI ID.\n\n${proof}\n\n⏱️ Your dashboard is activated within ${s.activation_minutes} minutes of verification.`;
}

export default function PaymentSettings() {
  const [s, setS] = useState(null);
  const [orig, setOrig] = useState(null);
  const [qr, setQr] = useState(null); // { base64, mime, name }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [flash, setFlash] = useState('');
  const fileRef = useRef(null);

  const load = () => api.get('/payments/settings').then(({ data }) => { setS(data.settings); setOrig(data.settings); }).catch((e) => setErr(loadError(e, 'the payment setup')));
  useEffect(() => { load(); }, []);

  const set = (k) => (e) => setS((p) => ({ ...p, [k]: e.target.value }));
  const dirty = !!qr || (s && orig && ['upi_id', 'payee_name', 'proof_mode', 'proof_number', 'bot_number', 'support_phone', 'activation_minutes'].some((k) => String(s[k] ?? '') !== String(orig[k] ?? '')));

  const pickQr = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/^image\//.test(f.type)) { setErr('The QR must be an image (PNG or JPG).'); return; }
    if (f.size > 4 * 1024 * 1024) { setErr('QR image is too large (max 4 MB).'); return; }
    setErr('');
    setQr({ base64: await readAsBase64(f), mime: f.type, name: f.name });
  };

  const save = async () => {
    setBusy(true); setErr(''); setFlash('');
    try {
      const body = { upi_id: s.upi_id, payee_name: s.payee_name, proof_mode: s.proof_mode, proof_number: s.proof_number, bot_number: s.bot_number, support_phone: s.support_phone, activation_minutes: Number(s.activation_minutes) || 30 };
      if (qr) { body.qr_base64 = qr.base64; body.qr_mime = qr.mime; }
      const { data } = await api.put('/payments/settings', body);
      if (!data.success) throw new Error(data.message || 'Could not save.');
      setS(data.settings); setOrig(data.settings); setQr(null);
      setFlash(data.message || 'Saved.');
    } catch (e) {
      setErr(e.response?.data?.message || e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!s) return <div className="cv-page"><PageHeader title="Payment setup" meta="UPI QR, proof instructions and plan prices" />{err ? <Alert tone="bad"><CircleAlert size={16} /> {err}</Alert> : <div className="cv-skeleton-block" />}</div>;

  const qrSrc = qr?.base64 || s.qr_url;

  return (
    <div className="cv-page">
      <PageHeader
        title="Payment setup"
        meta="One place for the UPI QR, payee and proof instructions. The website popup, the WhatsApp bot and the Payments page all read it."
        actions={<><Link className="cv-btn cv-btn--ghost" to="/payments"><CreditCard size={15} /> Payments</Link><Button icon={Save} onClick={save} disabled={!dirty || busy}>{busy ? 'Saving…' : 'Save changes'}</Button></>}
      />
      {err && <Alert tone="bad"><CircleAlert size={16} /> {err}</Alert>}
      {flash && <Alert tone="ok"><Check size={16} /> {flash}</Alert>}

      <div className="cv-settings">
        <div className="cv-settings-main">
          <Card title="Where the money goes" meta="Shown under the QR on the website and in the bot">
            <div className="cv-form-grid">
              <Field label="UPI ID" required hint="name@bank — candidates can copy it when the QR does not scan"><Input value={s.upi_id} onChange={set('upi_id')} placeholder="name@okaxis" /></Field>
              <Field label="Payee name" required hint="As it appears in the UPI app after a payment"><Input value={s.payee_name} onChange={set('payee_name')} /></Field>
            </div>
            <div className="cv-qr-row">
              <div className="cv-qr-box"><img src={qrSrc} alt="UPI QR" /></div>
              <div className="cv-qr-meta">
                <strong>UPI QR image</strong>
                <span className="cv-muted">{qr ? `New file: ${qr.name} (saved when you click Save)` : 'Current image, used by the website and the bot.'}</span>
                <input ref={fileRef} type="file" accept="image/*" onChange={pickQr} style={{ display: 'none' }} />
                <div className="cv-row-actions"><Button variant="ghost" size="sm" icon={Upload} onClick={() => fileRef.current?.click()}>Replace QR</Button>{qr && <Button variant="ghost" size="sm" onClick={() => setQr(null)}>Undo</Button>}</div>
              </div>
            </div>
          </Card>

          <Card title="Payment proof" meta="Where the candidate sends the screenshot after paying">
            <div className="cv-form-grid">
              <Field label="Screenshot goes to" hint={s.proof_mode === 'chat' ? 'The bot stores it and it appears in Payments → To verify.' : 'A person checks that chat and marks the candidate paid by hand.'}>
                <Select value={s.proof_mode} onChange={set('proof_mode')}>
                  <option value="chat">The WhatsApp bot chat (recommended)</option>
                  <option value="number">A separate WhatsApp number</option>
                </Select>
              </Field>
              {s.proof_mode === 'number'
                ? <Field label="Separate WhatsApp number" required hint="Digits with country code, e.g. 917092800426"><Input value={s.proof_number} onChange={set('proof_number')} inputMode="numeric" /></Field>
                : <Field label="Bot WhatsApp number" required hint="The website links to this number: digits with country code"><Input value={s.bot_number} onChange={set('bot_number')} inputMode="numeric" /></Field>}
              <Field label="Activation promise (minutes)" hint="Quoted in every payment message"><Input type="number" min={5} max={1440} value={s.activation_minutes} onChange={set('activation_minutes')} /></Field>
              <Field label="Support phone" hint="Shown in the proof confirmation and rejection messages"><Input value={s.support_phone} onChange={set('support_phone')} /></Field>
            </div>
          </Card>

          <Card title="Plans" meta="Fixed in code, the same for the website, the bot and the ledger. Prices before 18% GST.">
            <table className="cv-table cv-table--plain">
              <thead><tr><th>Booths</th><th style={{ textAlign: 'right' }}>Plan</th><th style={{ textAlign: 'right' }}>GST</th><th style={{ textAlign: 'right' }}>Candidate pays</th></tr></thead>
              <tbody>
                {(s.tiers || []).map((t) => { const gst = Math.round(t.base * Number(s.gst_rate ?? 18) / 100); return <tr key={t.max_booths}><td>{t.label}</td><td style={{ textAlign: 'right' }}>₹{inr(t.base)}</td><td style={{ textAlign: 'right' }} className="cv-muted">₹{inr(gst)}</td><td style={{ textAlign: 'right' }}><strong>₹{inr(t.base + gst)}</strong></td></tr>; })}
              </tbody>
            </table>
          </Card>
        </div>

        <aside className="cv-settings-side">
          <Card title="What the candidate sees" meta="Bot caption, English, 3 booths (preview)">
            <div className="cv-wa">
              <div className="cv-wa-bubble">
                <img src={qrSrc} alt="" className="cv-wa-img" />
                <pre className="cv-wa-text">{previewText(s)}</pre>
                <span className="cv-wa-time">{new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</span>
              </div>
            </div>
          </Card>
          <Card title="Used by">
            <ul className="cv-uses">
              <li><Globe size={15} /> Website purchase popup (QR, UPI ID, upload screenshot)</li>
              <li><MessageCircle size={15} /> Bot: after registration and when the candidate types <em>pay</em></li>
              <li><QrCode size={15} /> Bot: screenshot sent in the chat is queued for verification</li>
              <li><CreditCard size={15} /> Payments page: expected amounts and approvals</li>
            </ul>
            <p className="cv-foot" style={{ marginTop: 10 }}><Info size={14} /> {s.updated_at ? <>Last saved {fmtDateTime(s.updated_at)}{s.updated_by ? ` by ${s.updated_by}` : ''}.</> : <>Not saved yet — the built-in defaults are in use.</>} <Pill tone={dirty ? 'warn' : 'ok'} dot>{dirty ? 'Unsaved changes' : 'Saved'}</Pill></p>
          </Card>
        </aside>
      </div>
    </div>
  );
}
