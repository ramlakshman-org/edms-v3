import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Search, MapPin, Download, Landmark, PieChart } from 'lucide-react';
import api from '../../api/client.js';
import { PageHeader, Card, Pill, Kpi, inr } from '../../civic/kit.jsx';
import { DataTable, Pager, Select, Button, boothFirst } from '../../civic/ui.jsx';

// Booths (Civic Ops step 7). GET /assemblies · GET /booths?assemblyId → {booths:[{part_no, booth_name, section_name, has_coords}]}
const PAGE_SIZE = 50;
const csv = (rows) => ['part_no,booth_name,section_name,gps', ...rows.map((b) => [b.part_no, `"${String(b.booth_name || '').replace(/"/g, '""')}"`, `"${String(b.section_name || '').replace(/"/g, '""')}"`, b.has_coords ? 'yes' : 'no'].join(','))].join('\n');

export default function Booths() {
  const [params, setParams] = useSearchParams();
  const ac = params.get('ac') || '';
  const q = params.get('q') || '';
  const gps = params.get('gps') || '';
  const page = Math.max(1, Number(params.get('page') || 1));
  const [draft, setDraft] = useState(q);
  const [assemblies, setAssemblies] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { setDraft(q); }, [q]);
  useEffect(() => { api.get('/assemblies').then(({ data }) => setAssemblies(data.assemblies || [])).catch(() => setErr('Could not load the assembly list.')); }, []);
  useEffect(() => {
    if (!ac) { setRows([]); return undefined; }
    let alive = true;
    setLoading(true); setErr('');
    api.get('/booths', { params: { assemblyId: ac } })
      .then(({ data }) => alive && setRows(data.booths || data.rows || []))
      .catch((e) => alive && setErr(e.response?.data?.message || 'Could not load booths.'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [ac]);

  const setP = (patch) => { const n = new URLSearchParams(params); Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k))); setParams(n); };
  const assembly = assemblies.find((a) => String(a.assembly_no) === ac);
  const filtered = useMemo(() => { const t = q.trim().toLowerCase(); return rows.filter((b) => (!gps || (gps === 'yes') === !!b.has_coords) && (!t || String(b.part_no) === t || (b.booth_name || '').toLowerCase().includes(t) || (b.section_name || '').toLowerCase().includes(t))).sort(boothFirst(t)); }, [rows, q, gps]);
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const located = rows.filter((b) => b.has_coords).length;

  const columns = [
    { key: 'part_no', label: 'Part', align: 'right', render: (b) => <span className="cv-num-strong">{b.part_no}</span> },
    { key: 'booth_name', label: 'Polling station', primary: true, render: (b) => <span style={{ whiteSpace: 'normal' }}>{b.booth_name || '—'}</span> },
    { key: 'section_name', label: 'Section', render: (b) => <span style={{ whiteSpace: 'normal' }}>{b.section_name || '—'}</span> },
    { key: 'has_coords', label: 'GPS', render: (b) => (b.has_coords ? <Pill tone="ok" dot>Located</Pill> : <Pill tone="warn" dot>Missing</Pill>) },
    { key: 'go', label: '', render: (b) => <Link className="cv-btn cv-btn--ghost cv-btn--sm" to={`/voters?assemblyId=${ac}&boothId=${b.part_no}`}>Voters</Link> },
  ];

  return (
    <div className="cv-page">
      <PageHeader
        title="Booths"
        subtitle={assembly ? `${assembly.assembly_no} — ${assembly.assembly_name}${assembly.district ? ` · ${assembly.district}` : ''} · ${inr(rows.length)} polling booths` : 'Pick an assembly to list its polling booths'}
        actions={ac && rows.length ? <><Link className="cv-btn cv-btn--ghost" to={`/assembly-analytics?ac=${ac}`}><PieChart size={15} /> Analytics</Link><Button variant="ghost" icon={Download} onClick={() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv(filtered)], { type: 'text/csv' })); a.download = `booths-ac${ac}.csv`; a.click(); }}>Export CSV</Button></> : null}
      />
      {ac && rows.length > 0 && (
        <div className="cv-kpis cv-kpis--4 cv-kpis--line">
          <Kpi label="Booths" value={inr(rows.length)} note="polling stations in the roll" />
          <Kpi label="GPS located" value={inr(located)} note={`${Math.round((located / rows.length) * 100)}% on the map`} />
          <Kpi label="GPS missing" value={inr(rows.length - located)} note="not on the map yet" tone={rows.length - located ? 'warn' : undefined} />
          <Kpi label="Voters" value={assembly?.total_voters ? inr(assembly.total_voters) : '—'} note="in this assembly" />
        </div>
      )}
      <Card flush>
        <form className="cv-filters" onSubmit={(e) => { e.preventDefault(); setP({ q: draft, page: '' }); }}>
          <Select value={ac} onChange={(e) => setP({ ac: e.target.value, page: '', q: '' })} aria-label="Assembly" className="cv-filters-assembly">
            <option value="">Select assembly</option>
            {assemblies.map((a) => <option key={a.assembly_no} value={a.assembly_no}>{a.assembly_no} — {a.assembly_name}</option>)}
          </Select>
          <Select value={gps} onChange={(e) => setP({ gps: e.target.value, page: '' })} aria-label="GPS status"><option value="">All booths</option><option value="yes">GPS located</option><option value="no">GPS missing</option></Select>
          <label className="cv-search cv-filters-search"><Search size={15} /><input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Part number, station or section…" aria-label="Search" /></label>
          <Button type="submit" disabled={!ac}>Search</Button>
        </form>
        {err && <div className="cv-alert cv-alert--bad" style={{ margin: 16 }}>{err}</div>}
        {!ac ? <div className="cv-table-empty"><Landmark size={20} /> Choose an assembly to see its polling booths and GPS status.</div> : (
          <>
            <DataTable columns={columns} rows={pageRows} rowKey={(b) => b.part_no} loading={loading} empty="No booths match." />
            <Pager page={page} pageSize={PAGE_SIZE} total={filtered.length} onPage={(p) => setP({ page: String(p) })} />
          </>
        )}
      </Card>
      <p className="cv-foot"><MapPin size={14} /> GPS comes from the voter roll's polling-station coordinates; booths marked missing can still be used, they just don't appear on the map.</p>
    </div>
  );
}
