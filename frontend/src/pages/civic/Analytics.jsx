import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Users, MapPin, FileText, ExternalLink, CircleAlert, Download, Landmark, Info } from 'lucide-react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Pill, Kpi, BarList, Segmented, Skeleton, inr } from '../../civic/kit.jsx';
import { DataTable, Pager, Select, Alert, Button } from '../../civic/ui.jsx';
import { loadBoundaries, isPointInPolygon, boothAreas, bandOf, BANDS, METRICS } from '../../civic/boothGeo.js';

// Assembly Analytics (Civic Ops step 7, Super Admin). Same APIs as before:
// GET /reports/assembly-analytics?assemblyId · GET /reports/booth?assemblyId
// GET /reports/booth-report-list?assemblyId · GET /reports/documents?assemblyId
// Map: Leaflet + OpenStreetMap tiles (no Google tile scraping), booth circles sized by voters.
const TABS = [{ id: 'overview', label: 'Overview' }, { id: 'booths', label: 'Booth report' }, { id: 'documents', label: 'Documents' }];
const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : '—');
const boothReportUrl = (ac, part) => `/report-files/Booth_Reports/ASS ${ac} Booth Reports/Booth_${part}_Report.html`;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Booth strength heatmap: each booth with GPS inside the assembly gets the area nearest to it,
// coloured in five bands of the chosen metric (as on live). Booths without usable GPS are listed
// under the map instead of being placed on invented positions.
function BoothMap({ booths, boundary, metric, selected, onSelect }) {
  const el = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const fitted = useRef('');
  const target = useRef(null); // bounds to show; dropped once the user zooms or drags
  const fit = (tries = 0) => {
    if (!map.current || !target.current) return;
    // not laid out yet: retry shortly (resize events alone are not delivered to hidden tabs)
    if (!el.current?.clientWidth) { if (tries < 25) setTimeout(() => fit(tries + 1), 120); return; }
    map.current.invalidateSize(false); // Leaflet caches the box size; refresh it first
    map.current.fitBounds(target.current, { padding: [12, 12], animate: false });
  };
  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = L.map(el.current, { scrollWheelZoom: false, zoomSnap: 0.25 }).setView([11.1271, 78.6569], 7);
    const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map.current);
    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagery © Esri' });
    L.control.layers({ Map: streets, Satellite: satellite }, null, { position: 'topright' }).addTo(map.current);
    map.current.on('dragstart', () => { target.current = null; });
    map.current.getContainer().addEventListener('wheel', () => { target.current = null; }, { passive: true });
    map.current.on('zoomstart', (e) => { if (e.originalEvent) target.current = null; });
    // the box can be 0 px wide when the map is created (still laying out): refit once it has a size
    const ro = new ResizeObserver(() => fit());
    ro.observe(el.current);
    return () => { ro.disconnect(); map.current?.remove(); map.current = null; };
  }, []);
  useEffect(() => {
    if (!map.current) return;
    if (layer.current) layer.current.remove();
    const group = L.layerGroup();
    const m = METRICS.find((x) => x.id === metric) || METRICS[0];
    const sorted = booths.map(m.get).sort((a, b) => a - b);
    const placed = booths.filter((b) => b.inside);
    if (boundary) L.polygon(boundary.map(([lng, lat]) => [lat, lng]), { color: '#1D4ED8', weight: 2, fill: false, interactive: false }).addTo(group);
    const tip = (b, band) => `<strong>Booth ${esc(b.part_no)}</strong> · ${band.label}<br>${esc(b.booth_name)}<br>${inr(b.voter_count || 0)} voters · ${inr(b.male_voters || 0)} M · ${inr(b.female_voters || 0)} F · ${inr(b.other_voters || 0)} other`;
    const areas = boundary && placed.length >= 2 ? boothAreas(placed, boundary) : placed.map((b) => ({ booth: b, ring: null }));
    areas.forEach(({ booth: b, ring }) => {
      const band = bandOf(m.get(b), sorted);
      const on = selected === b.part_no;
      if (ring) {
        const area = L.polygon(ring, { color: on ? '#1D4ED8' : '#fff', weight: on ? 3 : 1, fillColor: band.color, fillOpacity: 0.78 });
        area.bindTooltip(tip(b, band), { sticky: true });
        area.on('click', () => onSelect?.(b.part_no));
        group.addLayer(area);
      }
      const dot = L.circleMarker([b.lat, b.lng], { radius: ring ? 3 : 7, color: on ? '#1D4ED8' : '#fff', weight: on ? 3 : 1, fillColor: ring ? '#0F172A' : band.color, fillOpacity: ring ? 0.7 : 0.9 });
      dot.bindTooltip(tip(b, band));
      dot.on('click', () => onSelect?.(b.part_no));
      group.addLayer(dot);
    });
    group.addTo(map.current);
    layer.current = group;
    // fit once per assembly, not on every metric/selection change
    const key = `${booths.length}:${boundary?.length || 0}:${placed[0]?.part_no ?? ''}`;
    if (fitted.current !== key) {
      fitted.current = key;
      const pts = boundary ? boundary.map(([lng, lat]) => [lat, lng]) : placed.map((b) => [b.lat, b.lng]);
      target.current = pts.length ? L.latLngBounds(pts) : null;
      fit();
      setTimeout(() => fit(), 350); // once more after the surrounding layout settles
    }
  }, [booths, boundary, metric, selected, onSelect]);
  return <div ref={el} className="cv-map" />;
}

export default function Analytics() {
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const group = Number(user?.group_id || user?.user_group_id || 0);
  const isAdmin = group === 1;
  // Round 1 (Ram, 2026-10-14): candidates see the whole assembly here (the bigger picture); their own
  // booths live on the Booth report page, so that tab and the admin-only links are hidden for them.
  const isCandidate = [4, 6, 11].includes(group);
  const lockedAc = !isAdmin && user?.assembly_id ? String(user.assembly_id) : '';
  const ac = lockedAc || params.get('ac') || '';
  const visibleTabs = isCandidate ? TABS.filter((t) => t.id !== 'booths') : TABS;
  const tab = visibleTabs.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'overview';
  const page = Math.max(1, Number(params.get('page') || 1));
  const [assemblies, setAssemblies] = useState([]);
  const [data, setData] = useState(null);
  const [report, setReport] = useState(null);
  const [htmlBooths, setHtmlBooths] = useState(new Set());
  const [docs, setDocs] = useState([]);
  const [openDoc, setOpenDoc] = useState(null);
  const [selected, setSelected] = useState(null);
  const [boundaries, setBoundaries] = useState({});
  const metric = METRICS.some((m) => m.id === params.get('metric')) ? params.get('metric') : 'total';
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const setP = (patch) => { const n = new URLSearchParams(params); Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k))); setParams(n); };
  useEffect(() => { loadBoundaries().then(setBoundaries); }, []);
  useEffect(() => { api.get('/assemblies').then(({ data: d }) => setAssemblies(d.assemblies || [])).catch(() => setErr('Could not load the assembly list.')); }, []);
  useEffect(() => {
    if (!ac) { setData(null); setReport(null); setDocs([]); return undefined; }
    let alive = true;
    setLoading(true); setErr(''); setSelected(null); setOpenDoc(null);
    Promise.all([
      api.get('/reports/assembly-analytics', { params: { assemblyId: ac } }).then((r) => r.data),
      api.get('/reports/booth', { params: { assemblyId: ac } }).then((r) => r.data).catch(() => null),
      api.get('/reports/booth-report-list', { params: { assemblyId: ac } }).then((r) => new Set((r.data.booths || []).map(Number))).catch(() => new Set()),
      api.get('/reports/documents', { params: { assemblyId: ac } }).then((r) => r.data.documents || []).catch(() => []),
    ]).then(([a, b, hb, d]) => { if (!alive) return; setData(a); setReport(b); setHtmlBooths(hb); setDocs(d); })
      .catch((e) => alive && setErr(e.response?.data?.message || 'Could not load analytics.'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [ac]);

  const assembly = assemblies.find((a) => String(a.assembly_no) === ac);
  const boundary = ac && boundaries[String(Number(ac))]?.polygon?.length >= 3 ? boundaries[String(Number(ac))].polygon : null;
  // inside = has GPS and (when the outline is known) the GPS falls inside this assembly
  const booths = useMemo(() => (data?.booths || []).map((b) => {
    const lat = Number(b.lat); const lng = Number(b.lng);
    const gps = b.lat != null && b.lng != null && Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0;
    return { ...b, lat, lng, gps, inside: gps && (!boundary || isPointInPolygon(lat, lng, boundary)) };
  }), [data, boundary]);
  const metricDef = METRICS.find((m) => m.id === metric);
  const strength = useMemo(() => [...booths].sort((a, b) => metricDef.get(b) - metricDef.get(a)), [booths, metricDef]);
  const sortedVals = useMemo(() => booths.map(metricDef.get).sort((a, b) => a - b), [booths, metricDef]);
  const located = booths.filter((b) => b.inside).length;
  const noGps = booths.filter((b) => !b.gps);
  const outside = booths.filter((b) => b.gps && !b.inside);
  const reportRows = report?.rows || [];
  const pageRows = reportRows.slice((page - 1) * 40, page * 40);
  const title = assembly ? `${assembly.assembly_no} — ${assembly.assembly_name}` : 'Assembly Analytics';

  const reportColumns = [
    { key: 'part_no', label: 'Booth', align: 'right', render: (r) => <span className="cv-num-strong">{r.part_no}</span> },
    { key: 'booth_name', label: 'Polling station', primary: true, render: (r) => <span style={{ whiteSpace: 'normal' }}>{r.booth_name || '—'}</span> },
    { key: 'total', label: 'Total', align: 'right', render: (r) => inr(r.total) },
    { key: 'male', label: 'Male', align: 'right', render: (r) => inr(r.male) },
    { key: 'female', label: 'Female', align: 'right', render: (r) => inr(r.female) },
    { key: 'other', label: 'Other', align: 'right', render: (r) => inr(r.other) },
    { key: 'report', label: 'Report', render: (r) => (htmlBooths.has(Number(r.part_no)) ? <a className="cv-btn cv-btn--ghost cv-btn--sm" href={boothReportUrl(ac, r.part_no)} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open</a> : <span className="cv-muted">—</span>) },
  ];

  return (
    <div className="cv-page">
      <PageHeader
        title={title}
        subtitle={assembly ? `${assembly.district || data?.district || ''}${data ? ` · ${inr(data.total)} voters · ${inr(booths.length)} booths` : ''}` : 'Map, gender and age profile, booth report and pre-built documents per assembly'}
        actions={lockedAc ? null : <Select value={ac} onChange={(e) => setP({ ac: e.target.value, page: '', tab: '' })} aria-label="Assembly" className="cv-filters-assembly"><option value="">Select assembly</option>{assemblies.map((a) => <option key={a.assembly_no} value={a.assembly_no}>{a.assembly_no} — {a.assembly_name}</option>)}</Select>}
      />
      {err && <Alert tone="bad"><CircleAlert size={16} /> {err}</Alert>}

      {!ac ? (
        <Card><div className="cv-table-empty"><Landmark size={20} /> Choose an assembly to see its voter profile, booth map and reports.</div></Card>
      ) : (
        <>
          <div className="cv-kpis cv-kpis--4">
            <Kpi label="Total voters" value={data ? inr(data.total) : '…'} note={data ? `${inr(booths.length)} booths` : ''} />
            <Kpi label="Female" value={data ? pct(data.female, data.total) : '…'} note={data ? `${inr(data.female)} · male ${inr(data.male)}` : ''} />
            <Kpi label="Youth 18–35" value={data ? pct(data.youth, data.total) : '…'} note={data ? `${inr(data.youth)} voters` : ''} />
            <Kpi label="Booths on map" value={data ? inr(located) : '…'} note={data ? `${inr(noGps.length)} without GPS${outside.length ? ` · ${inr(outside.length)} outside the assembly` : ''}` : ''} tone={data && booths.length - located ? 'warn' : undefined} />
          </div>

          <Card flush>
            <div className="cv-tabs-row"><div className="cv-tabs" role="tablist">{visibleTabs.map((t) => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`cv-tab ${tab === t.id ? 'cv-tab--on' : ''}`} onClick={() => setP({ tab: t.id === 'overview' ? '' : t.id, page: '' })}>{t.label}{t.id === 'documents' && docs.length ? <span className="cv-tab-count">{docs.filter((d) => d.exists).length}</span> : null}</button>)}</div></div>

            {tab === 'overview' && isCandidate && (
              <div className="cv-card-body" style={{ paddingBottom: 0 }}><Alert tone="info"><Info size={16} /><span>The whole assembly, so you see the bigger picture your ward sits in. Your own booths are under <Link to="/booth-report" className="cv-link">Booth report</Link>.</span></Alert></div>
            )}
            {tab === 'overview' && (
              <div className="cv-card-body" style={{ paddingTop: 16 }}>
                <div className="cv-grid cv-grid--2-1">
                  <div>
                    <div className="cv-map-head">
                      <div className="cv-kv-title" style={{ margin: 0 }}>Booth strength map</div>
                      <Segmented options={METRICS} value={metric} onChange={(id) => setP({ metric: id === 'total' ? '' : id })} />
                    </div>
                    {loading ? <Skeleton h={420} /> : <BoothMap booths={booths} boundary={boundary} metric={metric} selected={selected} onSelect={setSelected} />}
                    <div className="cv-map-legend">
                      {BANDS.map((b) => <span key={b.label} className="cv-band"><i style={{ background: b.color }} />{b.label}</span>)}
                    </div>
                    <p className="cv-hint" style={{ marginTop: 6 }}>
                      {metricDef.label === 'Total' ? 'Voters' : `${metricDef.label} voters`} per booth, in five equal-sized groups. Each coloured area is the part of the assembly nearest to that booth, so treat area edges as approximate. Click an area to highlight the booth.
                      {(noGps.length > 0 || outside.length > 0) && <> Not on the map: {noGps.length > 0 && <>{inr(noGps.length)} without GPS (booth {noGps.slice(0, 8).map((b) => b.part_no).join(', ')}{noGps.length > 8 ? ', …' : ''})</>}{noGps.length > 0 && outside.length > 0 && '; '}{outside.length > 0 && <>{inr(outside.length)} with GPS outside this assembly (booth {outside.slice(0, 8).map((b) => b.part_no).join(', ')}{outside.length > 8 ? ', …' : ''})</>}.{isAdmin && <> <Link to={`/booths?ac=${ac}`} className="cv-link">Fix in Booths</Link></>}</>}
                    </p>
                  </div>
                  <div className="cv-stack">
                    <div>
                      <div className="cv-kv-title">Gender</div>
                      {data ? <>
                        <div className="cv-split-bar"><span className="cv-split-m" style={{ width: pct(data.male, data.total) }}>M {pct(data.male, data.total)}</span><span className="cv-split-f" style={{ width: pct(data.female, data.total) }}>F {pct(data.female, data.total)}</span>{data.other > 0 && <span className="cv-split-o" style={{ width: `${Math.max((data.other / data.total) * 100, 1)}%` }} />}</div>
                        <p className="cv-hint">Male {inr(data.male)} · Female {inr(data.female)} · Other {inr(data.other)}</p>
                      </> : <Skeleton h={30} />}
                    </div>
                    <div>
                      <div className="cv-kv-title">Age groups</div>
                      {data ? <BarList items={[{ label: 'Youth (18–35)', value: data.youth }, { label: 'Middle (36–59)', value: data.middle }, { label: 'Senior (60+)', value: data.senior }]} /> : <Skeleton h={90} />}
                    </div>
                    <div>
                      <div className="cv-kv-title">Largest booths{metric !== 'total' ? ` · ${metricDef.label.toLowerCase()} voters` : ''}</div>
                      {data ? <ul className="cv-strength-list">{strength.slice(0, 12).map((b) => <li key={b.part_no} className={selected === b.part_no ? 'cv-on' : ''} onClick={() => setSelected(b.part_no)}><span className="cv-num-strong">#{b.part_no}</span><span className="cv-barlist-track"><span style={{ width: `${(metricDef.get(b) / (metricDef.get(strength[0] || {}) || 1)) * 100}%`, background: bandOf(metricDef.get(b), sortedVals).color }} /></span><span className="cv-barlist-value">{inr(metricDef.get(b))}</span></li>)}</ul> : <Skeleton h={120} />}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {tab === 'booths' && (
              <>
                {report?.totals && <div className="cv-card-body" style={{ paddingTop: 14, paddingBottom: 6 }}><p className="cv-hint" style={{ margin: 0 }}>Totals: {inr(report.totals.total)} voters · {inr(report.totals.male)} male · {inr(report.totals.female)} female · {inr(report.totals.other)} other · {htmlBooths.size} booth reports available</p></div>}
                <DataTable columns={reportColumns} rows={pageRows} rowKey={(r) => r.part_no} loading={loading} empty="No booth data for this assembly." />
                <Pager page={page} pageSize={40} total={reportRows.length} onPage={(p) => setP({ page: String(p) })} />
              </>
            )}

            {tab === 'documents' && (
              <div className="cv-card-body" style={{ paddingTop: 16 }}>
                {docs.length === 0 ? <p className="cv-empty">No documents listed for this assembly.</p> : (
                  <ul className="cv-doc-list">
                    {docs.map((d) => d.exists ? (
                      <li key={d.key}><button type="button" className={`cv-doc ${openDoc?.key === d.key ? 'cv-on' : ''}`} style={{ width: '100%', textAlign: 'left', background: 'none', cursor: 'pointer', font: 'inherit' }} onClick={() => setOpenDoc(d)}><span className="cv-doc-icon"><FileText size={18} /></span><span className="cv-two"><strong>{d.label}</strong><span className="cv-muted">{d.kind === 'booth' ? 'Booth report' : 'Pre-built assembly document'}</span></span></button></li>
                    ) : (
                      <li key={d.key}><span className="cv-doc" style={{ opacity: .6 }}><span className="cv-doc-icon"><FileText size={18} /></span><span className="cv-two"><strong>{d.label}</strong><span className="cv-muted">Not generated for this assembly yet</span></span></span></li>
                    ))}
                  </ul>
                )}
                {openDoc && (
                  <div style={{ marginTop: 14 }}>
                    <div className="cv-tabs-row" style={{ padding: '0 0 8px', border: 'none' }}><strong>{openDoc.label}</strong><span className="cv-row-actions"><a className="cv-btn cv-btn--ghost cv-btn--sm" href={openDoc.url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open full page</a><a className="cv-btn cv-btn--ghost cv-btn--sm" href={openDoc.url} download><Download size={13} /> Download</a></span></div>
                    <iframe key={openDoc.key} title={openDoc.label} src={openDoc.url} className="cv-doc-frame" />
                  </div>
                )}
              </div>
            )}
          </Card>

          <p className="cv-foot"><Users size={14} /> Aggregates only — no individual voter data on this page.{isAdmin && <Link to={`/booths?ac=${ac}`} className="cv-link" style={{ marginLeft: 8 }}><MapPin size={13} /> Booth list</Link>}</p>
        </>
      )}
    </div>
  );
}
