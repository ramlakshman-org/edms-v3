import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { ArrowLeft, Phone, MessageCircle, Pencil, MapPin, BadgeCheck, Mail, Mic, Image as ImageIcon, Download, CircleAlert, Check } from 'lucide-react';
import api from '../../api/client.js';
import { PageHeader, Card, Pill, inr } from '../../civic/kit.jsx';
import { Button, Secret, Modal, KV, Textarea, Alert, fmtDateTime, fmtDate, waLink } from '../../civic/ui.jsx';

const ROLE_LABEL = { planning: 'Planning to contest', confirmed: 'Confirmed candidate', team: 'Campaign team member', functionary: 'Party functionary' };
const paidTone = (s) => (s === 'Yes' ? 'ok' : s === 'No' ? 'neutral' : 'bad');
const paidLabel = (s) => (s === 'Yes' ? 'Paid' : s === 'No' ? 'Unpaid' : `Invalid status (${s})`);
const SERVICE = { sms: { label: 'SMS', icon: Mail }, voice: { label: 'Audio SMS', icon: Mic }, whatsapp: { label: 'WhatsApp', icon: MessageCircle } };
const boothNo = (b) => (typeof b === 'object' ? b.part_no : b);
const boothName = (b) => (typeof b === 'object' ? b.booth_name : '');

export default function RegistrationDetail() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [reg, setReg] = useState(null);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [flash, setFlash] = useState('');

  // Mark paid / unpaid
  const [pay, setPay] = useState({ open: false, saving: false, note: '', err: '' });
  // Assign booths
  const [booths, setBooths] = useState({ open: false, loading: false, saving: false, err: '', list: [], picked: [], q: '' });

  useEffect(() => {
    let alive = true;
    api.get(`/registrations/${id}`)
      .then(({ data }) => { if (!alive) return; if (data.success) { setReg(data.registration); setRequests(data.socialRequests || []); } else setErr(data.message || 'Not found.'); })
      .catch((e) => alive && setErr(e.response?.data?.message || 'Registration not found.'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [id]);

  const setPaid = async (markPaid) => {
    setPay((s) => ({ ...s, saving: true, err: '' }));
    try {
      const { data } = await api.put(`/registrations/${id}/set-paid`, { paid_status: markPaid ? 'Yes' : 'No', note: pay.note });
      if (!data.success) throw new Error(data.message || 'Failed.');
      setReg((r) => ({ ...r, paid_status: data.paid_status, transaction_id: data.transaction_id || r.transaction_id }));
      setPay({ open: false, saving: false, note: '', err: '' });
      setFlash(markPaid ? 'Marked as paid. The candidate now has full access.' : 'Marked as unpaid.');
    } catch (e) {
      setPay((s) => ({ ...s, saving: false, err: e.response?.data?.message || e.message }));
    }
  };

  // arriving from "Assign booths" on the list (?assign=1): open the booth picker once the registration is loaded
  useEffect(() => {
    if (!reg || params.get('assign') !== '1') return;
    const n = new URLSearchParams(params); n.delete('assign'); setParams(n, { replace: true });
    openBooths();
  }, [reg]); // eslint-disable-line react-hooks/exhaustive-deps

  const openBooths = () => {
    const current = (reg.booths || []).map(boothNo);
    setBooths({ open: true, loading: true, saving: false, err: '', list: [], picked: current, q: '' });
    if (!reg.assembly_id) { setBooths((s) => ({ ...s, loading: false, err: 'This registration has no assembly, so booths cannot be listed. Edit the registration first.' })); return; }
    api.get(`/public/booths?assemblyId=${reg.assembly_id}`)
      .then(({ data }) => setBooths((s) => ({ ...s, loading: false, list: data.success ? data.booths || [] : [], err: data.success ? '' : data.message || 'Could not load booths.' })))
      .catch(() => setBooths((s) => ({ ...s, loading: false, err: 'Failed to load booths for this assembly.' })));
  };
  const togglePick = (n) => setBooths((s) => ({ ...s, picked: s.picked.includes(n) ? s.picked.filter((x) => x !== n) : [...s.picked, n] }));
  const saveBooths = async () => {
    setBooths((s) => ({ ...s, saving: true, err: '' }));
    const assembly_no = parseInt(reg.assembly_id, 10);
    const payload = booths.picked.map((n) => ({ assembly_no, assembly_name: reg.assembly_name || '', part_no: n, booth_name: booths.list.find((b) => b.part_no === n)?.booth_name || `Booth ${n}` }));
    try {
      const { data } = await api.put(`/registrations/${id}/assign-booths`, { booths: payload });
      if (!data.success) throw new Error(data.message || 'Save failed.');
      setReg((r) => ({ ...r, booths: data.booths, booth_count: data.booths.length }));
      setBooths((s) => ({ ...s, open: false, saving: false }));
      setFlash(data.message || `${payload.length} booth(s) assigned.`);
    } catch (e) {
      setBooths((s) => ({ ...s, saving: false, err: e.response?.data?.message || e.message }));
    }
  };

  if (loading) return <div className="cv-page"><PageHeader title="Registration" subtitle="Loading…" /></div>;
  if (err || !reg) return <div className="cv-page"><Alert tone="bad"><CircleAlert size={16} /> {err || 'Not found.'}</Alert><Link to="/registrations" className="cv-link"><ArrowLeft size={14} /> Back to registrations</Link></div>;

  const r = reg;
  const name = r.full_name || r.firstname || 'Candidate';
  const boothList = Array.isArray(r.booths) ? r.booths : [];
  const paid = r.paid_status === 'Yes';
  const noRecord = paid && !r.payment; // flagged paid by hand, nothing in the ledger (UX2)
  const visible = booths.list.filter((b) => !booths.q || String(b.part_no).includes(booths.q) || (b.booth_name || '').toLowerCase().includes(booths.q.toLowerCase()));

  return (
    <div className="cv-page">
      <PageHeader
        eyebrow={<Link to="/registrations" className="cv-back"><ArrowLeft size={14} /> Registrations</Link>}
        title={name}
        subtitle={`Registered ${fmtDateTime(r.created_at)}${r.source === 'whatsapp_bot' ? ' · via WhatsApp bot' : ''}`}
        actions={
          <>
            {r.mobile && <a className="cv-btn cv-btn--ghost" href={`tel:${r.mobile}`}><Phone size={15} /> Call</a>}
            {r.mobile && <a className="cv-btn cv-btn--ghost" href={waLink(r.mobile)} target="_blank" rel="noreferrer"><MessageCircle size={15} /> WhatsApp</a>}
            <Button variant="ghost" icon={Pencil} onClick={() => navigate(`/registrations/edit/${id}`)}>Edit</Button>
          </>
        }
      />

      {flash && <Alert tone="ok"><Check size={16} /> {flash}</Alert>}

      <div className="cv-grid cv-grid--2-1">
        <div className="cv-stack">
          <Card title="Candidate">
            <KV items={[
              ['Full name', name],
              ['Mobile', r.mobile ? <span className="cv-mono">{r.mobile}</span> : null],
              ['Passcode', <Secret value={r.passcode} />],
              ['Role', ROLE_LABEL[r.role] || r.role],
              ['Affiliation', r.affiliation === 'affiliated' ? `Party · ${r.party || '—'}` : r.affiliation === 'independent' ? 'Independent' : r.affiliation],
            ]} />
          </Card>

          <Card title="Constituency" action={<Pill tone={r.body_type ? 'info' : 'neutral'}>{r.body_type ? (String(r.body_type).toLowerCase() === 'urban' ? 'Urban local body' : 'Rural local body') : 'Body type not set'}</Pill>}>
            <KV items={[
              ['District', r.district],
              ['Assembly', r.assembly_name ? `${r.assembly_id ? `${r.assembly_id} · ` : ''}${r.assembly_name}` : null],
              ['Position', r.position],
              ['Local body', r.local_body || r.union_or_municipality || r.panchayat_or_corporation],
              ['Ward number', r.ward_number],
            ]} />
          </Card>

          {boothList.length > 100 && <Alert tone="warn"><CircleAlert size={16} /> {inr(boothList.length)} booths assigned — more than the largest plan (100). Worth checking how this was assigned.</Alert>}
          <Card title={`Booths · ${boothList.length}`} meta={r.booth_count ? `Registered for ${r.booth_count} booth${r.booth_count === 1 ? '' : 's'}` : 'No booths assigned yet — the candidate only sees sample data'} action={<Button variant={boothList.length ? 'ghost' : 'primary'} size="sm" icon={MapPin} onClick={openBooths}>{boothList.length ? 'Reassign' : 'Assign booths'}</Button>}>
            {boothList.length ? (
              <ul className="cv-booths">
                {boothList.map((b, i) => <li key={i}><span className="cv-booth-no">#{boothNo(b)}</span><span>{boothName(b) || `Booth ${boothNo(b)}`}</span></li>)}
              </ul>
            ) : <p className="cv-empty">Pick the booths this candidate manages. Their voter list unlocks after booths are assigned and payment is marked.</p>}
          </Card>

          <Card title={`Broadcast requests · ${requests.length}`} meta="SMS, audio and WhatsApp campaigns the candidate asked for">
            {requests.length === 0 ? <p className="cv-empty">No requests yet.</p> : (
              <ul className="cv-requests">
                {requests.map((q, i) => {
                  const s = SERVICE[q.service_type] || { label: q.service_type, icon: Mail };
                  const Icon = s.icon;
                  return (
                    <li key={q._id || i}>
                      <div className="cv-req-head">
                        <Pill tone="info"><Icon size={12} /> {s.label}{q.language ? ` · ${q.language}` : ''}</Pill>
                        <Pill tone={/pending|awaiting|processing/i.test(q.status || '') ? 'warn' : /sent|done|completed/i.test(q.status || '') ? 'ok' : 'neutral'} dot>{q.status || 'Pending'}</Pill>
                        <span className="cv-muted">{fmtDateTime(q.created_at)}</span>
                      </div>
                      <div className="cv-req-meta">Audience: {q.all_voters ? 'all voters' : `booth ${q.booth_no || '—'}${q.section_no ? `, section ${q.section_no}` : ''}`}</div>
                      {q.message_content && <p className="cv-req-msg">{q.message_content}</p>}
                      <div className="cv-req-media">
                        {q.image_url && <a href={q.image_url} target="_blank" rel="noreferrer" className="cv-link"><ImageIcon size={13} /> Image</a>}
                        {q.audio_url && <a href={q.audio_url} target="_blank" rel="noreferrer" className="cv-link"><Download size={13} /> Audio</a>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <div className="cv-stack">
          <Card title="Payment" action={noRecord ? <Pill tone="warn" dot>Marked paid · no payment record</Pill> : <Pill tone={paidTone(r.paid_status)} dot>{paidLabel(r.paid_status)}</Pill>}>
            <KV items={[
              ['Transaction', r.transaction_id ? <span className="cv-mono">{r.transaction_id}</span> : null],
              ['Amount', r.payment?.amount != null ? `₹${inr(r.payment.amount)}` : null],
              ['Paid on', r.payment?.created_at ? fmtDate(r.payment.created_at) : null],
              ['Booths covered', r.payment?.booth_count ?? (boothList.length || null)],
            ]} />
            <div className="cv-actions">
              {paid
                ? <Button variant="ghost" onClick={() => setPay({ open: true, saving: false, note: '', err: '' })}>Mark as unpaid</Button>
                : <Button icon={BadgeCheck} onClick={() => setPay({ open: true, saving: false, note: '', err: '' })}>Mark as paid</Button>}
            </div>
            <p className="cv-hint">Candidates pay by UPI QR and share proof on WhatsApp. Marking paid unlocks voter data for their booths.</p>
          </Card>

          <Card title="Access">
            <KV items={[
              ['Username', r.mobile ? <span className="cv-mono">{r.mobile}</span> : null],
              ['Passcode', <Secret value={r.passcode} />],
              ['Voter data', paid && boothList.length ? <Pill tone="ok" dot>Unlocked</Pill> : <Pill tone="warn" dot>{boothList.length ? 'Waiting for payment' : paid ? 'Sample only · assign booths to unlock' : 'Sample only'}</Pill>],
            ]} />
          </Card>
        </div>
      </div>

      <Modal open={pay.open} title={paid ? 'Mark as unpaid' : 'Mark as paid'} onClose={() => setPay((s) => ({ ...s, open: false }))}>
        <p className="cv-modal-text">{paid ? `${name} will lose access to voter data for their booths.` : `${name} will get full access to voter data for ${boothList.length || 'their'} booth${boothList.length === 1 ? '' : 's'}. Use this after checking the UPI payment proof.`}</p>
        <label className="cv-field"><span className="cv-field-label">Note (optional)</span><Textarea rows={2} value={pay.note} onChange={(e) => setPay((s) => ({ ...s, note: e.target.value }))} placeholder="e.g. UTR 4123… verified in GPay statement" /></label>
        {pay.err && <Alert tone="bad">{pay.err}</Alert>}
        <div className="cv-modal-actions">
          <Button variant="ghost" onClick={() => setPay((s) => ({ ...s, open: false }))}>Cancel</Button>
          <Button onClick={() => setPaid(!paid)} disabled={pay.saving}>{pay.saving ? 'Saving…' : paid ? 'Confirm unpaid' : 'Confirm paid'}</Button>
        </div>
      </Modal>

      <Modal open={booths.open} title={`Assign booths · ${r.assembly_name || 'assembly not set'}`} onClose={() => setBooths((s) => ({ ...s, open: false }))} width={640}>
        {booths.err && <Alert tone="bad">{booths.err}</Alert>}
        {!booths.err && (
          <>
            <div className="cv-booth-pick-head">
              <label className="cv-search"><input value={booths.q} onChange={(e) => setBooths((s) => ({ ...s, q: e.target.value }))} placeholder="Filter by booth number or name" aria-label="Filter booths" /></label>
              <span className="cv-muted">{booths.picked.length} selected</span>
            </div>
            <div className="cv-booth-pick">
              {booths.loading ? <p className="cv-empty">Loading booths…</p> : visible.map((b) => (
                <label key={b.part_no} className={`cv-booth-opt ${booths.picked.includes(b.part_no) ? 'cv-booth-opt--on' : ''}`}>
                  <input type="checkbox" checked={booths.picked.includes(b.part_no)} onChange={() => togglePick(b.part_no)} />
                  <span className="cv-booth-no">#{b.part_no}</span>
                  <span>{b.booth_name}</span>
                </label>
              ))}
              {!booths.loading && visible.length === 0 && <p className="cv-empty">No booths match.</p>}
            </div>
            <div className="cv-modal-actions">
              <Button variant="ghost" onClick={() => setBooths((s) => ({ ...s, open: false }))}>Cancel</Button>
              <Button onClick={saveBooths} disabled={booths.saving || booths.loading}>{booths.saving ? 'Saving…' : `Save ${booths.picked.length} booth${booths.picked.length === 1 ? '' : 's'}`}</Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
