import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, XCircle, RefreshCw, AlertTriangle, Check, CircleAlert, Info, MessageCircle, Search, Paperclip, QrCode, ExternalLink, ArrowRight } from 'lucide-react';
import api from '../../api/client.js';
import { PageHeader, Card, Pill, Kpi, inr } from '../../civic/kit.jsx';
import { DataTable, Button, Modal, Alert, Textarea, fmtDateTime, fmtDate, waLink } from '../../civic/ui.jsx';
import { isTestUtr } from '../../civic/needs.js';

// Payments (Civic Ops step 3 + proof queue). APIs:
// GET /payments/pending-utrs?status=all · POST /payments/approve-utr {utr_id, action, reason}
// GET /payments/subscriptions · settings at /payments/setup.
// Candidates pay the static UPI QR and send a screenshot (website upload or an
// image to the WhatsApp bot); each lands here as a pending proof. Approving
// marks the candidate paid, writes the ledger and tells them on WhatsApp.

// Booth-count tiers, same as backend paymentSettings.priceFor (+18% GST).
export const tierFor = (booths) => {
  const n = Math.max(1, Number(booths) || 1);
  const base = n > 25 ? 50000 : n > 10 ? 25000 : n > 5 ? 10000 : n > 1 ? 5000 : 2000;
  const label = n > 25 ? '26–100 booths' : n > 10 ? '11–25 booths' : n > 5 ? '6–10 booths' : n > 1 ? '2–5 booths' : '1 booth';
  return { base, gst: Math.round(base * 0.18), total: base + Math.round(base * 0.18), label };
};

const TABS = [
  { id: 'pending', label: 'To verify' },
  { id: 'paid', label: 'Received' },
  { id: 'all', label: 'All submissions' },
];

const hasShot = (r) => !!r.screenshot_url || (r.screenshots || []).some((s) => s.url);

function checksFor(row, all) {
  const out = [];
  const utr = String(row.utr || '').trim();
  if (!utr && !hasShot(row)) out.push({ tone: 'bad', text: row.wa_media_id ? 'Screenshot could not be fetched — open the WACTO inbox' : 'No screenshot and no UTR' });
  if (utr && !/^\d{12}$/.test(utr)) out.push(isTestUtr(utr) ? { tone: 'bad', text: 'UTR looks like a test entry' } : { tone: 'warn', text: 'UTR is not a 12-digit number' });
  if (utr) {
    const dup = all.filter((o) => o._id !== row._id && String(o.utr).trim() === utr);
    if (dup.length) out.push({ tone: 'bad', text: `Same UTR submitted ${dup.length + 1} times` });
  }
  const tier = tierFor(row.booth_count);
  if (row.amount != null && Number(row.amount) !== tier.total) out.push({ tone: 'warn', text: `Amount ₹${inr(row.amount)} ≠ expected ₹${inr(tier.total)} for ${tier.label}` });
  const ageDays = row.submitted_at ? (Date.now() - new Date(row.submitted_at).getTime()) / 86400000 : 0;
  if (row.status === 'pending' && ageDays > 7) out.push({ tone: 'warn', text: `Waiting ${Math.floor(ageDays)} days` });
  return out;
}

const sourcePill = (r) => (r.source === 'whatsapp' ? <Pill tone="ok">WhatsApp</Pill> : r.source === 'website' ? <Pill tone="info">Website</Pill> : <Pill tone="neutral">UTR form</Pill>);

export default function Payments({ isTeam = false }) {
  // the tab lives in the URL so the Dashboard can link straight to /payments?tab=paid
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'pending';
  const setTab = (id) => { const n = new URLSearchParams(params); if (id === 'pending') n.delete('tab'); else n.set('tab', id); n.delete('show'); setParams(n); };
  // ?show=test (from the Dashboard's "test payment proofs to reject"): only the pending proofs whose UTR
  // looks like a test entry, so the page matches the chip that sent Ram here
  const showTest = params.get('show') === 'test' && tab === 'pending';
  const clearShow = () => { const n = new URLSearchParams(params); n.delete('show'); setParams(n); };
  const [utrs, setUtrs] = useState([]);
  const [subs, setSubs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [confirm, setConfirm] = useState(null); // { row, action, reason, matched, done }
  const [lightbox, setLightbox] = useState(null); // { row, i }
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState('');

  const load = async () => {
    setLoading(true); setErr('');
    try {
      const [u, s] = await Promise.all([
        api.get('/payments/pending-utrs', { params: { status: 'all', limit: 200 } }).then((r) => r.data?.rows || []),
        api.get('/payments/subscriptions').then((r) => r.data?.subscriptions || []).catch(() => []),
      ]);
      setUtrs(u); setSubs(s);
    } catch (e) {
      setErr(e.response?.data?.message || 'Could not load payments.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const pending = utrs.filter((r) => r.status === 'pending');
  const approved = utrs.filter((r) => r.status === 'approved');
  const rejected = utrs.filter((r) => r.status === 'rejected');
  const revenue = subs.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const oldest = pending.reduce((o, r) => (!o || r.submitted_at < o ? r.submitted_at : o), null);
  const flagged = pending.filter((r) => checksFor(r, utrs).some((c) => c.tone === 'bad')).length;
  const withShot = pending.filter(hasShot).length;

  const match = (r) => !q || [r.user_name, r.mobile_no, r.utr, r.district_id, r.name, r.transaction_id].some((v) => String(v || '').toLowerCase().includes(q.toLowerCase()));
  const utrRows = useMemo(() => (tab === 'pending' ? pending : utrs).filter((r) => !showTest || isTestUtr(r.utr)).filter(match), [tab, utrs, q, showTest]);
  const subRows = useMemo(() => subs.filter(match), [subs, q]);

  const act = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      const { data } = await api.post('/payments/approve-utr', { utr_id: String(confirm.row._id), action: confirm.action, reason: confirm.reason || '' });
      if (!data.success) throw new Error(data.message || 'Failed.');
      const message = data.message || (confirm.action === 'approve' ? 'Payment approved.' : 'Payment rejected.');
      setFlash(message);
      await load();
      // the result stays in the dialog (on a phone the page-top message is off-screen) with the next one ready
      setConfirm((c) => ({ ...c, done: { action: c.action, name: c.row.user_name || 'The candidate', message } }));
    } catch (e) {
      setConfirm((c) => ({ ...c, err: e.response?.data?.message || e.message }));
    } finally {
      setBusy(false);
    }
  };

  const statusPill = (s) => (s === 'approved' ? <Pill tone="ok" dot>Approved</Pill> : s === 'rejected' ? <Pill tone="bad" dot>Rejected</Pill> : <Pill tone="warn" dot>Pending</Pill>);

  const shotsOf = (r) => { const list = (r.screenshots || []).filter((s) => s.url).map((s) => s.url); return list.length ? list : (r.screenshot_url ? [r.screenshot_url] : []); };

  // a plain function, not a nested component: a nested one remounts every render and the dialog loses its opener
  const proof = (r) => {
    const shots = shotsOf(r);
    if (!shots.length) return <div className="cv-two"><span className="cv-shot cv-shot--none"><Paperclip size={14} /></span><span className="cv-muted">{r.wa_media_id ? 'In WACTO inbox' : 'UTR only'}</span></div>;
    return (
      <button type="button" className="cv-shot-btn" onClick={() => setLightbox({ row: r, i: 0 })} title="Open screenshot">
        <img className="cv-shot" src={shots[0]} alt="Payment screenshot" />
        {shots.length > 1 && <span className="cv-shot-count">+{shots.length - 1}</span>}
      </button>
    );
  };

  const utrColumns = [
    { key: 'proof', label: 'Proof', wrap: 70, render: (r) => proof(r) },
    { key: 'user', label: 'Payer', primary: true, wrap: 120, render: (r) => (
      <div className="cv-two">
        <strong>{r.user_name || '—'}</strong>
        <span className="cv-muted cv-mono-sm">{r.mobile_no || '—'}{r.district_id ? ` · ${r.district_id}` : ''}</span>
      </div>
    ) },
    { key: 'plan', label: 'Plan', wrap: 120, medium: false, mobile: false, render: (r) => <div className="cv-two"><span>{r.booth_count || 1} booth{Number(r.booth_count) === 1 ? '' : 's'}</span><span className="cv-muted">{r.category_name || r.candidate_type || ''}</span></div> },
    // on the To-verify tab the submitted date rides here, so the all-"Pending" Status column can fold on small laptops
    { key: 'utr', label: 'UPI transaction ID (UTR)', render: (r) => <div className="cv-two"><span className="cv-mono">{r.utr || '—'}</span><span className="cv-nowrap">{sourcePill(r)}{tab === 'pending' && r.submitted_at ? <span className="cv-muted"> {fmtDate(r.submitted_at)}</span> : null}</span></div> },
    { key: 'amount', label: 'Expected', align: 'right', render: (r) => { const t = tierFor(r.booth_count); const amt = r.status === 'approved' ? Number(r.amount) : t.total; return <div className="cv-two" style={{ alignItems: 'flex-end' }}><strong>₹{inr(amt)}</strong><span className="cv-muted">{t.label}</span></div>; } },
    { key: 'checks', label: 'Checks', wrap: true, render: (r) => { const c = checksFor(r, utrs); return c.length ? <ul className="cv-checks">{c.map((x) => <li key={x.text} className={`cv-check cv-check--${x.tone}`}>{x.tone === 'bad' ? <CircleAlert size={12} /> : <AlertTriangle size={12} />} {x.text}</li>)}</ul> : <span className="cv-check cv-check--ok"><Check size={12} /> Looks fine</span>; } },
    // Status and submitted / reviewed time share one column so the table fits a laptop
    { key: 'status', label: 'Status', wrap: 110, medium: tab === 'pending' ? false : undefined, mobile: tab === 'pending' ? false : undefined, render: (r) => <div className="cv-stack-xs">{statusPill(r.status)}<div className="cv-two"><span>{fmtDateTime(r.submitted_at)}</span>{r.reviewed_at && <span className="cv-muted">{r.status} {fmtDate(r.reviewed_at)}{r.reviewed_by ? ` · ${r.reviewed_by}` : ''}</span>}{r.status === 'rejected' && r.reject_reason && <span className="cv-muted">“{r.reject_reason}”</span>}</div></div> },
    { key: 'actions', label: '', render: (r) => r.status === 'pending' ? (
      <span className="cv-row-actions cv-row-actions--stack">
        {/* a test proof: Reject is the strong button, Approve steps back (same positions, so no misclicks) */}
        <Button size="sm" variant={isTestUtr(r.utr) ? 'ghost' : 'primary'} icon={CheckCircle2} onClick={() => openConfirm(r, 'approve')}>Approve</Button>
        <Button size="sm" variant={isTestUtr(r.utr) ? 'primary' : 'ghost'} icon={XCircle} className={isTestUtr(r.utr) ? 'cv-btn--danger-solid' : 'cv-btn--danger'} onClick={() => openConfirm(r, 'reject')}>Reject</Button>
        {r.mobile_no && <a className="cv-icon-btn cv-icon-btn--sm cv-wa" href={waLink(r.mobile_no)} target="_blank" rel="noreferrer" title="WhatsApp the payer"><MessageCircle size={14} /></a>}
      </span>
    ) : null },
  ];

  const subColumns = [
    { key: 'name', label: 'Candidate', render: (r) => <div className="cv-two"><strong>{r.name || '—'}</strong><span className="cv-muted cv-mono-sm">{r.mobile_no}</span></div> },
    { key: 'role_label', label: 'Type', render: (r) => <div className="cv-two"><span>{r.role_label || '—'}</span><span className="cv-muted">{r.local_body_type || ''}</span></div> },
    { key: 'where', label: 'District · Assembly', render: (r) => <div className="cv-two"><span>{r.district || '—'}</span><span className="cv-muted">{r.assembly_name || ''}</span></div> },
    { key: 'booth_count', label: 'Booths', align: 'right' },
    { key: 'amount', label: 'Amount', align: 'right', render: (r) => <strong>₹{inr(r.amount)}</strong> },
    { key: 'transaction_id', label: 'Transaction', render: (r) => <span className="cv-mono">{r.transaction_id || '—'}</span> },
    { key: 'payment_date', label: 'Paid on', render: (r) => fmtDateTime(r.payment_date) },
  ];

  const lbShots = lightbox ? shotsOf(lightbox.row) : [];
  const openConfirm = (row, action) => setConfirm({ row, action, reason: '', matched: false });
  const nextPending = confirm?.done ? pending.find((r) => r._id !== confirm.row._id) : null;
  const confirmChecks = confirm ? checksFor(confirm.row, utrs) : [];
  const risky = confirmChecks.some((c) => c.tone === 'bad'); // a red check: Approve steps back and needs the statement tick

  return (
    <div className="cv-page">
      <PageHeader
        eyebrow={isTeam ? 'Follow-up' : undefined}
        title="Payments"
        subtitle="Verify UPI QR payment proofs and see the payments received"
        actions={<>{!isTeam && <Link className="cv-btn cv-btn--ghost" to="/payments/setup"><QrCode size={15} /> Payment setup</Link>}<Button variant="ghost" icon={RefreshCw} onClick={load} disabled={loading}>Refresh</Button></>}
      />

      {err && <Alert tone="bad"><CircleAlert size={16} /> {err}</Alert>}
      {flash && <Alert tone="ok"><Check size={16} /> {flash}</Alert>}

      {/* On a phone the queue comes first; these tiles fold into the one-line summary below it (civic-ui.css) */}
      <div className="cv-kpis cv-kpis--4 cv-pay-kpis">
        <Kpi label="To verify" value={inr(pending.length)} note={oldest ? `oldest from ${fmtDate(oldest)}` : 'queue is clear'} tone={pending.length ? 'warn' : undefined} />
        <Kpi label="With screenshot" value={inr(withShot)} note={pending.length ? `${pending.length - withShot} UTR-only or not fetched` : 'nothing waiting'} />
        <Kpi label="Flagged" value={inr(flagged)} note="missing proof, test or duplicate UTRs" tone={flagged ? 'warn' : undefined} />
        <Kpi label="Payments received" value={inr(subs.length)} note={`₹${inr(revenue)} incl. GST · ${approved.length} via QR · ${rejected.length} rejected`} />
      </div>
      {!loading && (
        <p className="cv-pay-summary">
          <span><strong>{inr(pending.length)}</strong> to verify</span>
          {flagged > 0 && <span><strong>{inr(flagged)}</strong> flagged</span>}
          {oldest && <span>oldest <strong>{fmtDate(oldest)}</strong></span>}
          <span><strong>{inr(subs.length)}</strong> received · ₹{inr(revenue)}</span>
        </p>
      )}

      <details className="cv-disclosure cv-pay-help">
        <summary><Info size={15} /> How approval works</summary>
        <p>Candidates pay the UPI QR, then upload the screenshot on the website or send it to the WhatsApp bot. Each one lands here. <strong>Approve</strong> after matching the amount and the UPI transaction ID (UTR) in the UPI statement: the candidate is marked paid, the ledger gets the tier amount and they get a WhatsApp confirmation. <strong>Reject</strong> with a reason and the bot asks them for a clearer screenshot.</p>
      </details>

      <Card flush className="cv-pay-queue">
        <div className="cv-tabs-row">
          <div className="cv-tabs" role="tablist">
            {TABS.map((t) => {
              const n = t.id === 'pending' ? pending.length : t.id === 'paid' ? subs.length : utrs.length;
              return <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`cv-tab ${tab === t.id ? 'cv-tab--on' : ''}`} onClick={() => setTab(t.id)}>{t.label}<span className="cv-tab-count">{n}</span></button>;
            })}
          </div>
          <label className="cv-search cv-tabs-search"><Search size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, mobile, transaction ID…" aria-label="Search payments" /></label>
        </div>
        {showTest && (
          <div className="cv-pay-filter">
            <span className="cv-chip">Test proofs only · {inr(utrRows.length)}<button type="button" onClick={clearShow} aria-label="Show all proofs to verify">×</button></span>
            <span className="cv-muted">Their UTR looks made up. Reject each with a reason, or open it if you're unsure.</span>
          </div>
        )}
        {tab === 'paid'
          ? <DataTable columns={subColumns} rows={subRows} rowKey={(r) => `${r.mobile_no}-${r.transaction_id}`} loading={loading} empty={q ? `No payments match “${q}”.` : 'No payments received yet. Approved proofs appear here.'} />
          : <DataTable columns={utrColumns} rows={utrRows} rowKey={(r) => r._id} loading={loading} empty={q ? `No payments match “${q}”.` : tab === 'pending' ? 'Nothing to verify — the queue is clear.' : 'No submissions yet.'} />}
      </Card>

      <Modal open={!!lightbox} title={lightbox ? `${lightbox.row.user_name || 'Candidate'} · ${lightbox.row.mobile_no || ''}` : ''} onClose={() => setLightbox(null)} width={720}>
        {lightbox && (
          <div className="cv-lightbox">
            <div className="cv-lightbox-img"><img src={lbShots[lightbox.i] || lbShots[0]} alt="Payment screenshot" /></div>
            <div className="cv-lightbox-side">
              <dl className="cv-kv">
                <div><dt>Expected</dt><dd>₹{inr(tierFor(lightbox.row.booth_count).total)} for {lightbox.row.booth_count || 1} booth{Number(lightbox.row.booth_count) === 1 ? '' : 's'}</dd></div>
                <div><dt>UPI transaction ID</dt><dd><span className="cv-mono">{lightbox.row.utr || '—'}</span></dd></div>
                <div><dt>Via</dt><dd>{sourcePill(lightbox.row)} {fmtDateTime(lightbox.row.submitted_at)}</dd></div>
                {lightbox.row.caption && <div><dt>Caption</dt><dd>{lightbox.row.caption}</dd></div>}
              </dl>
              {lbShots.length > 1 && <div className="cv-row-actions">{lbShots.map((u, i) => <button key={u} type="button" className={`cv-btn cv-btn--ghost cv-btn--sm ${i === lightbox.i ? 'cv-on' : ''}`} onClick={() => setLightbox({ ...lightbox, i })}>Image {i + 1}</button>)}</div>}
              <a className="cv-btn cv-btn--ghost cv-btn--sm" href={lbShots[lightbox.i] || lbShots[0]} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open full size</a>
              {lightbox.row.status === 'pending' && (
                <div className="cv-modal-actions" style={{ marginTop: 'auto' }}>
                  <Button variant={isTestUtr(lightbox.row.utr) ? 'primary' : 'ghost'} icon={XCircle} className={isTestUtr(lightbox.row.utr) ? 'cv-btn--danger-solid' : 'cv-btn--danger'} onClick={() => { openConfirm(lightbox.row, 'reject'); setLightbox(null); }}>Reject</Button>
                  <Button variant={isTestUtr(lightbox.row.utr) ? 'ghost' : 'primary'} icon={CheckCircle2} onClick={() => { openConfirm(lightbox.row, 'approve'); setLightbox(null); }}>Approve</Button>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!confirm} title={confirm?.done ? (confirm.done.action === 'approve' ? 'Payment approved' : 'Payment rejected') : confirm?.action === 'approve' ? 'Approve this payment?' : 'Reject this payment?'} onClose={() => setConfirm(null)} width={680}>
        {confirm && confirm.done ? (
          <>
            <p className="cv-done"><CheckCircle2 size={18} /> <span><strong>{confirm.done.name}</strong> {confirm.done.action === 'approve' ? 'is marked paid and gets a WhatsApp confirmation with their login.' : 'is asked on WhatsApp for a clearer screenshot.'}</span></p>
            <p className="cv-modal-text">{pending.length ? `${inr(pending.length)} ${pending.length === 1 ? 'payment' : 'payments'} left to verify.` : 'That was the last one. The queue is clear.'}</p>
            <div className="cv-modal-actions">
              <Button variant={nextPending ? 'ghost' : 'primary'} onClick={() => setConfirm(null)} data-autofocus={nextPending ? undefined : true}>Done</Button>
              {nextPending && <Button icon={ArrowRight} onClick={() => openConfirm(nextPending, 'approve')} data-autofocus>Review next ({inr(pending.length)} left)</Button>}
            </div>
          </>
        ) : confirm && (
          <>
            <div className="cv-confirm-proof">
              {shotsOf(confirm.row)[0]
                ? <a className="cv-proof-xl" href={shotsOf(confirm.row)[0]} target="_blank" rel="noreferrer" title="Open full size"><img src={shotsOf(confirm.row)[0]} alt={`Payment screenshot from ${confirm.row.user_name || 'the candidate'}`} /></a>
                : <span className="cv-proof-xl cv-proof-xl--none"><Paperclip size={20} /> {confirm.row.wa_media_id ? 'Screenshot is in the WACTO inbox' : 'No screenshot, UTR only'}</span>}
              <div className="cv-stack-xs">
                <dl className="cv-kv">
                  <div><dt>Payer</dt><dd>{confirm.row.user_name} · <span className="cv-mono">{confirm.row.mobile_no}</span></dd></div>
                  <div><dt>UPI transaction ID</dt><dd><span className="cv-mono">{confirm.row.utr || '—'}</span> {sourcePill(confirm.row)}</dd></div>
                  <div><dt>Expected</dt><dd><strong>₹{inr(tierFor(confirm.row.booth_count).total)}</strong> for {confirm.row.booth_count || 1} booth{Number(confirm.row.booth_count) === 1 ? '' : 's'}{Number(confirm.row.booth_count || 1) > 1 ? ` (${tierFor(confirm.row.booth_count).label} tier)` : ''}</dd></div>
                </dl>
                {confirmChecks.length > 0 && (
                  <ul className="cv-checks cv-checks--stack">{confirmChecks.map((x) => <li key={x.text} className={`cv-check cv-check--${x.tone}`}>{x.tone === 'bad' ? <CircleAlert size={12} /> : <AlertTriangle size={12} />} {x.text}</li>)}</ul>
                )}
              </div>
            </div>
            {confirm.action === 'approve'
              ? <>
                  {/* the tick sits right under the warnings it answers, so on a phone it fits above the pinned buttons with the proof still in view */}
                  {risky && (
                    <label className="cv-tick">
                      <input type="checkbox" checked={!!confirm.matched} onChange={(e) => setConfirm((c) => ({ ...c, matched: e.target.checked }))} data-autofocus />
                      <span>I found this UTR and the amount of ₹{inr(tierFor(confirm.row.booth_count).total)} in the UPI statement, despite the warning above.</span>
                    </label>
                  )}
                  <p className="cv-modal-text">The candidate is marked <strong>paid</strong>, the ledger records ₹{inr(tierFor(confirm.row.booth_count).total)}, and they get a WhatsApp confirmation with their login straight away. This can't be undone here.</p>
                </>
              : <>
                  <p className="cv-modal-text">The submission is marked rejected and the candidate is asked on WhatsApp to send a clearer screenshot.</p>
                  <label className="cv-field"><span className="cv-field-label">Reason (sent to the candidate)</span><Textarea rows={2} value={confirm.reason} onChange={(e) => setConfirm((c) => ({ ...c, reason: e.target.value }))} placeholder="e.g. Amount in the screenshot is ₹2,000 but the plan is ₹2,360" data-autofocus /></label>
                </>}
            {confirm.err && <Alert tone="bad">{confirm.err}</Alert>}
            <div className="cv-modal-actions cv-modal-actions--split">
              <button type="button" className="cv-link cv-link-btn" onClick={() => setConfirm((c) => ({ ...c, action: c.action === 'approve' ? 'reject' : 'approve', err: '' }))}>{confirm.action === 'approve' ? 'Reject instead' : 'Approve instead'}</button>
              <span className="cv-row-actions">
                <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
                {confirm.action === 'approve'
                  ? <Button variant={risky ? 'ghost' : 'primary'} icon={CheckCircle2} onClick={act} disabled={busy || (risky && !confirm.matched)} data-autofocus={risky ? undefined : true}>{busy ? 'Saving…' : 'Approve & mark paid'}</Button>
                  : <Button className="cv-btn--danger-solid" onClick={act} disabled={busy}>{busy ? 'Saving…' : 'Reject & notify'}</Button>}
              </span>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
