import { useState, useEffect, useRef } from 'react';
import { Copy, Check, Camera, CircleCheck, Hourglass, Info, MessageCircle } from 'lucide-react';
import api from '../api/client.js';
import { Modal, Button, Field, Input, Alert, KV, cloudThumb } from '../civic/ui.jsx';

// "Activate plan" dialog for candidates (Candidate Home + the top-bar button), Civic Ops design.
// Payment is the static UPI QR from the admin "Payment setup" page; the candidate uploads the
// payment screenshot (and/or UTR) here, or sends it to the WhatsApp bot. The admin verifies it
// on the Payments page and the account is activated. Razorpay is not offered.

const fmt = (n) => Number(n || 0).toLocaleString('en-IN');

// Same tiers as backend paymentSettings.priceFor (served in settings.tiers).
const FALLBACK = {
  upi_id: 'senthilsky2301@okaxis',
  payee_name: 'senthilkumar nagendren',
  qr_url: 'https://res.cloudinary.com/ajp3dslc/image/upload/v1791377127/payment-qr.jpg',
  proof_mode: 'chat',
  proof_number: '917092800426',
  bot_number: '917904759268',
  support_phone: '+91 79047 59268',
  activation_minutes: 30,
  gst_rate: 18,
  tiers: [
    { max_booths: 1, base: 2000, label: '1 booth' },
    { max_booths: 5, base: 5000, label: '2–5 booths' },
    { max_booths: 10, base: 10000, label: '6–10 booths' },
    { max_booths: 25, base: 25000, label: '11–25 booths' },
    { max_booths: 100, base: 50000, label: '26–100 booths' },
  ],
};

function priceFor(count, s) {
  const n = Math.max(1, parseInt(count, 10) || 1);
  const tiers = s.tiers?.length ? s.tiers : FALLBACK.tiers;
  const tier = tiers.find((t) => n <= t.max_booths) || tiers[tiers.length - 1];
  const gst = Math.round(tier.base * Number(s.gst_rate ?? 18) / 100);
  return { boothCount: n, base: tier.base, gst, total: tier.base + gst, label: tier.label };
}

const waMe = (num) => { const d = String(num || '').replace(/\D/g, ''); return `https://wa.me/${d.length === 10 ? `91${d}` : d}`; };

// Downscale the chosen image in the browser (max 1280 px, JPEG) so uploads stay small.
function shrinkImage(file) {
  return new Promise((ok, fail) => {
    if (!/^image\//.test(file.type)) return fail(new Error('Please choose an image (screenshot) file.'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 1280;
      const r = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * r));
      c.height = Math.max(1, Math.round(img.height * r));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      ok(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); fail(new Error('Could not read that image. Try a PNG or JPG screenshot.')); };
    img.src = url;
  });
}

export default function PurchaseModal({ open, onClose, onSuccess, user, accountInfo, boothCount = 1, isSample = false }) {
  const [settings, setSettings] = useState(FALLBACK);
  const [status, setStatus] = useState({ loading: true, paid: false, pending: false, pending_since: null });
  const [shot, setShot] = useState('');       // data URL of the downscaled screenshot
  const [utr, setUtr] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);     // response after a successful submit
  const [upiCopied, setUpiCopied] = useState(false);
  const [sendAnother, setSendAnother] = useState(false);
  const fileRef = useRef(null);

  const count = Math.max(1, Number(boothCount || 1));
  const name = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.name || accountInfo?.ward_login || 'Candidate';

  const getMobile = () => {
    let m = user?.mobile_no || user?.mobile || user?.username || accountInfo?.mobile || accountInfo?.mobile_no || accountInfo?.username || '';
    if (!m || m === '-' || String(m).replace(/\D/g, '').length < 10) {
      try { const stored = JSON.parse(localStorage.getItem('edm_user') || '{}'); m = stored?.mobile_no || stored?.mobile || stored?.username || m; } catch { /* ignore */ }
    }
    const clean = String(m || '').replace(/\D/g, '').slice(-10);
    return clean.length === 10 ? clean : (m || '-');
  };
  const mobile = getMobile();
  const pricing = priceFor(count, settings);

  useEffect(() => {
    if (!open) return;
    setErr(''); setDone(null); setShot(''); setUtr(''); setUpiCopied(false); setSendAnother(false);
    setStatus((s) => ({ ...s, loading: true }));
    api.get('/payments/settings').then(({ data }) => { if (data?.settings) setSettings({ ...FALLBACK, ...data.settings }); }).catch(() => {});
    api.get('/payments/check-paid')
      .then(({ data }) => setStatus({ loading: false, paid: !!data?.paid, pending: !!data?.pending, pending_since: data?.pending_since || null }))
      .catch(() => setStatus({ loading: false, paid: false, pending: false, pending_since: null }));
  }, [open]);

  if (!open) return null;

  const pickFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setErr('');
    try { setShot(await shrinkImage(f)); } catch (ex) { setErr(ex.message); }
  };

  const submit = async () => {
    setErr('');
    const cleanUtr = utr.trim();
    if (!shot && cleanUtr.length < 6) { setErr('Upload the payment screenshot, or enter the UPI transaction ID (UTR) from your UPI app.'); return; }
    setBusy(true);
    try {
      const { data } = await api.post('/payments/submit-utr', { screenshot: shot || '', mime: 'image/jpeg', utr: cleanUtr, booth_count: count });
      if (!data.success) throw new Error(data.message || 'Could not submit.');
      if (data.already_paid) { setStatus((s) => ({ ...s, paid: true })); if (onSuccess) onSuccess(data); return; }
      setDone(data);
      setStatus((s) => ({ ...s, pending: true, pending_since: data.pending_since || new Date().toISOString() }));
      window.dispatchEvent(new CustomEvent('payment-proof-submitted', { detail: data }));
    } catch (e) {
      setErr(e.response?.data?.message || e.message || 'Could not submit the payment proof.');
    } finally {
      setBusy(false);
    }
  };

  const copyUpi = () => { navigator.clipboard?.writeText(settings.upi_id); setUpiCopied(true); setTimeout(() => setUpiCopied(false), 2000); };

  const whatsappHint = settings.proof_mode === 'number'
    ? { href: waMe(settings.proof_number), text: `WhatsApp it to +${String(settings.proof_number).replace(/\D/g, '')}` }
    : { href: waMe(settings.bot_number), text: 'send it to the EDMS WhatsApp bot' };

  const sinceText = (iso) => { try { return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };
  const where = [accountInfo?.district || user?.district_id, accountInfo?.assembly_name || user?.assembly_name || accountInfo?.local_body || user?.category_name].filter((x) => x && x !== '-').join(' · ');
  const boothsText = `${count} booth${count === 1 ? '' : 's'}`;

  const title = isSample ? 'Sample data' : status.paid ? 'Your plan is active' : (done || (status.pending && !sendAnother)) ? 'Verifying your payment' : 'Activate your plan';

  return (
    <Modal open title={title} onClose={onClose} width={460} className="cv-modal--sheet cv-pay-modal">
      {isSample ? (
        <>
          <Alert tone="info"><Info size={16} /> This is sample data. Once the Government releases the official data, it will be updated immediately.</Alert>
          <div className="cv-modal-actions"><Button variant="ghost" onClick={onClose}>Close</Button></div>
        </>
      ) : status.paid ? (
        <>
          <Alert tone="ok"><CircleCheck size={16} /> Full voter data for your {boothsText} is unlocked.</Alert>
          <div className="cv-modal-actions"><Button onClick={() => { onClose(); window.location.reload(); }}>Continue to Home</Button></div>
        </>
      ) : done || (status.pending && !sendAnother) ? (
        /* Proof received — waiting for verification */
        <>
          <Alert tone="warn"><Hourglass size={16} /> {done ? 'Thank you, your payment proof is received. ' : ''}Our team checks it against the UPI statement and activates your account within {settings.activation_minutes} minutes.</Alert>
          <KV items={[
            ['Plan', `${pricing.label} · ${boothsText}`],
            ['Amount', `₹${fmt(done?.expected_amount || pricing.total)}`],
            ['Submitted', sinceText(done?.pending_since || status.pending_since) || '—'],
            ['Status', 'Awaiting verification'],
          ]} />
          <p className="cv-modal-text">Help: {settings.support_phone}</p>
          <div className="cv-modal-actions cv-modal-actions--split">
            <Button variant="ghost" onClick={() => { setDone(null); setSendAnother(true); setShot(''); setUtr(''); }}>Send another screenshot</Button>
            <Button onClick={onClose}>Done</Button>
          </div>
        </>
      ) : (
        /* Pay + upload proof */
        <>
          {err && <Alert tone="bad">{err}</Alert>}

          {/* Plan + price (the total first: it is what the candidate came to see) */}
          <div className="cv-pay-plan">
            <div className="cv-pay-plan-head">
              <strong>{pricing.label} plan</strong>
              <span className="cv-muted">{name} · {mobile}{where ? ` · ${where}` : ''} · {boothsText}</span>
            </div>
            <dl className="cv-pay-lines">
              <div><dt>Plan price</dt><dd>₹{fmt(pricing.base)}</dd></div>
              <div><dt>GST ({settings.gst_rate ?? 18}%)</dt><dd>₹{fmt(pricing.gst)}</dd></div>
              <div className="cv-pay-total"><dt>Total to pay</dt><dd>₹{fmt(pricing.total)}</dd></div>
            </dl>
          </div>

          {/* Step 1 — pay */}
          <h3 className="cv-pay-step">Step 1 · Pay ₹{fmt(pricing.total)} by UPI</h3>
          <div className="cv-pay-qr">
            <img src={cloudThumb(settings.qr_url, 200, 200, 'fit')} alt="UPI QR code" width={200} height={200} />
            <span className="cv-muted">{settings.payee_name} · Google Pay / PhonePe / any UPI app</span>
            <div className="cv-pay-upi">
              <code className="cv-mono">{settings.upi_id}</code>
              <Button size="sm" variant="ghost" icon={upiCopied ? Check : Copy} onClick={copyUpi} aria-label="Copy UPI ID">{upiCopied ? 'Copied' : 'Copy'}</Button>
            </div>
          </div>

          {/* Step 2 — proof */}
          <h3 className="cv-pay-step">Step 2 · Send the payment screenshot</h3>
          <input ref={fileRef} type="file" accept="image/*" onChange={pickFile} style={{ display: 'none' }} />
          {shot ? (
            <div className="cv-pay-shot">
              <img src={shot} alt="Payment screenshot preview" />
              <div>
                <strong>Screenshot attached</strong>
                <span className="cv-muted">Make sure the amount and the transaction ID are visible.</span>
              </div>
              <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()}>Change</Button>
            </div>
          ) : (
            <button type="button" className="cv-pay-upload" onClick={() => fileRef.current?.click()}>
              <Camera size={18} />
              <span><strong>Upload payment screenshot</strong><span className="cv-muted">From your UPI app, after paying. PNG or JPG.</span></span>
            </button>
          )}
          <Field label="UPI transaction ID (UTR)" hint="Optional · the 12-digit number shown under the payment in GPay, PhonePe or Paytm">
            <Input type="text" inputMode="numeric" value={utr} onChange={(e) => setUtr(e.target.value.replace(/[^0-9A-Za-z-]/g, '').slice(0, 32))} placeholder="e.g. 412398765432" />
          </Field>
          <div className="cv-modal-actions">
            <Button onClick={submit} disabled={busy} className="cv-pay-submit">{busy ? 'Submitting…' : 'Submit payment proof'}</Button>
          </div>
          <p className="cv-modal-text cv-pay-alt">
            <MessageCircle size={14} /><span>Or <a href={whatsappHint.href} target="_blank" rel="noreferrer" className="cv-link">{whatsappHint.text}</a>. Account activated within {settings.activation_minutes} minutes of verification.</span>
          </p>
        </>
      )}
    </Modal>
  );
}
