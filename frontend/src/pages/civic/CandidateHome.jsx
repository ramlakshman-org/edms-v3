import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, MapPin, Megaphone, BarChart3, Crown, Hourglass, Lock, Sparkles, CircleAlert, Info, Phone, PieChart } from 'lucide-react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import PurchaseModal from '../../components/PurchaseModal.jsx';
import { PageHeader, Card, Pill, Kpi, BarList, inr } from '../../civic/kit.jsx';
import { DataTable, Button, Alert, fmtDate, titleCase } from '../../civic/ui.jsx';

// Candidate home (Civic Ops step 10) for booth-plan candidates (groups 4, 11)
// and the older ward logins (6). GET /ward/home gives the account, booths with
// voter counts and the plan state (sample / payment pending / active);
// GET /payments/check-paid says whether a proof is being verified.

const sampleColumns = [
  { key: 'EPIC_NO', label: 'EPIC', render: (r) => <span className="cv-mono">{r.EPIC_NO}</span> },
  { key: 'VOTER_NAME_EN', label: 'Elector', render: (r) => <div className="cv-two"><strong>{r.VOTER_NAME_EN}</strong>{r.VOTER_NAME && <span className="cv-ta">{r.VOTER_NAME}</span>}</div> },
  { key: 'AGE', label: 'Age', align: 'right' },
  { key: 'GENDER', label: 'Gender' },
  { key: 'PART_NO', label: 'Booth', align: 'right' },
  { key: 'MOBILE_NUMBER', label: 'Mobile', render: (r) => <span className="cv-mono">{r.MOBILE_NUMBER || '—'}</span> },
];

export default function CandidateHome() {
  const { user, updateUserData } = useAuth();
  const [home, setHome] = useState(null);
  const [status, setStatus] = useState({ paid: false, pending: false, pending_since: null });
  const [sample, setSample] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [pay, setPay] = useState(false);

  const load = async () => {
    setLoading(true); setErr('');
    try {
      const [h, c] = await Promise.all([api.get('/ward/home').then((r) => r.data), api.get('/payments/check-paid').then((r) => r.data).catch(() => ({}))]);
      setHome(h);
      setStatus({ paid: !!c?.paid || h?.account?.paid_status === 'Yes', pending: !!c?.pending, pending_since: c?.pending_since || null });
      if ((c?.paid || h?.account?.paid_status === 'Yes') && updateUserData && user?.paid_status !== 'Yes') updateUserData({ paid_status: 'Yes' });
      if (h?.isSample) api.get('/ward/sample-voters', { params: { page: 1, pageSize: 8 } }).then((r) => setSample(r.data?.rows || [])).catch(() => {});
    } catch (e) { setErr(e.response?.data?.message || 'Could not load your campaign home.'); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const onProof = () => setStatus((s) => ({ ...s, pending: true, pending_since: s.pending_since || new Date().toISOString() }));
    const onPaid = () => load();
    window.addEventListener('payment-proof-submitted', onProof);
    window.addEventListener('payment-updated', onPaid);
    return () => { window.removeEventListener('payment-proof-submitted', onProof); window.removeEventListener('payment-updated', onPaid); };
  }, []);

  const acc = home?.account || {};
  // Until the plan is active the API sends only the booth count; list the booths from the login so the candidate still sees them.
  const fallbackBooths = (Array.isArray(user?.booths) ? user.booths : []).map((b) => (typeof b === 'object' && b ? { assembly_no: b.assembly_no || user?.assembly_id, assembly_name: b.assembly_name || user?.assembly_name || `Assembly ${b.assembly_no || user?.assembly_id || ''}`, part_no: b.part_no, booth_name: b.booth_name || `Booth ${b.part_no}`, voter_count: null } : { assembly_no: user?.assembly_id, assembly_name: user?.assembly_name || `Assembly ${user?.assembly_id || ''}`, part_no: b, booth_name: `Booth ${b}`, voter_count: null }));
  const booths = home?.booths?.length ? home.booths : (home?.paymentPending ? fallbackBooths : []);
  const isSample = !!home?.isSample;
  const pendingPay = !!home?.paymentPending && !status.paid;
  const count = booths.length || home?.boothCount || (Array.isArray(user?.booths) ? user.booths.length : 0);
  const voters = booths.reduce((n, b) => n + (Number(b.voter_count) || 0), 0);
  const largest = booths.filter((b) => b.voter_count != null).reduce((m, b) => (!m || (b.voter_count || 0) > (m.voter_count || 0) ? b : m), null);
  const byAssembly = useMemo(() => Object.values(booths.reduce((acc, b) => { const k = b.assembly_no; (acc[k] ||= { label: `${b.assembly_no} — ${b.assembly_name}`, value: 0 }).value += Number(b.voter_count) || 0; return acc; }, {})), [booths]);
  const name = user?.first_name || user?.name || acc.ward_login || 'Candidate';
  const where = [acc.position !== '-' && acc.position, acc.local_body !== '-' && acc.local_body, acc.ward_number !== '-' && acc.ward_number ? `Ward ${acc.ward_number}` : null, acc.district !== '-' && acc.district].filter(Boolean).filter((v, i, a) => a.findIndex((x) => String(x).toLowerCase() === String(v).toLowerCase()) === i).join(' · '); // position often repeats the local body type

  const state = status.paid ? 'active' : isSample ? 'sample' : status.pending ? 'verifying' : pendingPay ? 'unpaid' : 'active';

  const boothColumns = [
    { key: 'part_no', label: 'Booth', align: 'right', render: (b) => <span className="cv-num-strong">{b.part_no}</span> },
    { key: 'booth_name', label: 'Polling station', primary: true, render: (b) => <span className="cv-station" style={{ whiteSpace: 'normal' }}>{b.booth_name ? titleCase(b.booth_name) : '—'}</span> },
    { key: 'assembly_name', label: 'Assembly', render: (b) => <span className="cv-muted">{b.assembly_no} — {b.assembly_name}</span> },
    { key: 'voter_count', label: 'Voters', align: 'right', render: (b) => (b.voter_count == null ? <span className="cv-muted" title="Shown once your plan is active">—</span> : <strong>{inr(b.voter_count)}</strong>) },
    { key: 'go', label: '', render: (b) => <Link className="cv-btn cv-btn--ghost cv-btn--sm" to={`/voters?assemblyId=${b.assembly_no}&boothId=${b.part_no}`}>Voters</Link> },
  ];

  return (
    <div className="cv-page">
      <PageHeader title={`Welcome, ${name}`} subtitle={where || 'Your campaign at a glance'} />
      {err && <Alert tone="bad"><CircleAlert size={16} /> {err}</Alert>}

      {/* Plan state */}
      {!loading && state === 'sample' && (
        <div className="cv-plan-card cv-plan-card--info">
          <Info size={20} />
          <div><strong>No booths assigned yet — you are looking at sample data.</strong><p>Our team assigns the booths from your registration. If this takes more than a day, call support and quote your mobile number.</p></div>
        </div>
      )}
      {!loading && state === 'unpaid' && (
        <div className="cv-plan-card cv-plan-card--warn">
          <Lock size={20} />
          <div><strong>Your {count} booth{count === 1 ? '' : 's'} {count === 1 ? 'is' : 'are'} assigned. Activate your plan to unlock full voter data.</strong><p>Until then mobile numbers are masked. Pay the UPI QR and send the screenshot; we activate within 30 minutes of verification.</p></div>
          <Button icon={Sparkles} onClick={() => setPay(true)}>Activate plan</Button>
        </div>
      )}
      {!loading && state === 'verifying' && (
        <div className="cv-plan-card cv-plan-card--warn">
          <Hourglass size={20} />
          <div><strong>Payment proof received — verification in progress.</strong><p>Our team checks it against the UPI statement{status.pending_since ? ` (sent ${fmtDate(status.pending_since)})` : ''}. Full voter data opens as soon as it is approved.</p></div>
          <Button variant="ghost" onClick={() => setPay(true)}>View status</Button>
        </div>
      )}
      {!loading && state === 'active' && !isSample && (
        <div className="cv-plan-card cv-plan-card--ok">
          <Crown size={20} />
          <div><strong>PRO plan active.</strong><p>{count} booth{count === 1 ? '' : 's'} · {inr(voters)} voters with full details{acc.transaction_id ? ` · ref ${acc.transaction_id}` : ''}.</p></div>
        </div>
      )}

      <div className="cv-kpis cv-kpis--4">
        <Kpi icon={MapPin} label="Booths" value={loading ? '…' : inr(count)} note={isSample ? 'sample' : byAssembly.length > 1 ? `${byAssembly.length} assemblies` : (booths[0]?.assembly_name || 'assigned')} />
        <Kpi icon={Users} label="Voters covered" value={loading ? '…' : state === 'unpaid' || state === 'verifying' ? '—' : inr(voters)} note={isSample ? 'sample data' : state === 'unpaid' || state === 'verifying' ? 'counts unlock with your plan' : 'in your booths'} />
        <Kpi label="Largest booth" value={loading ? '…' : largest ? `#${largest.part_no}` : '—'} note={largest ? `${inr(largest.voter_count)} voters` : ''} />
        <Kpi label="Plan" value={state === 'active' && !isSample ? 'PRO' : state === 'verifying' ? 'Verifying' : state === 'sample' ? 'Preview' : 'Not active'} note={state === 'active' && !isSample ? 'full access' : state === 'verifying' ? 'proof under check' : state === 'sample' ? 'booths pending' : 'activate to unlock'} tone={state === 'active' && !isSample ? undefined : 'warn'} />
      </div>

      <div className="cv-grid-2-1">
        <Card title={isSample ? 'Sample voters' : 'Your booths'} meta={isSample ? '705 fictional records so you can try search and filters' : 'Tap a booth to open its voters'} flush>
          {isSample
            ? <DataTable columns={sampleColumns} rows={sample} rowKey={(r) => r.EPIC_NO} loading={loading} empty="Sample data is loading…" />
            : <DataTable columns={boothColumns} rows={booths} rowKey={(b) => `${b.assembly_no}-${b.part_no}`} loading={loading} empty="No booths assigned yet." />}
        </Card>
        <div className="cv-stack">
          <Card title="Quick actions">
            <div className="cv-stack cv-stack--tight">
              <Link className="cv-btn" to="/voters"><Users size={15} /> Open my voters</Link>
              <Link className="cv-btn cv-btn--ghost" to="/broadcast"><Megaphone size={15} /> SMS · Audio · WhatsApp broadcast</Link>
              <Link className="cv-btn cv-btn--ghost" to="/performance-report"><BarChart3 size={15} /> Performance report</Link>
              <Link className="cv-btn cv-btn--ghost" to="/assembly-analytics"><PieChart size={15} /> Assembly analytics &amp; briefing</Link>
            </div>
          </Card>
          {byAssembly.some((a) => a.value > 0) && <Card title="Voters by assembly"><BarList items={byAssembly} /></Card>}
          <Card title="Need help?">
            <p className="cv-modal-text">Booth changes, payment questions or broadcast pricing: WhatsApp or call the EDMS team.</p>
            <a className="cv-btn cv-btn--ghost" href="tel:+917904759268"><Phone size={15} /> +91 79047 59268</a>
          </Card>
        </div>
      </div>

      <p className="cv-foot"><Pill tone="neutral">Privacy</Pill> Voter data is personal data under the DPDP Act. Use it for your campaign only and never share lists outside your team.</p>

      <PurchaseModal open={pay} onClose={() => setPay(false)} user={user} accountInfo={acc} boothCount={Math.max(1, count)} isSample={isSample} onSuccess={() => { setPay(false); load(); }} />
    </div>
  );
}
