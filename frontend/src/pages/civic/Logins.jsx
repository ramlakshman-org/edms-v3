import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Search, KeyRound, RefreshCw, Check, CircleAlert, Download, Info } from 'lucide-react';
import api from '../../api/client.js';
import { PageHeader, Card, Pill, Kpi, inr } from '../../civic/kit.jsx';
import { DataTable, Pager, Select, Button, Modal, Alert, Secret, csvOf, download } from '../../civic/ui.jsx';

// Assembly access (Civic Ops step 6): one login per assembly — the MLA / whole-assembly plan.
// APIs: GET /assemblies, GET /assembly-credentials, POST /assembly-credentials/:no/generate.
// Passcodes are hidden by default.
// Round 1 (Ram, 2026-10-14): the Booth logins tab is gone. Booth logins (group 4) are not part of
// the product — a candidate's own booths cover that — and the 30,539 rows stay dormant until the
// clean-up phase deletes them. GET/POST /booth-logins remain on the backend for the old frontend.
const PAGE_SIZE = 40;

export default function Logins() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page') || 1));
  const q = params.get('q') || '';
  const status = params.get('status') || '';
  const [draft, setDraft] = useState(q);
  const [assemblies, setAssemblies] = useState([]);
  const [creds, setCreds] = useState({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [flash, setFlash] = useState('');
  const [confirm, setConfirm] = useState(null); // { no, name, existing }
  const [busy, setBusy] = useState(false);

  const setP = (patch) => { const n = new URLSearchParams(params); Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k))); setParams(n); };

  const real = (v) => v != null && String(v).trim() !== '' && String(v).trim() !== '-';
  const load = async () => {
    setLoading(true); setErr('');
    try {
      const [a, c] = await Promise.all([
        api.get('/assemblies').then((r) => r.data.assemblies || []),
        api.get('/assembly-credentials').then((r) => r.data.rows || []).catch(() => []),
      ]);
      setAssemblies(a);
      // The live API lists every assembly and uses '-' when no login exists yet.
      setCreds(Object.fromEntries(c.filter((r) => real(r.username) && real(r.passcode)).map((r) => [String(r.assembly_no), r])));
    } catch (e) {
      setErr(e.response?.data?.message || 'Could not load assemblies.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const assemblyRows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return assemblies
      .map((a) => ({ ...a, cred: creds[String(a.assembly_no)] }))
      .filter((a) => (!status || (status === 'yes') === !!a.cred) && (!t || String(a.assembly_no) === t || a.assembly_name.toLowerCase().includes(t) || (a.district || '').toLowerCase().includes(t) || (a.cred?.username || '').toLowerCase().includes(t)));
  }, [assemblies, creds, q, status]);
  const withCreds = assemblies.filter((a) => creds[String(a.assembly_no)]).length;
  const pageRows = assemblyRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const run = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/assembly-credentials/${confirm.no}/generate`);
      setFlash(`${confirm.existing ? 'New passcode issued' : 'Login created'} for ${confirm.no} — ${confirm.name}.`);
      setCreds((c) => ({ ...c, [String(confirm.no)]: { assembly_no: confirm.no, username: data.username, passcode: data.passcode } }));
      setConfirm(null);
    } catch (e) {
      setConfirm((c) => ({ ...c, err: e.response?.data?.message || 'Could not generate the login.' }));
    } finally {
      setBusy(false);
    }
  };

  const exportAssembly = () => download('assembly-logins.csv', csvOf(assemblyRows.filter((a) => a.cred).map((a) => ({ assembly_no: a.assembly_no, assembly_name: a.assembly_name, district: a.district, username: a.cred.username, passcode: a.cred.passcode })), ['assembly_no', 'assembly_name', 'district', 'username', 'passcode']));

  const assemblyColumns = [
    { key: 'assembly_no', label: 'AC', align: 'right', render: (a) => <span className="cv-num-strong">{a.assembly_no}</span> },
    { key: 'assembly_name', label: 'Assembly', primary: true, render: (a) => <div className="cv-two"><Link to={`/assemblies/${a.assembly_no}`} className="cv-link"><strong>{a.assembly_name}</strong></Link><span className="cv-muted">{a.district || ''}{a.total_voters ? ` · ${inr(a.total_voters)} voters` : ''}</span></div> },
    { key: 'status', label: 'Login', render: (a) => (a.cred ? <Pill tone="ok">Yes</Pill> : <Pill tone="neutral">None</Pill>) },
    { key: 'username', label: 'Username', render: (a) => (a.cred ? <span className="cv-mono">{a.cred.username}</span> : <span className="cv-muted">—</span>) },
    { key: 'passcode', label: 'Passcode', render: (a) => (a.cred ? <Secret value={a.cred.passcode} /> : <span className="cv-muted">—</span>) },
    { key: 'actions', label: '', render: (a) => (
      <span className="cv-row-actions">
        <Button size="sm" variant="ghost" icon={a.cred ? RefreshCw : KeyRound} onClick={() => setConfirm({ no: a.assembly_no, name: a.assembly_name, existing: !!a.cred })}>{a.cred ? 'Regenerate' : 'Create login'}</Button>
      </span>
    ) },
  ];

  return (
    <div className="cv-page">
      <PageHeader title="Assembly access" subtitle="One login per assembly for the whole-assembly (MLA) plan · passcodes are hidden until you reveal them" actions={<Button variant="ghost" icon={RefreshCw} onClick={load} disabled={loading}>Refresh</Button>} />

      {err && <Alert tone="bad"><CircleAlert size={16} /> {err}</Alert>}
      {flash && <Alert tone="ok"><Check size={16} /> {flash}</Alert>}

      <div className="cv-kpis cv-kpis--3 cv-kpis--line">
        <Kpi label="Assemblies" value={inr(assemblies.length)} note="one login each" />
        <Kpi label="With a login" value={inr(withCreds)} note={`${inr(assemblies.length - withCreds)} without a login`} tone={withCreds < assemblies.length ? 'warn' : undefined} />
        <Kpi label="Passcodes" value="Hidden" note="reveal or copy per row; export only when needed" />
      </div>

      <Card flush>
        <form className="cv-filters" onSubmit={(e) => { e.preventDefault(); setP({ q: draft, page: '' }); }}>
          <label className="cv-search cv-filters-search"><Search size={15} /><input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Assembly, district, username or AC number…" aria-label="Search" /></label>
          <Select value={status} onChange={(e) => setP({ status: e.target.value, page: '' })} aria-label="Login status"><option value="">All</option><option value="yes">Has login</option><option value="no">No login</option></Select>
          <Button type="submit">Search</Button>
          <span className="cv-filters-right"><Button variant="ghost" icon={Download} onClick={exportAssembly} disabled={!withCreds}>Export CSV</Button></span>
        </form>
        <DataTable columns={assemblyColumns} rows={pageRows} rowKey={(a) => a.assembly_no} loading={loading} empty="No assemblies match." />
        <Pager page={page} pageSize={PAGE_SIZE} total={assemblyRows.length} onPage={(p) => setP({ page: String(p) })} />
      </Card>

      <p className="cv-foot"><Info size={14} /> An assembly login sees its whole assembly: analytics, voters, booth report and the two documents. Regenerating issues a new passcode and the old one stops working immediately.</p>

      <Modal open={!!confirm} title={confirm?.existing ? 'Regenerate assembly login?' : 'Create assembly login?'} onClose={() => setConfirm(null)}>
        {confirm && (
          <>
            <p className="cv-modal-text">
              {confirm.existing ? `A new passcode will be issued for ${confirm.no} — ${confirm.name}. The old passcode stops working immediately.` : `A username and passcode will be created for ${confirm.no} — ${confirm.name}.`}
            </p>
            {confirm.err && <Alert tone="bad"><CircleAlert size={16} /> {confirm.err}</Alert>}
            <div className="cv-modal-actions">
              <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
              <Button onClick={run} disabled={busy}>{busy ? 'Working…' : confirm.existing ? 'Regenerate' : 'Create'}</Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
