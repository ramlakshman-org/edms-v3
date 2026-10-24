import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Phone, MessageCircle, Eye, Pencil, Search, X, Mail, Mic, Download, MapPin, SlidersHorizontal } from 'lucide-react';
import api from '../../api/client.js';
import { PageHeader, Card, Pill, inr } from '../../civic/kit.jsx';
import { DataTable, Pager, Select, Button, RowMenu, csvOf, download, fmtDate, waLink } from '../../civic/ui.jsx';
import { ALL_DISTRICTS } from '../../data/wardLocalBodies.js';
import { SHOWS, showById, loadAllRegistrations, paidMobiles } from '../../civic/needs.js';

const POSITIONS = ['Corporation', 'Municipality', 'Town Panchayat', 'Village Panchayat Ward Member', 'Village Panchayat President', 'Panchayat Union Ward Member', 'District Panchayat Ward Member'];
const PAGE_SIZE = 25;
const EMPTY = { search: '', district: '', position: '', body_type: '', show: '' };

const paidTone = (s) => (s === 'Yes' ? 'ok' : s === 'No' ? 'neutral' : 'bad');
const paidLabel = (s) => (s === 'Yes' ? 'Yes' : s === 'No' ? 'No' : `Invalid (${s})`);
const reqIcon = (t) => (t === 'sms' ? <Mail size={13} /> : t === 'voice' ? <Mic size={13} /> : <MessageCircle size={13} />);

export default function Registrations() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page') || 1));
  const filters = useMemo(() => ({ ...EMPTY, ...Object.fromEntries([...params].filter(([k]) => k in EMPTY)) }), [params]);
  const [draft, setDraft] = useState(filters);
  const [data, setData] = useState({ rows: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => { setDraft(filters); }, [filters]);

  useEffect(() => {
    let alive = true;
    setLoading(true); setErr('');
    const { show, ...server } = filters;
    const shown = showById(show);
    // "Show" checks (no booths, unpaid, test…) aren't API filters: pull the list and test it here,
    // with the same rules the Dashboard counts with (civic/needs.js).
    // the paid-status checks also need the payments-received list (same source as the Payments page)
    const subs = shown?.needs === 'subs' ? api.get('/payments/subscriptions', { params: { limit: 100 } }).then((r) => r.data?.subscriptions || []) : Promise.resolve([]);
    (shown
      ? Promise.all([loadAllRegistrations(server), subs]).then(([{ rows }, s]) => { const ctx = { paid: paidMobiles(s) }; const all = rows.filter((r) => shown.test(r, ctx)); return { success: true, total: all.length, rows: all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) }; })
      : api.get('/registrations', { params: { ...server, page, pageSize: PAGE_SIZE } }).then((r) => r.data))
      .then((d) => { if (alive) setData(d.success ? d : { rows: [], total: 0 }); })
      .catch((e) => alive && setErr(e.response?.data?.message || 'Could not load registrations.'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [filters, page]);

  const apply = (next, resetPage = true) => {
    const p = new URLSearchParams();
    Object.entries(next).forEach(([k, v]) => v && p.set(k, v));
    if (!resetPage && page > 1) p.set('page', String(page));
    setParams(p);
  };
  const activeFilters = Object.entries(filters).filter(([, v]) => v);
  const shown = showById(filters.show);
  const open = (r) => navigate(`/registrations/view/${r._id || r.id}`);

  const columns = [
    { key: 'full_name', label: 'Candidate', wrap: 130, render: (r) => (
      <div className="cv-two">
        <strong>{r.full_name || r.firstname || '—'}</strong>
        <span className="cv-muted"><span className="cv-mono-sm">{r.mobile}</span>{r.created_at ? <> <span className="cv-nowrap">· {fmtDate(r.created_at)}</span></> : null}</span>
      </div>
    ) },
    { key: 'position', label: 'Position', wrap: 120, render: (r) => <div className="cv-two"><span>{r.position || '—'}</span><span className="cv-muted">{r.body_type ? (String(r.body_type).toLowerCase() === 'urban' ? 'Urban' : 'Rural') : ''}{r.local_body && r.local_body !== '-' ? ` · ${r.local_body}` : ''}</span></div> },
    { key: 'district', label: 'District · Assembly', wrap: 120, mobile: false, render: (r) => <div className="cv-two"><span>{r.district || '—'}</span><span className="cv-muted">{r.assembly_name ? `${r.assembly_id ? `${r.assembly_id} · ` : ''}${r.assembly_name}` : ''}</span></div> },
    { key: 'booths', label: 'Booths', align: 'right', render: (r) => {
      const n = r.booth_count || (Array.isArray(r.booths) ? r.booths.length : 0);
      // no booths yet: a real action that opens this candidate's booth assignment (it used to be a label that looked like one)
      return n ? <span className="cv-num-strong">{n}</span> : <Link to={`/registrations/view/${r._id || r.id}?assign=1`} className="cv-btn cv-btn--ghost cv-btn--sm cv-btn--warn" onClick={(e) => e.stopPropagation()}><MapPin size={13} /> Assign booths</Link>;
    } },
    // only a positive or odd state earns a pill; 'No' on every row was noise (UX4). Passcodes live on the detail page.
    { key: 'paid_status', label: 'Paid', render: (r) => (r.paid_status === 'No' || !r.paid_status ? <span className="cv-td-quiet">—</span> : <Pill tone={paidTone(r.paid_status)} dot>{paidLabel(r.paid_status)}</Pill>) },
    { key: 'requests', label: 'Requests', medium: false, mobile: false, render: (r) => (r.requests?.length ? <span className="cv-reqs">{r.requests.map((q, i) => <span key={i} className={`cv-req cv-req--${q.service_type}`} title={`${q.service_type} · ${q.status || ''}`}>{reqIcon(q.service_type)}</span>)}</span> : <span className="cv-muted">—</span>) },
    { key: 'actions', label: '', render: (r) => (
      <RowMenu items={[
        r.mobile && { label: 'Call', icon: Phone, href: `tel:${r.mobile}` },
        r.mobile && { label: 'WhatsApp', icon: MessageCircle, href: waLink(r.mobile), external: true },
        { label: 'View', icon: Eye, onClick: () => open(r) },
        { label: 'Edit', icon: Pencil, onClick: () => navigate(`/registrations/edit/${r._id || r.id}`) },
      ]} />
    ) },
  ].filter((c) => c.key !== 'requests' || data.rows.some((r) => r.requests?.length)); // an all-empty Requests column says nothing

  // Export: a CSV of what the current filters show (Excel opens it); it was raw JSON before (UX5)
  const exportCsv = async () => {
    const { data: d } = await api.get('/registrations', { params: { ...filters, page: 1, pageSize: 500 } });
    const rows = (d.rows || []).map((r) => ({ name: r.full_name || r.firstname || '', mobile: r.mobile || '', position: r.position || '', body_type: r.body_type || '', district: r.district || '', assembly: r.assembly_name ? `${r.assembly_id || ''} ${r.assembly_name}`.trim() : '', booths: r.booth_count || (Array.isArray(r.booths) ? r.booths.length : 0), paid: r.paid_status || '', registered: r.created_at || '' }));
    download(`registrations${filters.show ? `-${filters.show}` : ''}.csv`, csvOf(rows, ['name', 'mobile', 'position', 'body_type', 'district', 'assembly', 'booths', 'paid', 'registered']));
  };
  const [filtersOpen, setFiltersOpen] = useState(false);

  return (
    <div className="cv-page">
      <PageHeader
        title="Registrations"
        subtitle={loading ? 'Loading…' : shown ? `${inr(data.total)} candidate${data.total === 1 ? '' : 's'} · ${shown.label.charAt(0).toLowerCase()}${shown.label.slice(1)}` : `${inr(data.total)} candidate${data.total === 1 ? '' : 's'} registered through WhatsApp or the website`}
        actions={<Button variant="ghost" icon={Download} onClick={exportCsv}>Export CSV</Button>}
      />

      <Card flush>
        <form className={`cv-filters cv-filters--fold ${filtersOpen ? 'cv-filters--open' : ''}`} onSubmit={(e) => { e.preventDefault(); apply(draft); }}>
          <label className="cv-search cv-filters-search">
            <Search size={15} />
            <input value={draft.search} onChange={(e) => setDraft({ ...draft, search: e.target.value })} placeholder="Name or mobile…" aria-label="Search" />
          </label>
          {/* on a phone the selects fold behind this button (UX3); on wider screens they are always shown */}
          <Button type="button" variant="ghost" icon={SlidersHorizontal} className="cv-filters-toggle" onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen}>Filters{activeFilters.length ? ` (${activeFilters.length})` : ''}</Button>
          <div className="cv-filters-body" style={{ display: undefined }}>
          <Select value={draft.show} onChange={(e) => apply({ ...draft, show: e.target.value })} aria-label="Show">
            <option value="">All candidates</option>
            {SHOWS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </Select>
          <Select value={draft.district} onChange={(e) => setDraft({ ...draft, district: e.target.value })} aria-label="District">
            <option value="">All districts</option>
            {ALL_DISTRICTS.map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>
          <Select value={draft.position} onChange={(e) => setDraft({ ...draft, position: e.target.value })} aria-label="Position">
            <option value="">All positions</option>
            {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
          <Select value={draft.body_type} onChange={(e) => setDraft({ ...draft, body_type: e.target.value })} aria-label="Body type">
            <option value="">Urban & rural</option>
            <option value="urban">Urban</option>
            <option value="rural">Rural</option>
          </Select>
          <Button type="submit">Apply</Button>
          {activeFilters.length > 0 && <Button variant="ghost" icon={X} onClick={() => apply(EMPTY)}>Clear</Button>}
          </div>
        </form>
        {activeFilters.length > 0 && (
          <div className="cv-chips">
            {activeFilters.map(([k, v]) => <span key={k} className="cv-chip">{k === 'body_type' ? (v === 'urban' ? 'Urban' : 'Rural') : k === 'show' ? showById(v)?.label || v : v}<button type="button" onClick={() => apply({ ...filters, [k]: '' })} aria-label={`Remove ${k} filter`}>×</button></span>)}
          </div>
        )}
        {err && <div className="cv-alert cv-alert--bad" style={{ margin: 16 }}>{err}</div>}
        <DataTable columns={columns} rows={data.rows} rowKey={(r) => r._id || r.id} onRowClick={open} loading={loading} empty={shown ? shown.empty : 'No registrations match these filters.'} />
        <Pager page={page} pageSize={PAGE_SIZE} total={data.total} onPage={(p) => { const n = new URLSearchParams(params); n.set('page', String(p)); setParams(n); }} />
      </Card>
    </div>
  );
}
