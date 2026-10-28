import { useEffect, useMemo, useState, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  Phone,
  PhoneCall,
  PhoneOff,
  ThumbsUp,
  ThumbsDown,
  Smartphone,
  Sparkles,
  Users,
  ListChecks,
  Headphones,
  Target,
  ArrowRight,
  MessageSquare,
  TrendingUp,
  RefreshCw,
  AlertTriangle,
  CircleCheck,
  CircleAlert,
  Info,
} from 'lucide-react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Kpi, BarChart, Funnel, BarList, Pill } from '../../civic/kit.jsx';
import { Select, Button, Modal, loadError, fmtDateTime, waLink } from '../../civic/ui.jsx';
import { statusMeta } from '../../civic/leadStatus.js';
import { WebPhoneBadge } from '../../civic/webphone.jsx';

const sum = (arr, keys) => arr.filter((s) => keys.includes(s.status)).reduce((a, s) => a + s.count, 0);

const initials = (name, mobile) => {
  const s = String(name || '').replace(/\+?\d+/g, '').trim();
  return s
    ? s.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
    : String(mobile || '?').slice(-2);
};

// Telecaller's own dashboard (/team/dashboard) — and the Super-Admin "Telecaller View"
// (/team/view) which shows the same board for any telecaller, read-only, without logging
// in as them (passes ?agent= to the scoped endpoints).
export default function TelecallerDashboard({ adminView = false }) {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const agentId = adminView ? (params.get('agent') || '') : '';

  const [agents, setAgents] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [teamStats, setTeamStats] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [reassignModal, setReassignModal] = useState(null);
  const [reassignBusy, setReassignBusy] = useState(false);
  const [reassignMsg, setReassignMsg] = useState('');

  // Load team members and agents when in adminView
  const loadTeam = useCallback(() => {
    if (!adminView) return;
    Promise.all([
      api.get('/crm/agents'),
      api.get('/team/members').catch(() => ({ data: { members: [] } })),
      api.get('/team/stats').catch(() => ({ data: { stats: null } })),
      api.get('/crm/admin-leaderboard').catch(() => ({ data: { leaderboard: [] } })),
      api.get('/crm/team-stats').catch(() => ({ data: { stats: null } })),
    ])
      .then(([ag, mem, st, lb, ts]) => {
        setAgents(ag.data.agents || []);
        setTeamMembers(mem.data.members || []);
        setTeamStats(st.data.stats || null);
        setLeaderboard(lb.data.leaderboard || []);
        if (!agentId && ts.data.stats) setStats(ts.data.stats);
      })
      .catch(() => {});
  }, [adminView, agentId]);

  const openReassign = (sourceId, sourceName, count) => {
    setReassignMsg('');
    setReassignModal({ sourceId, sourceName, count });
  };

  const executeReassign = () => {
    if (!reassignModal?.sourceId) return;
    setReassignBusy(true);
    setReassignMsg('');
    api.post('/crm/reassign-agent-leads', { source_agent_id: reassignModal.sourceId, uncontacted_only: true })
      .then(({ data }) => {
        setReassignMsg(data.message || 'Leads successfully reassigned.');
        setTimeout(() => {
          setReassignModal(null);
          refresh();
        }, 1200);
      })
      .catch((e) => setReassignMsg(e?.response?.data?.message || 'Failed to reassign leads.'))
      .finally(() => setReassignBusy(false));
  };

  const loadScoped = useCallback(() => {
    if (adminView && !agentId) {
      setStats(null);
      setRecent([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const cfg = agentId ? { params: { agent_id: agentId } } : {};
    const convCfg = agentId ? { params: { agent_id: agentId, limit: 8 } } : { params: { limit: 8 } };
    Promise.all([api.get('/crm/team-stats', cfg), api.get('/crm/conversations', convCfg)])
      .then(([s, c]) => {
        setStats(s.data.stats || null);
        setRecent(c.data.conversations || []);
        setErr('');
      })
      .catch((e) => setErr(loadError(e, 'the dashboard')))
      .finally(() => setLoading(false));
  }, [adminView, agentId]);

  useEffect(() => { loadTeam(); }, [loadTeam]);
  useEffect(() => { loadScoped(); }, [loadScoped]);

  const refresh = () => { loadTeam(); loadScoped(); };

  const bd = stats?.status_breakdown || [];
  const unreachable = useMemo(() => sum(bd, ['switch_off', 'not_answered', 'will_call_back']), [bd]);
  const chart = (stats?.calls_last_7_days || []).map((d) => ({ label: d.label, value: d.count }));
  const agentObj = agents.find((a) => a.id === agentId);
  const agentName = adminView ? (agentObj?.name || 'Telecaller') : (user?.name || 'You');

  // Daily target calculation (Default: 30 calls/day benchmark)
  const dailyGoal = 30;
  const callsToday = stats?.calls_today || 0;
  const goalPct = Math.min(100, Math.round((callsToday / dailyGoal) * 100));

  const totalStatusCount = useMemo(() => bd.reduce((acc, s) => acc + (s.count || 0), 0), [bd]);

  return (
    <div className="cv-page cv-page--dash">
      <PageHeader
        eyebrow={adminView ? 'Telecalling' : 'My work'}
        title={adminView ? (agentId ? `${agentName}’s Dashboard` : 'Telecaller View') : 'Telecaller Dashboard'}
        subtitle={
          adminView
            ? agentId
              ? `${agentName} · live call velocity, lead conversions & status pipeline`
              : 'Overview across all telecallers — select an agent from the dropdown or click a card below.'
            : `Welcome back, ${agentName}! Your calling pipeline, conversion goals & today’s activity.`
        }
        actions={
          adminView ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Select
                value={agentId}
                onChange={(e) => setParams(e.target.value ? { agent: e.target.value } : {})}
                style={{ minWidth: 200 }}
              >
                <option value="">All Telecallers (Overview)</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
              <button
                type="button"
                className="cv-btn cv-btn--ghost cv-refresh"
                onClick={refresh}
                disabled={loading}
                aria-label="Refresh figures"
              >
                <RefreshCw size={14} className={loading ? 'cv-spin' : ''} />
                <span className="cv-refresh-label">Refresh</span>
              </button>
              <Link to="/team/members" className="cv-btn cv-btn--ghost cv-btn--sm">
                <Users size={13} /> Manage Team
              </Link>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="cv-btn cv-btn--ghost cv-refresh"
                onClick={refresh}
                disabled={loading}
                aria-label="Refresh figures"
              >
                <RefreshCw size={14} className={loading ? 'cv-spin' : ''} />
                <span className="cv-refresh-label">Refresh</span>
              </button>
              <Link to="/team/crm" className="cv-btn cv-btn--sm" style={{ background: '#2563eb', color: '#fff' }}>
                <PhoneCall size={13} /> Calling Queue
              </Link>
              <Link to="/team/inbox" className="cv-btn cv-btn--ghost cv-btn--sm">
                <MessageSquare size={13} /> Shared Inbox
              </Link>
            </div>
          )
        }
      />

      {err && <div className="cv-alert cv-alert--bad" style={{ marginBottom: 12 }}>{err}</div>}

      {/* ── Admin View Overview (when no agent is selected) ── */}
      {adminView && !agentId && (
        <>
          {/* Overdue Callbacks Warning Banner */}
          {stats?.overdue_callbacks > 0 && (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '12px 16px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <AlertTriangle size={20} color="#d97706" style={{ flexShrink: 0 }} />
                <div>
                  <strong style={{ color: '#92400e', fontSize: 13.5 }}>{stats.overdue_callbacks} Overdue Callback{stats.overdue_callbacks > 1 ? 's' : ''} (&gt;24h):</strong>
                  <span style={{ color: '#b45309', marginLeft: 6, fontSize: 13 }}>Candidates promised a callback whose scheduled time has passed or exceeded 24 hours.</span>
                </div>
              </div>
              <Link to="/team/crm?filter=overdue_callbacks" className="cv-btn cv-btn--sm" style={{ background: '#d97706', color: '#fff', border: 'none' }}>
                Inspect Overdue Leads
              </Link>
            </div>
          )}

          {/* Short Calls Audit Banner */}
          {stats?.short_calls > 0 && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '12px 16px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <PhoneOff size={20} color="#dc2626" style={{ flexShrink: 0 }} />
                <div>
                  <strong style={{ color: '#991b1b', fontSize: 13.5 }}>{stats.short_calls} Short Call{stats.short_calls > 1 ? 's' : ''} (&lt;10s duration):</strong>
                  <span style={{ color: '#b91c1c', marginLeft: 6, fontSize: 13 }}>Completed calls with less than 10 seconds talk time flagged for quality review.</span>
                </div>
              </div>
              <Link to="/team/crm?filter=short_calls" className="cv-btn cv-btn--sm" style={{ background: '#dc2626', color: '#fff', border: 'none' }}>
                Review Short Calls
              </Link>
            </div>
          )}

          {teamStats && (
            <div className="cv-kpis cv-kpis--even" style={{ marginBottom: 20 }}>
              <Kpi
                icon={Headphones}
                label="Team members"
                value={(teamStats.total_team_members || 0).toLocaleString('en-IN')}
                note={`${agents.length} active`}
              />
              <Kpi
                icon={Users}
                label="Total assigned leads"
                value={(teamStats.total_leads || 0).toLocaleString('en-IN')}
                to="/team/crm"
              />
              <Kpi
                icon={PhoneCall}
                label="Calls completed"
                value={(teamStats.calls_completed || 0).toLocaleString('en-IN')}
                tone="info"
              />
              <Kpi
                icon={ThumbsUp}
                label="Interested leads"
                value={(teamStats.interested || 0).toLocaleString('en-IN')}
                tone="ok"
              />
              <Kpi
                icon={PhoneOff}
                label="Unreachable"
                value={(
                  (teamStats.switch_off || 0) +
                  (teamStats.not_answered || 0) +
                  (teamStats.will_call_back || 0)
                ).toLocaleString('en-IN')}
                tone="warn"
              />
              <Kpi
                icon={Sparkles}
                label="Active Pro users"
                value={(teamStats.pro_users || 0).toLocaleString('en-IN')}
                tone="info"
                to="/team/payments"
              />
            </div>
          )}

          {/* Side-by-Side Calling Velocity Leaderboard */}
          {leaderboard.length > 0 && (
            <Card
              title="Today’s Calling Velocity & Leaderboard"
              meta="Real-time comparative performance across all active telecallers today (Benchmark: 30 calls/day)."
            >
              <div style={{ overflowX: 'auto' }}>
                <table className="cv-table" style={{ width: '100%', fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>Telecaller</th>
                      <th style={{ textAlign: 'right' }}>Calls Today</th>
                      <th style={{ textAlign: 'center' }}>Daily Target (30)</th>
                      <th style={{ textAlign: 'right' }}>Total Talk Time</th>
                      <th style={{ textAlign: 'right' }}>Interested</th>
                      <th style={{ textAlign: 'right' }}>Converted</th>
                      <th style={{ textAlign: 'right' }}>Untouched Leads</th>
                      <th style={{ textAlign: 'left' }}>Last Active</th>
                      <th style={{ textAlign: 'center' }}>Quick Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.map((a) => (
                      <tr key={a.id}>
                        <td>
                          <strong>{a.name}</strong>
                          <div className="cv-muted" style={{ fontSize: 11 }}>{a.total_leads} total leads</div>
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600, color: a.calls_today >= 30 ? '#16a34a' : '#2563eb' }}>
                          {a.calls_today}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
                            <div style={{ width: 60, height: 6, background: '#e2e8f0', borderRadius: 3, overflow: 'hidden' }}>
                              <div style={{ width: `${a.target_pct}%`, height: '100%', background: a.target_pct >= 100 ? '#16a34a' : '#2563eb' }} />
                            </div>
                            <span style={{ fontSize: 11, fontWeight: 500 }}>{a.target_pct}%</span>
                          </div>
                        </td>
                        <td style={{ textAlign: 'right' }}>{a.talk_time_formatted}</td>
                        <td style={{ textAlign: 'right', color: '#16a34a', fontWeight: 500 }}>{a.interested}</td>
                        <td style={{ textAlign: 'right', color: '#9333ea', fontWeight: 600 }}>{a.converted}</td>
                        <td style={{ textAlign: 'right', color: a.untouched_leads > 20 ? '#d97706' : '#64748b' }}>
                          {a.untouched_leads}
                        </td>
                        <td>
                          <span className="cv-muted" style={{ fontSize: 12 }}>
                            {a.last_active ? fmtDateTime(a.last_active) : 'No calls yet'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                            <button
                              type="button"
                              className="cv-btn cv-btn--ghost cv-btn--sm"
                              style={{ fontSize: 11, padding: '2px 8px' }}
                              onClick={() => setParams({ agent: a.id })}
                            >
                              Inspect
                            </button>
                            {a.untouched_leads > 0 && (
                              <button
                                type="button"
                                className="cv-btn cv-btn--ghost cv-btn--sm"
                                style={{ fontSize: 11, padding: '2px 8px', color: '#dc2626' }}
                                onClick={(e) => { e.stopPropagation(); openReassign(a.id, a.name, a.untouched_leads); }}
                              >
                                Reassign ({a.untouched_leads})
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <Card
            title="Telecalling Team Directory"
            meta="Click any telecaller to inspect their individual dashboard, calling velocity, and lead outcomes."
            action={
              <Link to="/team/members" className="cv-btn cv-btn--ghost cv-btn--sm">
                <Users size={13} /> Full Team Table
              </Link>
            }
          >
            {teamMembers.length === 0 ? (
              <p className="cv-muted" style={{ padding: 12 }}>
                No telecallers created yet.{' '}
                <Link to="/team/members" className="cv-link">
                  Create team credentials
                </Link>
                .
              </p>
            ) : (
              <div className="cv-tele-grid" style={{ marginTop: 8 }}>
                {teamMembers.map((m) => (
                  <div
                    key={m.id}
                    className="cv-tele-card"
                    onClick={() => setParams({ agent: m.id })}
                    title={`Inspect ${m.name}'s dashboard`}
                  >
                    <div className="cv-tele-head">
                      <div className="cv-tele-ava">{initials(m.name, m.mobile)}</div>
                      <div className="cv-tele-info">
                        <div className="cv-tele-name">{m.name}</div>
                        <div className="cv-tele-sub">
                          <span>@{m.username}</span>
                          {m.mobile && <span>· {m.mobile}</span>}
                        </div>
                      </div>
                      <Pill tone={m.is_active ? 'ok' : 'bad'} dot>
                        {m.is_active ? 'Active' : 'Inactive'}
                      </Pill>
                    </div>

                    <div className="cv-tele-stats-grid">
                      <div className="cv-tele-stat-cell">
                        <span className="cv-tele-stat-val">
                          {(m.stats?.total_handled ?? 0).toLocaleString('en-IN')}
                        </span>
                        <span className="cv-tele-stat-lbl">Leads</span>
                      </div>
                      <div className="cv-tele-stat-cell">
                        <span className="cv-tele-stat-val" style={{ color: '#2563eb' }}>
                          {(m.stats?.calls_completed ?? 0).toLocaleString('en-IN')}
                        </span>
                        <span className="cv-tele-stat-lbl">Calls</span>
                      </div>
                      <div className="cv-tele-stat-cell">
                        <span className="cv-tele-stat-val" style={{ color: '#16a34a' }}>
                          {(m.stats?.interested ?? 0).toLocaleString('en-IN')}
                        </span>
                        <span className="cv-tele-stat-lbl">Interested</span>
                      </div>
                      <div className="cv-tele-stat-cell">
                        <span className="cv-tele-stat-val" style={{ color: '#9333ea' }}>
                          {(m.stats?.pro_users ?? 0).toLocaleString('en-IN')}
                        </span>
                        <span className="cv-tele-stat-lbl">Pro</span>
                      </div>
                    </div>

                    <div className="cv-tele-foot">
                      <span className="cv-muted" style={{ fontSize: 12 }}>
                        {m.stats?.calls_completed
                          ? `Avg conversion: ${Math.round(
                              ((m.stats?.interested || 0) / Math.max(1, m.stats?.calls_completed || 1)) * 100
                            )}%`
                          : 'Ready for calls'}
                      </span>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          color: 'var(--cv-accent)',
                          fontWeight: 600,
                          fontSize: 12.5,
                        }}
                      >
                        Inspect Board <ArrowRight size={13} />
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}

      {/* ── Scoped Dashboard (Telecaller or Selected Agent in adminView) ── */}
      {stats && (
        <>
          {/* 1 · What needs attention today: target status & priority follow-ups (matching Screenshot 2 attention strip) */}
          <nav className="cv-attn-strip" aria-label="Needs attention" style={{ marginBottom: 16 }}>
            <div className="cv-attn-group">
              <span className="cv-attn-group-label">Waiting on you</span>
              <div className="cv-attn-chips">
                <Link
                  to={adminView ? `/team/crm?agent_id=${agentId}` : '/team/crm'}
                  className="cv-attn-chip cv-attn-chip--lead"
                  title={`${callsToday} of ${dailyGoal} calls logged today`}
                >
                  <Target size={14} />
                  <span>
                    <strong>{callsToday} of {dailyGoal} calls logged</strong> · {goalPct}% of daily target{dailyGoal - callsToday > 0 ? ` (${dailyGoal - callsToday} more calls needed)` : ' (target reached!)'}
                  </span>
                </Link>
                {unreachable > 0 && (
                  <Link
                    to={adminView ? `/team/crm?status=switch_off&agent_id=${agentId}` : '/team/crm?status=switch_off'}
                    className="cv-attn-chip cv-attn-chip--warn"
                    title="Unreachable contacts scheduled for re-dial"
                  >
                    <AlertTriangle size={14} />
                    <span>
                      <strong>{unreachable} unreachable</strong> · scheduled for re-dial
                    </span>
                  </Link>
                )}
                {(stats.interested || 0) > 0 && (
                  <Link
                    to={adminView ? `/team/crm?status=interested&agent_id=${agentId}` : '/team/crm?status=interested'}
                    className="cv-attn-chip"
                    title="Interested leads ready for conversion"
                  >
                    <ThumbsUp size={14} />
                    <span>
                      <strong>{stats.interested} interested leads</strong> · follow-up ready
                    </span>
                  </Link>
                )}
              </div>
            </div>
          </nav>

          {/* 2 · KPI Strip (All white cards alone matching Screenshot 2) */}
          <div className="cv-kpis cv-kpis--even" style={{ marginBottom: 16 }}>
            <Kpi
              icon={Users}
              label="Total leads"
              value={(stats.total || 0).toLocaleString('en-IN')}
              note={`${(stats.registered || 0).toLocaleString('en-IN')} registered`}
              to={adminView ? `/team/crm?agent_id=${agentId}` : '/team/crm'}
            />
            <Kpi
              icon={PhoneCall}
              label="Calls completed"
              value={(stats.calls_total || 0).toLocaleString('en-IN')}
              note={`${callsToday.toLocaleString('en-IN')} today`}
              tone="info"
            />
            <Kpi
              icon={ThumbsUp}
              label="Interested leads"
              value={(stats.interested || 0).toLocaleString('en-IN')}
              note={
                stats.calls_total
                  ? `${Math.round(((stats.interested || 0) / Math.max(1, stats.calls_total)) * 100)}% of calls`
                  : undefined
              }
              tone="ok"
              to={adminView ? `/team/crm?status=interested&agent_id=${agentId}` : '/team/crm'}
            />
            <Kpi
              icon={ThumbsDown}
              label="Not interested"
              value={(stats.not_interested || 0).toLocaleString('en-IN')}
              tone="bad"
            />
            <Kpi
              icon={PhoneOff}
              label="Unreachable / Call back"
              value={unreachable.toLocaleString('en-IN')}
              note="Scheduled for re-dial"
              tone="warn"
            />
            <Kpi
              icon={Sparkles}
              label="Converted"
              value={(stats.converted || 0).toLocaleString('en-IN')}
              note={`${stats.conversion_rate || 0}% conversion`}
              tone="ok"
            />
            <Kpi
              icon={Sparkles}
              label="Active Pro users"
              value={(stats.pro || 0).toLocaleString('en-IN')}
              note="Paid subscription"
              tone="info"
              to={adminView ? `/team/crm?scope=paid` : '/team/payments'}
            />
          </div>

          {/* 3 · Trends section head matching Screenshot 2 */}
          <div className="cv-section-head">
            <h2>Trends</h2>
            <p>Calling velocity and lead pipeline</p>
          </div>

          <div className="cv-grid cv-grid--2-1" style={{ marginBottom: 16 }}>
            <Card
              title="Calls velocity"
              meta="Daily completed calls recorded by softphone & dialer"
            >
              <BarChart data={chart} unit={['call', 'calls']} period="day" height={200} />
            </Card>

            <Card
              title="Candidate pipeline"
              meta={`${(stats.total || 0).toLocaleString('en-IN')} assigned leads, from intake to converted`}
            >
              <Funnel
                steps={[
                  { label: 'Assigned leads', value: stats.total || 0 },
                  { label: 'Calls logged', value: stats.calls_total || 0 },
                  { label: 'Interested', value: stats.interested || 0 },
                  { label: 'Converted', value: stats.converted || 0 },
                  { label: 'Active Pro', value: stats.pro || 0 },
                ]}
              />
            </Card>
          </div>

          {bd.filter((s) => s.count > 0).length > 0 && (
            <div className="cv-grid cv-grid--1-1" style={{ marginBottom: 16 }}>
              <Card
                title="Lead status breakdown"
                meta={`${totalStatusCount.toLocaleString('en-IN')} status updates logged across assigned leads`}
              >
                <BarList
                  items={bd
                    .filter((s) => s.count > 0)
                    .sort((a, b) => b.count - a.count)
                    .map((s) => {
                      const m = statusMeta(s.status);
                      return {
                        label: m.label,
                        value: s.count,
                      };
                    })}
                />
              </Card>

              <Card
                title="Performance overview"
                meta="Conversion efficiency & call completion"
              >
                <div className="cv-splits" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, padding: '8px 0' }}>
                  <div style={{ padding: 12, background: 'var(--cv-subtle)', borderRadius: 'var(--cv-r-md)' }}>
                    <span className="cv-muted" style={{ fontSize: 12 }}>Conversion Rate</span>
                    <strong style={{ display: 'block', fontSize: 22, marginTop: 4, color: 'var(--cv-ok)' }}>
                      {stats.conversion_rate || 0}%
                    </strong>
                  </div>
                  <div style={{ padding: 12, background: 'var(--cv-subtle)', borderRadius: 'var(--cv-r-md)' }}>
                    <span className="cv-muted" style={{ fontSize: 12 }}>Interested Ratio</span>
                    <strong style={{ display: 'block', fontSize: 22, marginTop: 4, color: 'var(--cv-accent)' }}>
                      {stats.calls_total ? Math.round(((stats.interested || 0) / Math.max(1, stats.calls_total)) * 100) : 0}%
                    </strong>
                  </div>
                  <div style={{ padding: 12, background: 'var(--cv-subtle)', borderRadius: 'var(--cv-r-md)' }}>
                    <span className="cv-muted" style={{ fontSize: 12 }}>Calls Logged Today</span>
                    <strong style={{ display: 'block', fontSize: 22, marginTop: 4 }}>
                      {callsToday} / {dailyGoal}
                    </strong>
                  </div>
                  <div style={{ padding: 12, background: 'var(--cv-subtle)', borderRadius: 'var(--cv-r-md)' }}>
                    <span className="cv-muted" style={{ fontSize: 12 }}>Pending Follow-ups</span>
                    <strong style={{ display: 'block', fontSize: 22, marginTop: 4, color: unreachable > 0 ? 'var(--cv-warn)' : 'var(--cv-muted)' }}>
                      {unreachable}
                    </strong>
                  </div>
                </div>
              </Card>
            </div>
          )}

          {/* 4 · Recent Leads & Calling Queue */}
          <Card
            flush
            title="Recent Activity & Assigned Leads"
            meta="Quickly dial or follow up with your most recent contacts."
            action={
              <Link
                className="cv-btn cv-btn--ghost cv-btn--sm"
                to={adminView ? `/team/crm?agent_id=${agentId}` : '/team/crm'}
              >
                <ListChecks size={13} /> View Full Queue
              </Link>
            }
          >
            {recent.length === 0 ? (
              <p className="cv-muted" style={{ padding: 16 }}>
                No assigned leads yet.
              </p>
            ) : (
              <ul className="cv-lead-list">
                {recent.map((r) => {
                  const m = statusMeta(r.lead_status);
                  const leadName = r.contact_name || `Candidate ${String(r.clean_mobile).slice(-4)}`;
                  return (
                    <li key={r.clean_mobile} className="cv-lead-item">
                      <div className="cv-lead-left">
                        <div className="cv-lead-ava">{initials(r.contact_name, r.clean_mobile)}</div>
                        <div className="cv-lead-main">
                          <div className="cv-lead-name-row">
                            <span className="cv-lead-name">{leadName}</span>
                            {r.is_registered && <Pill tone="ok">Registered</Pill>}
                            {r.is_pro && <Pill tone="info" icon={Sparkles}>Pro</Pill>}
                          </div>
                          <div className="cv-lead-sub">
                            <span className="cv-mono-sm" style={{ fontWeight: 500, color: 'var(--cv-ink-2)' }}>{r.clean_mobile}</span>
                            {r.district && r.district !== '-' && <span>· {r.district}</span>}
                            {r.assembly && r.assembly !== '-' && <span>· AC {r.assembly}</span>}
                          </div>
                        </div>
                      </div>

                      <div className="cv-lead-right">
                        <Pill tone={m.tone} dot>
                          {m.label}
                        </Pill>
                        <span className="cv-muted" style={{ fontSize: 12 }}>
                          {fmtDateTime(r.last_message_at)}
                        </span>
                        <div className="cv-lead-actions">
                          <a
                            href={`tel:${r.clean_mobile}`}
                            className="cv-icon-btn cv-icon-btn--sm"
                            title="Call contact"
                          >
                            <Phone size={13} style={{ color: '#2563eb' }} />
                          </a>
                          <a
                            href={waLink(r.clean_mobile)}
                            target="_blank"
                            rel="noreferrer"
                            className="cv-icon-btn cv-icon-btn--sm cv-wa"
                            title="Open WhatsApp"
                          >
                            <MessageSquare size={13} />
                          </a>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </>
      )}

      {/* Modal: Reassign Untouched Leads */}
      <Modal
        open={!!reassignModal}
        title={reassignModal ? `Reassign Untouched Leads from ${reassignModal.sourceName}` : 'Reassign Leads'}
        onClose={() => setReassignModal(null)}
        width={500}
      >
        {reassignModal && (
          <div style={{ display: 'grid', gap: 14 }}>
            <p style={{ margin: 0, fontSize: 13.5, color: '#1e293b' }}>
              Are you sure you want to redistribute <strong>{reassignModal.count} untouched lead(s)</strong> assigned to <strong>{reassignModal.sourceName}</strong>?
            </p>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '12px 14px', borderRadius: 8, fontSize: 12.5, color: '#475569', lineHeight: 1.6 }}>
              • <strong>Safe & Targeted:</strong> Only uncalled leads (0 attempts) are reassigned.<br />
              • <strong>Round-Robin:</strong> Leads are distributed evenly across the other active telecallers.<br />
              • <strong>Sticky Integrity:</strong> In-progress and completed candidate threads stay untouched.
            </div>
            {reassignMsg && (
              <div className={`cv-alert ${reassignMsg.includes('Success') || reassignMsg.includes('reassigned') ? 'cv-alert--ok' : 'cv-alert--bad'}`}>
                {reassignMsg}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
              <Button variant="ghost" onClick={() => setReassignModal(null)} disabled={reassignBusy}>Cancel</Button>
              <Button onClick={executeReassign} disabled={reassignBusy} style={{ background: '#dc2626', color: '#fff', border: 'none' }}>
                {reassignBusy ? 'Reassigning…' : `Reassign ${reassignModal.count} Leads`}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
