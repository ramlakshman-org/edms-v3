import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, MapPin, Megaphone, BarChart3, Crown, Hourglass, Lock, Sparkles, CircleAlert, Info, Phone, PieChart, TrendingUp, ArrowRight } from 'lucide-react';
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

  // Feature 1 & 2: Demographics (Women vs Men & Age Cohorts)
  const demo = home?.demographics || (isSample ? home?.sample?.demographics : null);
  const totalDemoVoters = demo?.total || voters || (isSample ? 705 : 0);
  const femaleCount = demo?.female || (isSample ? 353 : 0);
  const maleCount = demo?.male || (isSample ? 352 : 0);
  const femalePct = totalDemoVoters ? Math.round((femaleCount / totalDemoVoters) * 100) : 50;
  const malePct = totalDemoVoters ? Math.round((maleCount / totalDemoVoters) * 100) : 50;

  const youthCount = demo?.youth || (isSample ? 205 : 0);
  const middleCount = demo?.middle || (isSample ? 272 : 0);
  const seniorCount = demo?.senior || (isSample ? 228 : 0);
  const youthPct = totalDemoVoters ? Math.round((youthCount / totalDemoVoters) * 100) : 0;
  const middlePct = totalDemoVoters ? Math.round((middleCount / totalDemoVoters) * 100) : 0;
  const seniorPct = totalDemoVoters ? Math.round((seniorCount / totalDemoVoters) * 100) : 0;

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

      {/* Crucial Political Insights: Women vs Men Voter Ratio & Age Demographics */}
      {(demo || isSample || state === 'active') && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, margin: '16px 0' }}>
          {/* Feature 1: Women vs Men Voter Balance */}
          <Card title="Gender Distribution" meta={isSample ? 'Sample preview' : state === 'unpaid' ? 'Locked · Preview mode' : 'Elector balance across assigned booths'}>
            <div style={{ display: 'grid', gap: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#db2777' }} />
                    Female Electors
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', marginTop: 4 }}>
                    {loading ? '…' : state === 'unpaid' ? '—' : inr(femaleCount)}
                    <span style={{ fontSize: 13, fontWeight: 500, color: '#64748b', marginLeft: 6 }}>
                      ({state === 'unpaid' ? '52%' : `${femalePct}%`})
                    </span>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#2563eb' }} />
                    Male Electors
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', marginTop: 4 }}>
                    {loading ? '…' : state === 'unpaid' ? '—' : inr(maleCount)}
                    <span style={{ fontSize: 13, fontWeight: 500, color: '#64748b', marginLeft: 6 }}>
                      ({state === 'unpaid' ? '48%' : `${malePct}%`})
                    </span>
                  </div>
                </div>
              </div>

              {state === 'unpaid' ? (
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '14px', textAlign: 'center' }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#334155', marginBottom: 4 }}>
                    Demographic Intelligence Locked
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
                    Activate your plan to unlock the verified gender distribution and age cohorts across your {count} assigned booths.
                  </div>
                  <Button size="sm" icon={Sparkles} onClick={() => setPay(true)}>Activate Plan to Unlock</Button>
                </div>
              ) : (
                <>
                  {/* Refined dual-color visual balance bar */}
                  <div style={{ width: '100%', height: 8, borderRadius: 4, background: '#f1f5f9', display: 'flex', overflow: 'hidden' }}>
                    <div style={{ width: `${femalePct}%`, background: '#db2777', transition: 'width 0.4s ease' }} title={`Female: ${femalePct}%`} />
                    <div style={{ width: `${malePct}%`, background: '#2563eb', transition: 'width 0.4s ease' }} title={`Male: ${malePct}%`} />
                  </div>

                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 12px', fontSize: 12.5, color: '#334155', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <TrendingUp size={15} style={{ color: '#2563eb', marginTop: 2, flexShrink: 0 }} />
                    <div>
                      <strong>Strategic Note:</strong> {femaleCount > maleCount
                        ? `Female electors hold a majority (+${inr(femaleCount - maleCount)} votes). Direct booth committees to prioritize door-to-door engagement with women-centric welfare schemes.`
                        : maleCount > femaleCount
                        ? `Male electors hold a majority (+${inr(maleCount - femaleCount)} votes). Balance ground canvassing across core employment and local civic touchpoints.`
                        : `Equal gender balance (50% Female / 50% Male). Balance door-to-door canvassing evenly across both voter segments.`}
                    </div>
                  </div>
                </>
              )}
            </div>
          </Card>

          {/* Feature 2: Age Cohorts (Youth vs Working vs Seniors) */}
          <Card title="Elector Age Cohorts" meta={state === 'unpaid' ? 'Locked · Preview mode' : 'Key demographic targets for campaign outreach'}>
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, textAlign: 'center' }}>
                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 6px' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#059669', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                    Youth (18–35)
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#0f172a' }}>
                    {loading ? '…' : state === 'unpaid' ? '—' : inr(youthCount)}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                    {state === 'unpaid' ? '34%' : `${youthPct}%`} share
                  </div>
                </div>

                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 6px' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#0284c7', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                    Core (36–59)
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#0f172a' }}>
                    {loading ? '…' : state === 'unpaid' ? '—' : inr(middleCount)}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                    {state === 'unpaid' ? '48%' : `${middlePct}%`} share
                  </div>
                </div>

                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 6px' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#d97706', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                    Seniors (60+)
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#0f172a' }}>
                    {loading ? '…' : state === 'unpaid' ? '—' : inr(seniorCount)}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                    {state === 'unpaid' ? '18%' : `${seniorPct}%`} share
                  </div>
                </div>
              </div>

              {state === 'unpaid' ? (
                <div style={{ textAlign: 'center', marginTop: 2 }}>
                  <Button size="sm" variant="ghost" onClick={() => setPay(true)}>Activate to view voter lists by age cohort</Button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                  <Link
                    to="/voters?min_age=18&max_age=35"
                    className="cv-btn cv-btn--ghost cv-btn--sm"
                    style={{ flex: 1, fontSize: 11.5, textAlign: 'center', justifyContent: 'center', gap: 6 }}
                  >
                    <span>View Youth (18–35)</span>
                    <ArrowRight size={12} />
                  </Link>
                  <Link
                    to="/voters?min_age=60"
                    className="cv-btn cv-btn--ghost cv-btn--sm"
                    style={{ flex: 1, fontSize: 11.5, textAlign: 'center', justifyContent: 'center', gap: 6 }}
                  >
                    <span>View Seniors (60+)</span>
                    <ArrowRight size={12} />
                  </Link>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

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
