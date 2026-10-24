import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, X, Phone, MessageCircle, Mail, Eye, Download, Lock, CircleAlert, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Pill, inr } from '../../civic/kit.jsx';
import { DataTable, Pager, Input, Select, Button, Modal, KV, Alert, MaskedMobile, waLink } from '../../civic/ui.jsx';

// Voters (Civic Ops step 4), Super Admin view. Same API as before:
// GET /assemblies · GET /voters?assemblyId&gender&has_mobile&min_age&max_age&boothId&search_text&page&pageSize
// GET /voters/detail?assemblyId&id · GET /voters/export (CSV). The backend
// masks mobiles/EPICs and locks pages for unpaid roles; admins get full numbers, which this page masks on
// screen by default (MaskedMobile) and reveals one row at a time.
const PAGE_SIZE = 25;
const EMPTY = { assemblyId: '', gender: '', has_mobile: '', min_age: '', max_age: '', boothId: '', search_text: '' };
const sms = (m) => `sms:${String(m || '').replace(/\D/g, '')}`;
const field = (v, keys) => { for (const k of keys) { const x = v?.[k]; if (x !== undefined && x !== null && String(x).trim() !== '') return String(x); } return ''; };

function VoterModal({ voter, assemblyName, loading, onClose }) {
  const v = voter || {};
  const nameEn = field(v, ['VOTER_NAME_EN', 'voter_name_en']);
  const nameTa = field(v, ['VOTER_NAME_TA', 'VOTER_NAME', 'voter_name']);
  const mobile = field(v, ['MOBILE_NUMBER', 'mobile']);
  const relType = { F: 'Father', H: 'Husband', M: 'Mother', O: 'Other' }[field(v, ['RELATION_TYPE'])] || field(v, ['RELATION_TYPE']);
  return (
    <Modal open={!!voter || loading} title={loading ? 'Loading voter…' : `${nameEn || 'Voter'}${nameTa && nameTa !== nameEn ? ` · ${nameTa}` : ''}`} onClose={onClose} width={760}>
      {loading ? <p className="cv-empty">Fetching the full record…</p> : (
        <>
          <div className="cv-voter-top">
            <span className="cv-mono">{field(v, ['EPIC_NO', 'epic_no']) || '—'}</span>
            <Pill tone="info">AC {field(v, ['ASSEMBLY_NO'])} · Part {field(v, ['PART_NO'])} · Sl {field(v, ['SLNO'])}</Pill>
            <span className="cv-row-actions" style={{ marginLeft: 'auto' }}>
              {mobile && <a className="cv-btn cv-btn--ghost cv-btn--sm" href={`tel:${mobile}`}><Phone size={13} /> Call</a>}
              {mobile && <a className="cv-btn cv-btn--ghost cv-btn--sm" href={sms(mobile)}><Mail size={13} /> SMS</a>}
              {mobile && <a className="cv-btn cv-btn--ghost cv-btn--sm" href={waLink(mobile)} target="_blank" rel="noreferrer"><MessageCircle size={13} /> WhatsApp</a>}
            </span>
          </div>
          <div className="cv-voter-grid">
            <div>
              <div className="cv-kv-title">Person</div>
              <KV items={[
                ['Name (English)', nameEn], ['Name (Tamil)', nameTa ? <span className="cv-ta">{nameTa}</span> : null],
                ['Relation', relType], ['Relation name', field(v, ['RELATION_NAME_EN']) ? <>{field(v, ['RELATION_NAME_EN'])}{field(v, ['RELATION_NAME']) && <span className="cv-ta"> · {field(v, ['RELATION_NAME'])}</span>}</> : null],
                ['Age · Gender', `${field(v, ['AGE']) || '—'} · ${field(v, ['GENDER']) || '—'}`],
                ['Mobile', mobile ? <MaskedMobile value={mobile} /> : null],
                ['House no', field(v, ['HOUSE_NO', 'house_no'])],
              ]} />
            </div>
            <div>
              <div className="cv-kv-title">Electoral</div>
              <KV items={[
                ['Assembly', `${field(v, ['ASSEMBLY_NO'])} · ${assemblyName || field(v, ['ASSEMBLY_NAME'])}`],
                ['Part · Section', `${field(v, ['PART_NO'])} · ${field(v, ['SECTION_NO'])}${field(v, ['SECTION_NAME']) ? ` (${field(v, ['SECTION_NAME'])})` : ''}`],
                ['Polling station', field(v, ['POLLING_STATION_EN', 'BOOTH_NAME', 'PART_NAME'])],
                ['Polling station (Tamil)', field(v, ['POLLING_STATION_TA']) ? <span className="cv-ta">{field(v, ['POLLING_STATION_TA'])}</span> : null],
                ['District', field(v, ['DISTRICT'])],
                ['Pincode', field(v, ['PINCODE'])],
              ]} />
            </div>
          </div>
          <p className="cv-foot cv-privacy-note"><ShieldCheck size={14} /> Personal data under the DPDP Act 2023: use it only for this campaign's outreach, and don't copy or share it.</p>
        </>
      )}
    </Modal>
  );
}

export default function Voters() {
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  // Non-admin roles are scoped to their own assembly (and candidates to their booths);
  // the backend enforces it, the page just removes the pickers.
  const group = Number(user?.group_id || user?.user_group_id || 0);
  const lockedAc = group !== 1 && user?.assembly_id ? String(user.assembly_id) : '';
  const isCandidate = [4, 6, 11].includes(group);
  const [myBooths, setMyBooths] = useState([]);
  const page = Math.max(1, Number(params.get('page') || 1));
  const filters = useMemo(() => ({ ...EMPTY, ...Object.fromEntries([...params].filter(([k]) => k in EMPTY)), ...(lockedAc ? { assemblyId: lockedAc } : {}) }), [params, lockedAc]);
  useEffect(() => {
    if (!isCandidate) return;
    // Before the plan is active the API sends no booth rows; fall back to the booth numbers from the login.
    const own = (Array.isArray(user?.booths) ? user.booths : []).map((b) => (typeof b === 'object' && b ? { assembly_no: b.assembly_no || user?.assembly_id, part_no: b.part_no, booth_name: b.booth_name || `Booth ${b.part_no}` } : { assembly_no: user?.assembly_id, part_no: b, booth_name: `Booth ${b}` }));
    api.get('/ward/home').then(({ data: d }) => setMyBooths(d.booths?.length ? d.booths : own)).catch(() => setMyBooths(own));
  }, [isCandidate]);
  const [draft, setDraft] = useState(filters);
  const [assemblies, setAssemblies] = useState([]);
  const [data, setData] = useState({ rows: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [detail, setDetail] = useState({ open: false, loading: false, voter: null });
  const [filtersOpen, setFiltersOpen] = useState(false); // phones: the extra filters fold behind one button (2026-10-17)

  useEffect(() => { setDraft(filters); }, [filters]);
  useEffect(() => {
    api.get('/assemblies').then(({ data: d }) => setAssemblies(d.assemblies || [])).catch(() => setErr('Could not load the assembly list.'));
  }, []);

  const assemblyId = filters.assemblyId;
  const assembly = assemblies.find((a) => String(a.assembly_no) === String(assemblyId));

  useEffect(() => {
    if (!assemblyId) { setData({ rows: [], total: 0 }); return undefined; }
    let alive = true;
    setLoading(true); setErr('');
    api.get('/voters', { params: { ...filters, page, pageSize: PAGE_SIZE } })
      .then(({ data: d }) => { if (!alive) return; if (d.success === false) throw new Error(d.message); setData(d); })
      .catch((e) => alive && setErr(e.response?.data?.message || e.message || 'Could not load voters.'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [filters, page]);

  const apply = (next) => {
    const p = new URLSearchParams();
    Object.entries(next).forEach(([k, v]) => v && p.set(k, v));
    setParams(p);
  };
  const active = Object.entries(filters).filter(([k, v]) => v && k !== 'assemblyId');
  const openVoter = async (row) => {
    setDetail({ open: true, loading: true, voter: null });
    try {
      const { data: d } = await api.get('/voters/detail', { params: { assemblyId, id: row._id } });
      setDetail({ open: true, loading: false, voter: d.voter || row });
    } catch {
      setDetail({ open: true, loading: false, voter: row });
    }
  };
  const exportUrl = `/api/voters/export?${new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([, v]) => v)))}`;

  const columns = [
    { key: 'EPIC_NO', label: 'EPIC', render: (r) => <span className="cv-mono">{r.EPIC_NO}</span> },
    { key: 'PART_NO', label: 'Part · Sl', align: 'right', render: (r) => (r.SLNO ? `${r.PART_NO} · ${r.SLNO}` : String(r.PART_NO)) }, // no serial on the roll → just the part (UX10)
    { key: 'name', label: 'Elector', primary: true, render: (r) => <div className="cv-two"><strong>{r.VOTER_NAME_EN || '—'}</strong>{r.VOTER_NAME && r.VOTER_NAME !== r.VOTER_NAME_EN && <span className="cv-ta">{r.VOTER_NAME}</span>}</div> },
    { key: 'RELATION_NAME_EN', label: 'Relation', mobile: false, render: (r) => `${{ F: 'S/O', H: 'W/O', M: 'C/O' }[r.RELATION_TYPE] || ''} ${r.RELATION_NAME_EN || '—'}`.trim() },
    { key: 'AGE', label: 'Age', align: 'right' },
    { key: 'GENDER', label: 'Gender', mobile: false }, // phone card: in the full record (tap the card)
    { key: 'MOBILE_NUMBER', label: 'Mobile', render: (r) => <MaskedMobile value={r.MOBILE_NUMBER} /> },
    { key: 'contact', label: 'Call · SMS · WA', render: (r) => r.MOBILE_NUMBER && !/\*/.test(r.MOBILE_NUMBER) ? (
      <span className="cv-row-actions" onClick={(e) => e.stopPropagation()}>
        <a className="cv-icon-btn cv-icon-btn--sm" href={`tel:${r.MOBILE_NUMBER}`} title="Call"><Phone size={14} /></a>
        <a className="cv-icon-btn cv-icon-btn--sm" href={sms(r.MOBILE_NUMBER)} title="SMS"><Mail size={14} /></a>
        <a className="cv-icon-btn cv-icon-btn--sm cv-wa" href={waLink(r.MOBILE_NUMBER)} target="_blank" rel="noreferrer" title="WhatsApp"><MessageCircle size={14} /></a>
      </span>
    ) : <span className="cv-muted">— — —</span> },
    { key: 'view', label: '', mobile: false, render: (r) => <button type="button" className="cv-icon-btn cv-icon-btn--sm" title="View full record" onClick={(e) => { e.stopPropagation(); openVoter(r); }}><Eye size={14} /></button> },
  ];

  return (
    <div className="cv-page">
      <PageHeader
        title={lockedAc ? 'My voters' : 'Voters'}
        subtitle={assembly ? `${assembly.assembly_no} — ${assembly.assembly_name}${assembly.district ? ` · ${assembly.district}` : ''}${data.total ? ` · ${inr(data.total)} match` : ''}` : lockedAc ? `Assembly ${lockedAc}${data.total ? ` · ${inr(data.total)} match` : ''}` : 'Pick an assembly to list its electoral roll'}
        actions={assemblyId && data.total > 0 && data.isPro !== false ? <a className="cv-btn cv-btn--ghost" href={exportUrl} target="_blank" rel="noreferrer"><Download size={15} /> Export CSV</a> : null}
      />

      <Card flush>
        <form className={`cv-filters cv-filters--fold ${filtersOpen ? 'cv-filters--open' : ''}`} onSubmit={(e) => { e.preventDefault(); apply(draft); setFiltersOpen(false); }}>
          {lockedAc ? (
            <span className="cv-filters-assembly cv-locked-ac" title="Your assembly">{assembly ? `${assembly.assembly_no} — ${assembly.assembly_name}` : `Assembly ${lockedAc}`}</span>
          ) : (
            <Select value={draft.assemblyId} onChange={(e) => apply({ ...draft, assemblyId: e.target.value, boothId: '' })} aria-label="Assembly" required className="cv-filters-assembly">
              <option value="">Select assembly</option>
              {assemblies.map((a) => <option key={a.assembly_no} value={a.assembly_no}>{a.assembly_no} — {a.assembly_name}</option>)}
            </Select>
          )}
          {/* on a phone gender / mobile / booth / age fold behind this button; wider screens always show them */}
          <Button type="button" variant="ghost" icon={SlidersHorizontal} className="cv-filters-toggle" onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen}>Filters{active.length ? ` (${active.length})` : ''}</Button>
          <div className="cv-filters-body">
          <Select value={draft.gender} onChange={(e) => setDraft({ ...draft, gender: e.target.value })} aria-label="Gender">
            <option value="">All genders</option><option>Male</option><option>Female</option><option>Other</option>
          </Select>
          <Select value={draft.has_mobile} onChange={(e) => setDraft({ ...draft, has_mobile: e.target.value })} aria-label="Mobile">
            <option value="">With or without mobile</option><option value="1">With mobile</option><option value="0">Without mobile</option>
          </Select>
          {isCandidate && myBooths.length ? (
            <Select value={draft.boothId} onChange={(e) => setDraft({ ...draft, boothId: e.target.value })} aria-label="Booth">
              <option value="">All my booths</option>
              {myBooths.map((b) => <option key={`${b.assembly_no}-${b.part_no}`} value={b.part_no}>Booth {b.part_no} · {b.booth_name}</option>)}
            </Select>
          ) : (
            <Input value={draft.boothId} onChange={(e) => setDraft({ ...draft, boothId: e.target.value.replace(/\D/g, '') })} placeholder="Booth (part no)" aria-label="Booth part number" inputMode="numeric" style={{ width: 130 }} />
          )}
          <span className="cv-age-range">
            <Input value={draft.min_age} onChange={(e) => setDraft({ ...draft, min_age: e.target.value.replace(/\D/g, '') })} placeholder="Min age" aria-label="Minimum age" inputMode="numeric" />
            <span className="cv-muted">–</span>
            <Input value={draft.max_age} onChange={(e) => setDraft({ ...draft, max_age: e.target.value.replace(/\D/g, '') })} placeholder="Max age" aria-label="Maximum age" inputMode="numeric" />
          </span>
          </div>
          <label className="cv-search cv-filters-search"><Search size={15} /><input value={draft.search_text} onChange={(e) => setDraft({ ...draft, search_text: e.target.value })} placeholder="EPIC, mobile or name…" aria-label="Search" /></label>
          <Button type="submit">Filter</Button>
          {active.length > 0 && <Button variant="ghost" icon={X} onClick={() => apply({ ...EMPTY, assemblyId })}>Clear</Button>}
        </form>
        {active.length > 0 && (
          <div className="cv-chips">
            {active.map(([k, v]) => <span key={k} className="cv-chip">{k === 'has_mobile' ? (v === '1' ? 'With mobile' : 'Without mobile') : k === 'boothId' ? `Booth ${v}` : k === 'min_age' ? `Age ≥ ${v}` : k === 'max_age' ? `Age ≤ ${v}` : v}<button type="button" onClick={() => apply({ ...filters, [k]: '' })} aria-label={`Remove ${k} filter`}>×</button></span>)}
          </div>
        )}
        {err && <div className="cv-alert cv-alert--bad" style={{ margin: 16 }}><CircleAlert size={16} /> {err}</div>}
        {!assemblyId ? (
          <div className="cv-table-empty"><Search size={20} /> Choose an assembly above to load its voters. 234 assemblies · {inr(56660540)} voters statewide.</div>
        ) : (
          <>
            {data.locked && <Alert tone="info"><Lock size={15} /> Until your plan is active, mobile and EPIC numbers are masked{data.freePages ? `, only the first ${data.freePages} pages are shown` : ''} and export is off. Activate it from the top bar to unlock everything.</Alert>}
            {data.locked && data.freePages && page > data.freePages && !loading ? (
              <div className="cv-table-empty"><Lock size={20} /> Pages after {data.freePages} unlock with your plan. Your filters still apply: narrow them to see other voters in the first {data.freePages} pages.</div>
            ) : <DataTable columns={columns} rows={data.rows} rowKey={(r) => r._id} onRowClick={openVoter} loading={loading} empty="No voters match these filters." />}
            <Pager page={page} pageSize={PAGE_SIZE} total={data.total} onPage={(p) => { const n = new URLSearchParams(params); n.set('page', String(p)); setParams(n); }} />
          </>
        )}
      </Card>

      <p className="cv-foot"><Pill tone="neutral">Privacy</Pill> Voter data is personal data under the DPDP Act. Export only what a paid candidate is entitled to, and never share lists outside the campaign.</p>

      <VoterModal voter={detail.open && !detail.loading ? detail.voter : null} loading={detail.open && detail.loading} assemblyName={assembly?.assembly_name} onClose={() => setDetail({ open: false, loading: false, voter: null })} />
    </div>
  );
}
