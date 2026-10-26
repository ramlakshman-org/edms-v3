import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Phone, PhoneCall, ThumbsUp, ThumbsDown, PhoneOff, Sparkles, ShieldCheck, Users, ListChecks } from 'lucide-react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Kpi, BarChart, Pill } from '../../civic/kit.jsx';
import { Select, loadError, fmtDateTime } from '../../civic/ui.jsx';
import { statusMeta } from '../../civic/leadStatus.js';

const sum = (arr, keys) => arr.filter((s) => keys.includes(s.status)).reduce((a, s) => a + s.count, 0);

// Telecaller's own dashboard (/team/dashboard) — and the Super-Admin "Telecaller View"
// (/team/view) which shows the same board for any telecaller, read-only, without logging
// in as them (passes ?agent_id= to the scoped endpoints).
export default function TelecallerDashboard({ adminView = false }) {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const agentId = adminView ? (params.get('agent') || '') : '';

  const [agents, setAgents] = useState([]);
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => { if (adminView) api.get('/crm/agents').then(({ data }) => setAgents(data.agents || [])).catch(() => {}); }, [adminView]);

  useEffect(() => {
    if (adminView && !agentId) { setStats(null); setRecent([]); setLoading(false); return; }
    setLoading(true);
    const cfg = agentId ? { params: { agent_id: agentId } } : {};
    const convCfg = agentId ? { params: { agent_id: agentId, limit: 8 } } : { params: { limit: 8 } };
    Promise.all([api.get('/crm/team-stats', cfg), api.get('/crm/conversations', convCfg)])
      .then(([s, c]) => { setStats(s.data.stats || null); setRecent(c.data.conversations || []); setErr(''); })
      .catch((e) => setErr(loadError(e, 'the dashboard')))
      .finally(() => setLoading(false));
  }, [adminView, agentId]);

  const bd = stats?.status_breakdown || [];
  const unreachable = useMemo(() => sum(bd, ['switch_off', 'not_answered', 'will_call_back']), [bd]);
  const chart = (stats?.calls_last_7_days || []).map((d) => ({ label: d.label, value: d.count }));
  const agentName = adminView ? (agents.find((a) => a.id === agentId)?.name || '') : (user?.name || 'You');

  return (
    <div className="cv-page">
      <PageHeader
        eyebrow={adminView ? 'Telecalling' : 'My work'}
        title={adminView ? 'Telecaller View' : 'Dashboard'}
        subtitle={adminView ? 'See any telecaller’s board — read-only, no login needed.' : `${agentName} · your leads, calls and conversions`}
        actions={adminView ? (
          <Select value={agentId} onChange={(e) => setParams(e.target.value ? { agent: e.target.value } : {})} style={{ minWidth: 220 }}>
            <option value="">Select a telecaller…</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        ) : null}
      />

      {err && <div className="cv-alert cv-alert--bad" style={{ marginBottom: 12 }}>{err}</div>}

      {adminView && !agentId && (
        <Card><p className="cv-muted" style={{ padding: 8 }}>Pick a telecaller above to see their dashboard.</p></Card>
      )}

      {stats && (
        <>
          <div className="cv-kpis" style={{ marginBottom: 16 }}>
            <Kpi icon={Users} label="Total leads" value={(stats.total || 0).toLocaleString('en-IN')} note={`${(stats.registered || 0).toLocaleString('en-IN')} registered`} hero />
            <Kpi icon={PhoneCall} label="Total calls done" value={(stats.calls_total || 0).toLocaleString('en-IN')} note={`${(stats.calls_today || 0).toLocaleString('en-IN')} today`} />
            <Kpi icon={ThumbsUp} label="Interested" value={(stats.interested || 0).toLocaleString('en-IN')} tone="ok" />
            <Kpi icon={ThumbsDown} label="Not interested" value={(stats.not_interested || 0).toLocaleString('en-IN')} tone="bad" />
            <Kpi icon={PhoneOff} label="Unreachable / Call back" value={unreachable.toLocaleString('en-IN')} tone="warn" />
            <Kpi icon={Sparkles} label="Converted" value={(stats.converted || 0).toLocaleString('en-IN')} note={`${stats.conversion_rate || 0}% conversion`} tone="ok" />
            <Kpi icon={ShieldCheck} label="Active Pro users" value={(stats.pro || 0).toLocaleString('en-IN')} tone="info" />
          </div>

          <div className="cv-grid-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
            <Card title="Calls — last 7 days">
              <BarChart data={chart} unit={['call', 'calls']} period="day" height={180} />
            </Card>
            <Card title="Lead status mix">
              {bd.filter((s) => s.count > 0).length === 0 ? <p className="cv-muted">No calls logged yet.</p> : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
                  {bd.filter((s) => s.count > 0).map((s) => { const m = statusMeta(s.status); return (
                    <li key={s.status} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Pill tone={m.tone} dot>{m.label}</Pill>
                      <strong>{s.count.toLocaleString('en-IN')}</strong>
                    </li>
                  ); })}
                </ul>
              )}
            </Card>
          </div>

          <Card title="Recent leads" action={<Link className="cv-btn cv-btn--ghost cv-btn--sm" to={adminView ? `/team/crm` : '/team/crm'}><ListChecks size={13} /> Open all</Link>} style={{ marginTop: 16 }}>
            {recent.length === 0 ? <p className="cv-muted">No leads yet.</p> : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
                {recent.map((r) => { const m = statusMeta(r.lead_status); return (
                  <li key={r.clean_mobile} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span><strong>{r.contact_name || `User ${String(r.clean_mobile).slice(-4)}`}</strong> <span className="cv-muted">· {r.clean_mobile}</span></span>
                    <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <Pill tone={m.tone} dot>{m.label}</Pill>
                      <span className="cv-muted" style={{ fontSize: 12 }}>{fmtDateTime(r.last_message_at)}</span>
                    </span>
                  </li>
                ); })}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
