import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, FileText, Search, Landmark, CircleAlert, Users, Lock } from 'lucide-react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Kpi, Skeleton, inr } from '../../civic/kit.jsx';
import { DataTable, Pager, Select, Alert, Button, boothFirst } from '../../civic/ui.jsx';

// Booth report (admin + MLA: /booth-report) and Performance report (candidates:
// /performance-report), Civic Ops design. Same APIs as the old page:
// GET /reports/booth[?assemblyId] · GET /reports/booth-report-list[?assemblyId].
// Admins choose the assembly (?ac=); everyone else gets the scope their login allows.
const PAGE = 40;
const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : '—');
const boothUrl = (no, part) => '/report-files/' + ['Booth_Reports', `ASS ${no} Booth Reports`, `Booth_${part}_Report.html`].map(encodeURIComponent).join('/');

export default function BoothReport({ title = 'Booth report' }) {
  const { user } = useAuth();
  const group = Number(user?.group_id || user?.user_group_id || 0);
  const isAdmin = group === 1;
  // Ram, 2026-10-13: an unpaid candidate sees their booth list (a preview of what the plan covers) but no
  // voter numbers and no booth reports, matching Home's "counts unlock with your plan". Screen only: the
  // API still sends the numbers until the backend masks them for unpaid logins.
  const locked = [4, 6, 11].includes(group) && user?.paid_status !== 'Yes';
  const [params, setParams] = useSearchParams();
  const ac = isAdmin ? params.get('ac') || '' : 'mine';
  const q = params.get('q') || '';
  const page = Math.max(1, Number(params.get('page') || 1));
  const openPart = params.get('booth');

  const [assemblies, setAssemblies] = useState([]);
  const [data, setData] = useState(null);
  const [htmlBooths, setHtmlBooths] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const setP = (patch) => { const n = new URLSearchParams(params); Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k))); setParams(n); };

  useEffect(() => { if (isAdmin) api.get('/assemblies').then(({ data: d }) => setAssemblies(d.assemblies || [])).catch(() => {}); }, [isAdmin]);
  useEffect(() => {
    if (!ac) { setData(null); return undefined; }
    let alive = true;
    const p = isAdmin ? { assemblyId: ac } : {};
    setLoading(true); setErr('');
    Promise.all([
      api.get('/reports/booth', { params: p }).then((r) => r.data),
      api.get('/reports/booth-report-list', { params: p }).then((r) => new Set((r.data.booths || []).map(Number))).catch(() => new Set()),
    ]).then(([d, hb]) => { if (alive) { setData(d); setHtmlBooths(hb); } })
      .catch((e) => alive && setErr(e.response?.data?.message || 'Could not load the booth report.'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [ac, isAdmin]);

  const rows = data?.rows || [];
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) => String(r.part_no) === t || String(r.booth_name || '').toLowerCase().includes(t)).sort(boothFirst(t));
  }, [rows, q]);
  const pageRows = filtered.slice((page - 1) * PAGE, page * PAGE);
  // the report list is assembly-wide; count only the booths in this view (a candidate sees just theirs)
  const withReport = rows.filter((r) => htmlBooths.has(Number(r.part_no))).length;
  const totals = data?.totals;
  const open = openPart && !locked ? rows.find((r) => String(r.part_no) === openPart) : null;

  const columns = locked ? [
    { key: 'part_no', label: 'Booth', align: 'right', render: (r) => <span className="cv-num-strong">{r.part_no}</span> },
    { key: 'booth_name', label: 'Polling station', primary: true, wrap: 200, render: (r) => r.booth_name || '—' },
    { key: 'locked', label: 'Voters', render: () => <span className="cv-muted cv-locked"><Lock size={13} /> with your plan</span> },
  ] : [
    { key: 'part_no', label: 'Booth', align: 'right', render: (r) => <span className="cv-num-strong">{r.part_no}</span> },
    { key: 'booth_name', label: 'Polling station', primary: true, wrap: 200, render: (r) => r.booth_name || '—' },
    { key: 'total', label: 'Total', align: 'right', render: (r) => <strong>{inr(r.total)}</strong> },
    { key: 'male', label: 'Male', align: 'right', render: (r) => inr(r.male) },
    { key: 'female', label: 'Female', align: 'right', render: (r) => <span>{inr(r.female)} <span className="cv-muted">· {pct(r.female, r.total)}</span></span> },
    { key: 'other', label: 'Other', align: 'right', render: (r) => inr(r.other) },
    { key: 'report', label: '', render: (r) => (htmlBooths.has(Number(r.part_no))
      ? <Button size="sm" variant="ghost" icon={FileText} onClick={() => setP({ booth: String(r.part_no) })}>Open report</Button>
      : <span className="cv-muted">No report yet</span>) },
  ];

  const where = data ? `${data.assembly_no} — ${data.assembly_name}${data.district ? ` · ${data.district}` : ''}` : '';

  // In-page viewer for one booth's pre-built HTML report
  if (open && data) {
    const url = boothUrl(data.assembly_no, open.part_no);
    return (
      <div className="cv-page">
        <PageHeader
          eyebrow={<button type="button" className="cv-link cv-link-btn" onClick={() => setP({ booth: '' })}><ArrowLeft size={13} /> {title}</button>}
          title={`Booth ${open.part_no} — ${open.booth_name || 'Polling station'}`}
          subtitle={`${where} · ${inr(open.total)} voters`}
          actions={<a className="cv-btn cv-btn--ghost" href={url} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Open full page</a>}
        />
        <Card flush><iframe key={url} title={`Booth ${open.part_no} report`} src={url} className="cv-doc-frame cv-doc-frame--tall" /></Card>
      </div>
    );
  }

  return (
    <div className="cv-page">
      <PageHeader
        title={title}
        subtitle={data ? where : isAdmin ? 'Voters per booth with each booth’s pre-built report' : 'Voters per booth in your area'}
        actions={isAdmin ? (
          <Select value={ac} onChange={(e) => setP({ ac: e.target.value, page: '', q: '', booth: '' })} aria-label="Assembly" className="cv-filters-assembly">
            <option value="">Select assembly</option>
            {assemblies.map((a) => <option key={a.assembly_no} value={a.assembly_no}>{a.assembly_no} — {a.assembly_name}</option>)}
          </Select>
        ) : null}
      />
      {err && <Alert tone="bad"><CircleAlert size={16} /> {err}</Alert>}

      {!ac ? (
        <Card><div className="cv-table-empty"><Landmark size={20} /> Choose an assembly to see its booths.</div></Card>
      ) : (
        <>
          {locked ? (
            <Alert tone="info"><Lock size={16} /> These are your booths. Voter numbers and each booth's report unlock when your plan is active. <Link to="/candidate" className="cv-link">Activate your plan</Link></Alert>
          ) : (
          <div className="cv-kpis cv-kpis--4">
            <Kpi icon={Users} label="Total voters" value={totals ? inr(totals.total) : '…'} note={data ? `${inr(rows.length)} booths` : ''} />
            <Kpi label="Male" value={totals ? pct(totals.male, totals.total) : '…'} note={totals ? inr(totals.male) : ''} />
            <Kpi label="Female" value={totals ? pct(totals.female, totals.total) : '…'} note={totals ? inr(totals.female) : ''} />
            <Kpi label="Booth reports" value={data ? inr(withReport) : '…'} note={data ? `of ${inr(rows.length)} booths` : ''} tone={data && withReport < rows.length ? 'warn' : undefined} />
          </div>
          )}

          <Card flush>
            <div className="cv-tabs-row cv-tabs-row--search">
              <label className="cv-search cv-search--text">
                <Search size={14} />
                <input type="search" value={q} placeholder="Booth number or polling station" onChange={(e) => setP({ q: e.target.value, page: '' })} aria-label="Search booths" />
              </label>
              <span className="cv-muted">{loading ? 'Loading…' : `${inr(filtered.length)} booth${filtered.length === 1 ? '' : 's'}`}</span>
            </div>
            {loading && !data ? <div className="cv-card-body"><Skeleton h={240} /></div> : (
              <>
                <DataTable columns={columns} rows={pageRows} rowKey={(r) => r.part_no} loading={loading} empty={q ? 'No booth matches that search.' : 'No booth data for this assembly.'} />
                {filtered.length > PAGE && <Pager page={page} pageSize={PAGE} total={filtered.length} onPage={(p) => setP({ page: String(p) })} />}
              </>
            )}
          </Card>
          <p className="cv-foot"><Users size={14} /> Aggregates only — no individual voter data on this page.</p>
        </>
      )}
    </div>
  );
}
