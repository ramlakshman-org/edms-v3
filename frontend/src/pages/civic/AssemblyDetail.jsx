import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, KeyRound, CircleAlert, CheckCircle2, Users, MapPin, PieChart, Database } from 'lucide-react';
import api from '../../api/client.js';
import { PageHeader, Card, Pill, Skeleton, inr } from '../../civic/kit.jsx';
import { Alert, Button, Secret } from '../../civic/ui.jsx';

// Assembly detail (Super Admin), Civic Ops design. Same APIs as the old page:
// GET /assemblies/:no → { assembly, liveCounts } · GET /assembly-credentials
// POST /assembly-credentials/:no/generate (only offered when no login exists yet).
const ROWS = [
  { key: 'total', label: 'Total voters', stored: (a) => a.total_voters },
  { key: 'male', label: 'Male', stored: (a) => a.male_voters },
  { key: 'female', label: 'Female', stored: (a) => a.female_voters },
  { key: 'other', label: 'Other', stored: (a) => a.third_gender_voters ?? a.other_voters },
];

export default function AssemblyDetail() {
  const { no } = useParams();
  const [d, setD] = useState(null);
  const [cred, setCred] = useState(null);
  const [err, setErr] = useState('');
  const [created, setCreated] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => Promise.all([
    api.get(`/assemblies/${no}`),
    api.get('/assembly-credentials').catch(() => ({ data: { rows: [] } })),
  ]).then(([a, c]) => {
    setD(a.data);
    setCred((c.data.rows || []).find((r) => String(r.assembly_no) === String(no)) || null);
  }).catch((e) => setErr(e.response?.data?.message || 'Could not load this assembly.')), [no]);

  useEffect(() => { setD(null); setErr(''); setCreated(null); load(); }, [load]);

  const generate = async () => {
    setErr(''); setBusy(true);
    try {
      const { data } = await api.post(`/assembly-credentials/${no}/generate`);
      if (data.success) { setCreated(data); await load(); } else setErr(data.message || 'Could not create the login.');
    } catch (e) {
      setErr(e.response?.data?.message || 'Could not create the login.');
    } finally { setBusy(false); }
  };

  const a = d?.assembly;
  const live = d?.liveCounts;
  const hasCred = !!(cred?.username && cred?.passcode);
  const diffs = a && live ? ROWS.map((r) => ({ ...r, s: Number(r.stored(a) || 0), l: Number(live[r.key] || 0) })) : [];
  const mismatch = diffs.filter((r) => r.s !== r.l).length;

  return (
    <div className="cv-page">
      <PageHeader
        eyebrow={<Link to="/assemblies" className="cv-back"><ArrowLeft size={13} /> Assembly logins</Link>}
        title={a ? `${a.assembly_no} — ${a.assembly_name}` : `Assembly ${no}`}
        subtitle={a ? `${a.district || 'District not set'} · ${inr(a.total_voters)} voters on record` : err ? '' : 'Loading…'}
      />
      {err && <Alert tone="bad"><CircleAlert size={16} /> {err}</Alert>}
      {/* nothing loaded (e.g. no such assembly): only the message and the way back, no login or shortcut cards */}
      {err && !d ? <p className="cv-empty"><Link to="/assemblies" className="cv-link">Back to assembly logins</Link></p> : (<>

      <div className="cv-grid cv-grid--1-1">
        <Card title="Assembly login" meta="Used by the MLA / assembly team to sign in">
          {!d && !err ? <Skeleton h={96} /> : (
            <>
              {created && (
                <Alert tone="ok"><CheckCircle2 size={16} /> Login created. Share it with the assembly team now: username <strong>{created.username}</strong>, passcode below.</Alert>
              )}
              {hasCred ? (
                <dl className="cv-kv">
                  <div><dt>Username</dt><dd className="cv-mono">{cred.username}</dd></div>
                  <div><dt>Passcode</dt><dd><Secret value={cred.passcode} /></dd></div>
                  <div><dt>Status</dt><dd><Pill tone="ok" dot>Active</Pill></dd></div>
                </dl>
              ) : (
                <div className="cv-empty-cta">
                  <p className="cv-muted">No login has been created for this assembly yet.</p>
                  <Button icon={KeyRound} onClick={generate} disabled={busy}>{busy ? 'Creating…' : 'Create login'}</Button>
                </div>
              )}
            </>
          )}
        </Card>

        <Card title="Shortcuts" meta="Everything for this assembly">
          <div className="cv-link-list">
            <Link to={`/assembly-analytics?ac=${no}`} className="cv-btn cv-btn--ghost"><PieChart size={15} /> Assembly analytics</Link>
            <Link to={`/booths?ac=${no}`} className="cv-btn cv-btn--ghost"><MapPin size={15} /> Booths</Link>
            <Link to={`/voters?ac=${no}`} className="cv-btn cv-btn--ghost"><Users size={15} /> Voters</Link>
            <Link to="/assemblies?tab=booth" className="cv-btn cv-btn--ghost"><KeyRound size={15} /> Booth logins</Link>
          </div>
        </Card>
      </div>

      <Card
        title="Voter counts"
        meta={a ? <>On record vs the live voter roll · collection <span className="cv-mono">{a.table_name || `ass_${a.assembly_no}`}</span></> : ''}
        action={live ? (mismatch ? <Pill tone="warn" dot>{mismatch} of 4 differ</Pill> : <Pill tone="ok" dot>All match</Pill>) : null}
      >
        {!d ? <Skeleton h={150} /> : !live ? (
          <Alert tone="warn"><Database size={16} /> The voter database is not reachable, so live counts are unavailable. Showing the counts on record only.</Alert>
        ) : null}
        {/* the table scrolls inside its own box on a narrow phone (live 6-digit counts pushed it past the edge) */}
        {a && (
          <div className="cv-table-wrap">
          <table className="cv-table cv-table--plain cv-counts">
            <thead><tr><th>Group</th><th className="cv-num">On record</th>{live && <><th className="cv-num">Live roll</th><th className="cv-num">Difference</th></>}</tr></thead>
            <tbody>
              {(live ? diffs : ROWS.map((r) => ({ ...r, s: Number(r.stored(a) || 0) }))).map((r) => {
                const delta = live ? r.l - r.s : 0;
                return (
                  <tr key={r.key}>
                    <td>{r.label}</td>
                    <td className="cv-num">{inr(r.s)}</td>
                    {live && <>
                      <td className="cv-num">{inr(r.l)}</td>
                      <td className="cv-num">{delta === 0 ? <span className="cv-muted">—</span> : <span className={delta > 0 ? 'cv-delta-up' : 'cv-delta-down'}>{delta > 0 ? '+' : '−'}{inr(Math.abs(delta))}</span>}</td>
                    </>}
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
        {live && mismatch > 0 && <p className="cv-hint" style={{ marginTop: 10 }}>The counts on record come from the assembly table; the live roll is counted from the voter collection now. A difference usually means the roll was updated after the record was saved.</p>}
      </Card>
      </>)}
    </div>
  );
}
