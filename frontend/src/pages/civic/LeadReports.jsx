import { useEffect, useMemo, useState } from 'react';
import { Download, CalendarRange } from 'lucide-react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Kpi, Pill, Segmented } from '../../civic/kit.jsx';
import { DataTable, Button, Select, Input, loadError, fmtDateTime, fmtDate, csvOf, download } from '../../civic/ui.jsx';
import { statusMeta } from '../../civic/leadStatus.js';

// Period presets → [from, to] ISO strings (local day boundaries).
function range(preset) {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  if (preset === 'today') return [startOfDay, end];
  if (preset === 'week') { const d = new Date(startOfDay); d.setDate(d.getDate() - 6); return [d, end]; }
  if (preset === 'month') { const d = new Date(now.getFullYear(), now.getMonth(), 1); return [d, end]; }
  return [null, null]; // all
}

// Per-telecaller lead report for a day / week / month (or custom range), with CSV export.
// Admins can pick any telecaller (or all); telecallers see only their own.
export default function LeadReports() {
  const { user } = useAuth();
  const isAdmin = Number(user?.group_id || user?.user_group_id) === 1;

  const [preset, setPreset] = useState('today');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [agentId, setAgentId] = useState('');
  const [agents, setAgents] = useState([]);
  const [data, setData] = useState({ rows: [], agent: '', generated_at: null });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => { if (isAdmin) api.get('/crm/agents').then(({ data }) => setAgents(data.agents || [])).catch(() => {}); }, [isAdmin]);

  const [from, to] = useMemo(() => {
    if (preset === 'custom') return [custom.from ? new Date(custom.from) : null, custom.to ? new Date(`${custom.to}T23:59:59`) : null];
    return range(preset);
  }, [preset, custom]);

  const load = () => {
    setLoading(true);
    const params = {};
    if (from) params.from = from.toISOString();
    if (to) params.to = to.toISOString();
    if (isAdmin && agentId) params.agent_id = agentId;
    api.get('/crm/team-report', { params })
      .then(({ data }) => { setData({ rows: data.rows || [], agent: data.agent, generated_at: data.generated_at }); setErr(''); })
      .catch((e) => setErr(loadError(e, 'the report')))
      .finally(() => setLoading(false));
  };
  useEffect(load, [preset, custom.from, custom.to, agentId]);

  const rows = data.rows;
  const totals = useMemo(() => {
    const t = { leads: rows.length, calls: 0, interested: 0, not_interested: 0, unreachable: 0 };
    for (const r of rows) {
      for (const h of (r.status_timeline || [])) {
        const b = statusMeta(h.status).bucket;
        if (b === 'calls') t.calls += 1;
        else if (b === 'interested') t.interested += 1;
        else if (b === 'not_interested') t.not_interested += 1;
        else if (b === 'unreachable') t.unreachable += 1;
      }
    }
    return t;
  }, [rows]);

  const exportCsv = () => {
    const flat = rows.map((r) => ({
      Name: r.name, Mobile: r.mobile, Status: statusMeta(r.lead_status).label,
      Changes: r.status_changes, Registered: r.is_registered ? 'Yes' : 'No',
      Telecaller: r.agent, LastStatusAt: fmtDateTime(r.last_status_at), Note: r.note,
    }));
    const label = preset === 'custom' ? `${custom.from || 'start'}_${custom.to || 'end'}` : preset;
    download(`lead-report-${label}.csv`, csvOf(flat, ['Name', 'Mobile', 'Status', 'Changes', 'Registered', 'Telecaller', 'LastStatusAt', 'Note']));
  };

  const columns = [
    { key: 'name', label: 'Contact', primary: true, render: (r) => <div><strong>{r.name}</strong><div className="cv-muted" style={{ fontSize: 12 }}>{r.mobile}</div></div> },
    { key: 'status', label: 'Latest status', render: (r) => { const m = statusMeta(r.lead_status); return <Pill tone={m.tone}>{m.emoji} {m.label}</Pill>; } },
    { key: 'changes', label: 'Calls/changes', align: 'right', render: (r) => (r.status_changes ?? 0).toLocaleString('en-IN') },
    ...(isAdmin ? [{ key: 'agent', label: 'Telecaller', medium: false, render: (r) => r.agent || '—' }] : []),
    { key: 'when', label: 'Last status at', align: 'right', medium: false, render: (r) => <span className="cv-muted" style={{ fontSize: 12 }}>{fmtDateTime(r.last_status_at)}</span> },
    { key: 'note', label: 'Last note', medium: false, wrap: 180, render: (r) => r.note || <span className="cv-muted">—</span> },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Reports"
        title={isAdmin ? 'Lead Reports' : 'My Reports'}
        subtitle={`${preset === 'today' ? 'Today' : preset === 'week' ? 'Last 7 days' : preset === 'month' ? 'This month' : preset === 'custom' ? 'Custom range' : 'All time'}${from ? ` · from ${fmtDate(from)}` : ''}`}
        actions={<Button variant="ghost" icon={Download} onClick={exportCsv} disabled={!rows.length}>Export CSV</Button>}
      />

      {err && <div className="cv-alert cv-alert--bad" style={{ marginBottom: 12 }}>{err}</div>}

      <Card flush>
        <div style={{ display: 'flex', gap: 12, padding: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <Segmented
            value={preset}
            onChange={setPreset}
            options={[{ id: 'today', label: 'Day' }, { id: 'week', label: 'Week' }, { id: 'month', label: 'Month' }, { id: 'all', label: 'All' }, { id: 'custom', label: 'Custom' }]}
          />
          {preset === 'custom' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <CalendarRange size={15} style={{ opacity: 0.5 }} />
              <Input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
              <span className="cv-muted">to</span>
              <Input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
            </div>
          )}
          {isAdmin && (
            <Select value={agentId} onChange={(e) => setAgentId(e.target.value)} style={{ marginLeft: 'auto', minWidth: 200 }}>
              <option value="">All telecallers</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          )}
        </div>
      </Card>

      <div className="cv-kpis" style={{ margin: '16px 0' }}>
        <Kpi label="Leads in period" value={totals.leads.toLocaleString('en-IN')} hero />
        <Kpi label="📞 Calls logged" value={totals.calls.toLocaleString('en-IN')} />
        <Kpi label="🟢 Interested" value={totals.interested.toLocaleString('en-IN')} />
        <Kpi label="🔴 Not interested" value={totals.not_interested.toLocaleString('en-IN')} />
        <Kpi label="📱 Unreachable" value={totals.unreachable.toLocaleString('en-IN')} tone="warn" />
      </div>

      <Card flush>
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.mobile} loading={loading} empty="No lead activity in this period." />
      </Card>
    </>
  );
}
