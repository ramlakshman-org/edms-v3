import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Phone,
  PhoneCall,
  PhoneOff,
  MessageCircle,
  Search,
  Shuffle,
  StickyNote,
  Clock,
  UserCheck,
  Hand,
  Eye,
  Users,
  ClipboardList,
  Crown,
  ThumbsUp,
  Star,
  UserPlus,
  CreditCard,
  RefreshCw,
  Info,
  Sparkles,
  Lock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  BarChart3,
  Send,
} from 'lucide-react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useWebPhone, WebPhoneBadge } from '../../civic/webphone.jsx';
import { PageHeader, Card, Pill, Kpi, inr } from '../../civic/kit.jsx';
import { DataTable, Pager, Button, Select, Input, Modal, Textarea, Field, loadError, fmtDateTime, waLink } from '../../civic/ui.jsx';
import { statusMeta, STATUS_BUTTONS, PRIMARY_OUTCOMES, CALL_MILESTONES } from '../../civic/leadStatus.js';

const PAGE_SIZE = 50;

const initials = (name, mobile) => {
  const s = String(name || '').replace(/\+?\d+/g, '').trim();
  return s
    ? s.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
    : String(mobile || '?').slice(-2);
};

// CRM lead workspace. Admins see every conversation (filter by telecaller, assign,
// distribute); telecallers see only their own assigned leads. `scope` narrows the
// list for the telecaller follow-up menus (unregistered / registered / paid).
export default function CrmLeads({ scope = 'all', title = 'Telecalling Workspace', subtitle }) {
  const { user } = useAuth();
  const isAdmin = Number(user?.group_id || user?.user_group_id) === 1;
  const [searchParams, setSearchParams] = useSearchParams();

  const queueParam = searchParams.get('queue'); // 'incomplete' | 'registered'
  const scopeParam = searchParams.get('scope') || scope; // 'paid' | 'all'

  const activeQueue = queueParam === 'incomplete' || scopeParam === 'unregistered'
    ? 'incomplete'
    : queueParam === 'registered' || scopeParam === 'registered'
    ? 'registered'
    : scopeParam === 'paid'
    ? 'paid'
    : 'all';

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [paidTab, setPaidTab] = useState('received'); // 'received' | 'interested' | 'all'
  const [agentId, setAgentId] = useState('');
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null); // selected conversation (drawer)

  // Task 2: Auto-snooze and actionable queue view
  const [hideSnoozed, setHideSnoozed] = useState(true);

  // Task 3: 8:00 PM Daily Performance Digest
  const [digestOpen, setDigestOpen] = useState(false);
  const [digestLoading, setDigestLoading] = useState(false);
  const [digestData, setDigestData] = useState(null);
  const [digestPhone, setDigestPhone] = useState('');
  const [digestStatus, setDigestStatus] = useState('');

  const [canClaim, setCanClaim] = useState(false);
  useEffect(() => { if (isAdmin) api.get('/crm/agents').then(({ data }) => setAgents(data.agents || [])).catch(() => {}); }, [isAdmin]);
  useEffect(() => { api.get('/crm/settings').then(({ data }) => setCanClaim(!!data.config?.claim_unassigned)).catch(() => {}); }, []);
  useEffect(() => {
    const onLeadUpdated = () => load();
    window.addEventListener('crm-lead-updated', onLeadUpdated);
    return () => window.removeEventListener('crm-lead-updated', onLeadUpdated);
  }, []);

  const load = () => {
    setLoading(true);
    const params = { page, limit: PAGE_SIZE };
    if (search.trim()) params.search = search.trim();
    if (statusFilter !== 'all') params.lead_status = statusFilter;
    if (isAdmin && agentId) params.agent_id = agentId;
    api.get('/crm/conversations', { params })
      .then(({ data }) => { setRows(data.conversations || []); setTotal(data.total || 0); setErr(''); })
      .catch((e) => setErr(loadError(e, 'conversations')))
      .finally(() => setLoading(false));
  };
  useEffect(load, [page, agentId, statusFilter]);
  useEffect(() => { const t = setTimeout(() => { setPage(1); load(); }, 350); return () => clearTimeout(t); }, [search]);

  // Queue counts calculated across the loaded dataset
  const incompleteCount = useMemo(() => rows.filter((r) => !r.is_registered).length, [rows]);
  const registeredCount = useMemo(() => rows.filter((r) => r.is_registered).length, [rows]);
  const paidCount = useMemo(() => rows.filter((r) => r.is_pro).length, [rows]);
  const snoozedCount = useMemo(() => rows.filter((r) => r.is_snoozed).length, [rows]);

  // Client-side queue filter + Snooze hiding + Priority Sorting
  const view = useMemo(() => {
    let list = rows.filter((r) => {
      if (activeQueue === 'incomplete') return !r.is_registered;
      if (activeQueue === 'registered') return r.is_registered;
      if (activeQueue === 'paid') {
        if (paidTab === 'received') return r.is_pro;
        if (paidTab === 'interested') return r.lead_status === 'interested';
        return true;
      }
      return true;
    });

    if (hideSnoozed) {
      list = list.filter((r) => !r.is_snoozed);
    }

    // High-leverage sorting: Leads that are DUE (scheduled callback or retry due) float to the top
    return list.slice().sort((a, b) => {
      if (a.is_due && !b.is_due) return -1;
      if (!a.is_due && b.is_due) return 1;
      return 0;
    });
  }, [rows, activeQueue, paidTab, hideSnoozed]);

  const setQueue = (q) => {
    setPage(1);
    if (q === 'all') setSearchParams({});
    else if (q === 'paid') setSearchParams({ scope: 'paid' });
    else setSearchParams({ queue: q });
  };

  // Summary statistics for KPI cards
  const stats = useMemo(() => {
    const list = activeQueue === 'paid' ? rows : view;
    const registered = list.filter((r) => r.is_registered).length;
    const pro = list.filter((r) => r.is_pro).length;
    const interested = list.filter((r) => r.lead_status === 'interested').length;
    const unreachable = list.filter((r) => ['switch_off', 'not_answered', 'will_call_back'].includes(r.lead_status)).length;
    const converted = list.filter((r) => ['converted', 'registration_completed'].includes(r.lead_status)).length;
    return { total: list.length, registered, pro, interested, unreachable, converted };
  }, [rows, view, activeQueue]);

  const refreshOpen = (phone) =>
    api.get(`/crm/conversations/${phone}`)
      .then(({ data }) => setOpen({ ...data.contact, _history: data.contact.status_history || [] }))
      .catch(() => {});

  const columns = [
    {
      key: 'contact',
      label: 'Contact',
      primary: true,
      render: (r) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="cv-lead-ava">{initials(r.contact_name, r.clean_mobile)}</div>
          <div className="cv-two">
            <strong>{r.contact_name || `Candidate ${String(r.clean_mobile || '').slice(-4)}`}</strong>
            <span className="cv-muted">
              <span className="cv-mono-sm">{r.clean_mobile}</span>
              {r.district ? ` · ${r.district}` : ''}
              {r.assembly ? ` · AC ${r.assembly}` : ''}
            </span>
          </div>
        </div>
      ),
    },
    {
      key: 'flags',
      label: 'Candidate',
      medium: false,
      render: (r) => (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Pill tone={r.is_registered ? 'ok' : 'neutral'} dot>
            {r.is_registered ? 'Registered' : 'Not registered'}
          </Pill>
          {r.is_pro && <Pill tone="info" icon={Sparkles}>Pro</Pill>}
        </div>
      ),
    },
    {
      key: 'status',
      label: 'Lead status',
      render: (r) => {
        const m = statusMeta(r.lead_status);
        const attempts = Number(r.call_attempts) || 0;
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
            <Pill tone={m.tone} dot>{m.label}</Pill>
            {r.is_due && r.lead_status === 'call_back' && (
              <span style={{ fontSize: 11, fontWeight: 700, color: '#1d4ed8', background: '#dbeafe', padding: '1px 6px', borderRadius: 4 }}>
                ⏰ Callback Due Now
              </span>
            )}
            {r.is_due && attempts > 0 && ['not_answered', 'switch_off'].includes(r.lead_status) && (
              <span style={{ fontSize: 11, fontWeight: 700, color: '#b45309', background: '#fef3c7', padding: '1px 6px', borderRadius: 4 }}>
                🔄 Retry #{attempts + 1} Due
              </span>
            )}
            {r.is_snoozed && (
              <span style={{ fontSize: 11, color: '#64748b', background: '#f1f5f9', padding: '1px 6px', borderRadius: 4 }}>
                ⏳ Snoozed until {new Date(r.snooze_until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            {r.archived && (
              <span style={{ fontSize: 11, color: '#b91c1c', background: '#fee2e2', padding: '1px 6px', borderRadius: 4 }}>
                🚫 3 Strikes (Archived)
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: 'agent',
      label: 'Telecaller',
      medium: false,
      render: (r) =>
        r.assigned_agent_id ? (
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            {r.assigned_agent_name || 'Assigned'}
            {r.taken && <Pill tone="info" icon={Lock}>Claimed</Pill>}
          </span>
        ) : (
          <Pill tone="warn">Unassigned</Pill>
        ),
    },
    {
      key: 'last',
      label: 'Last activity',
      align: 'right',
      medium: false,
      render: (r) => (
        <span className="cv-muted cv-mono-sm" style={{ fontSize: 12 }}>
          {fmtDateTime(r.last_message_at)}
        </span>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (r) => (
        <div className="cv-row-actions" onClick={(e) => e.stopPropagation()}>
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
            <MessageCircle size={13} />
          </a>
          <button
            type="button"
            className="cv-icon-btn cv-icon-btn--sm"
            title="Open lead details & log call"
            onClick={() => refreshOpen(r.phone || r.clean_mobile)}
          >
            <Eye size={13} />
          </button>
        </div>
      ),
    },
  ];

  const paidColumns = [
    {
      key: 'contact',
      label: 'Candidate',
      primary: true,
      render: (r) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="cv-lead-ava">{initials(r.contact_name, r.clean_mobile)}</div>
          <div className="cv-two">
            <strong>{r.contact_name || `Candidate ${String(r.clean_mobile || '').slice(-4)}`}</strong>
            <span className="cv-muted cv-mono-sm">{r.clean_mobile}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'type',
      label: 'Type',
      render: (r) => (
        <div className="cv-two">
          <span>{r.position || (r.is_pro ? 'Active Pro' : 'Candidate')}</span>
          <span className="cv-muted">{r.local_body && r.local_body !== '-' ? r.local_body : (r.is_registered ? 'Registered' : 'Lead')}</span>
        </div>
      ),
    },
    {
      key: 'district',
      label: 'District · Assembly',
      render: (r) => (
        <div className="cv-two">
          <span>{r.district && r.district !== '-' ? r.district : '—'}</span>
          <span className="cv-muted">{r.assembly ? `AC ${r.assembly}` : ''}</span>
        </div>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (r) => {
        if (r.is_pro) return <Pill tone="ok" dot>Approved</Pill>;
        const m = statusMeta(r.lead_status);
        return <Pill tone={m.tone} dot>{m.label}</Pill>;
      },
    },
    {
      key: 'telecaller',
      label: 'Telecaller',
      medium: false,
      render: (r) =>
        r.assigned_agent_name ? (
          <span>{r.assigned_agent_name}</span>
        ) : (
          <Pill tone="neutral">Assigned</Pill>
        ),
    },
    {
      key: 'last',
      label: 'Last activity',
      align: 'right',
      render: (r) => (
        <span className="cv-muted cv-mono-sm" style={{ fontSize: 12 }}>
          {fmtDateTime(r.last_message_at)}
        </span>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (r) => (
        <div className="cv-row-actions" onClick={(e) => e.stopPropagation()}>
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
            <MessageCircle size={13} />
          </a>
          <button
            type="button"
            className="cv-icon-btn cv-icon-btn--sm"
            title="Open lead details & log call"
            onClick={() => refreshOpen(r.phone || r.clean_mobile)}
          >
            <Eye size={13} />
          </button>
        </div>
      ),
    },
  ];

  const distribute = () => {
    if (!window.confirm('Distribute all unassigned WhatsApp conversations across active team members (round-robin)?')) return;
    setBusy(true);
    api.post('/crm/distribute-leads', {})
      .then(({ data }) => { setMsg(data.message || 'Distributed.'); load(); })
      .catch((e) => setErr(e?.response?.data?.message || 'Could not distribute.'))
      .finally(() => setBusy(false));
  };

  const pageEyebrow = 'Telecalling';
  const pageTitle =
    activeQueue === 'incomplete'
      ? 'Incomplete Registrations Queue'
      : activeQueue === 'registered'
      ? 'Registered Candidates Queue'
      : activeQueue === 'paid'
      ? 'Payment Follow-up Queue'
      : 'Telecalling Workspace';

  return (
    <div className="cv-page">
      <PageHeader
        eyebrow={pageEyebrow}
        title={pageTitle}
        subtitle={
          activeQueue === 'incomplete'
            ? 'Candidates who dropped off during registration. Call via softphone to guide them through booth selection.'
            : activeQueue === 'registered'
            ? 'Active candidates. Call via softphone to demonstrate the dashboard and pitch the Pro booth plan.'
            : activeQueue === 'paid'
            ? 'Verify UPI QR payment proofs and manage Pro plan activations.'
            : 'All assigned leads. Click “Call” to ring via TeleCMI softphone, then log outcomes.'
        }
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <WebPhoneBadge />
            <Button variant="ghost" icon={RefreshCw} onClick={load} disabled={loading}>
              Refresh
            </Button>

            {isAdmin && (
              <>
                <Button
                  variant="ghost"
                  icon={BarChart3}
                  onClick={() => {
                    setDigestLoading(true);
                    setDigestStatus('');
                    api.get('/crm/admin/daily-digest')
                      .then(({ data }) => { setDigestData(data.digest); setDigestOpen(true); })
                      .catch((e) => setErr(e?.response?.data?.message || 'Could not load digest.'))
                      .finally(() => setDigestLoading(false));
                  }}
                  disabled={digestLoading}
                >
                  8 PM Digest
                </Button>
                <Button variant="ghost" icon={Shuffle} onClick={distribute} disabled={busy}>
                  Distribute
                </Button>
              </>
            )}
          </div>
        }
      />

      {err && <div className="cv-alert cv-alert--bad" style={{ marginBottom: 12 }}>{err}</div>}
      {msg && <div className="cv-alert cv-alert--ok" style={{ marginBottom: 12 }} onClick={() => setMsg('')}>{msg}</div>}

      {/* Primary Category Queue Tabs */}
      <div className="cv-tabs-row" style={{ marginBottom: 16, background: '#ffffff', borderRadius: 8, border: '1px solid var(--cv-line, #e2e8f0)', padding: '4px 8px' }}>
        <div className="cv-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeQueue === 'incomplete'}
            className={`cv-tab ${activeQueue === 'incomplete' ? 'cv-tab--on' : ''}`}
            onClick={() => setQueue('incomplete')}
          >
            🟡 Incomplete Registrations <span className="cv-tab-count">{incompleteCount}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeQueue === 'registered'}
            className={`cv-tab ${activeQueue === 'registered' ? 'cv-tab--on' : ''}`}
            onClick={() => setQueue('registered')}
          >
            🟢 Registered Candidates <span className="cv-tab-count">{registeredCount}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeQueue === 'paid'}
            className={`cv-tab ${activeQueue === 'paid' ? 'cv-tab--on' : ''}`}
            onClick={() => setQueue('paid')}
          >
            Payment Follow-up <span className="cv-tab-count">{paidCount}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeQueue === 'all'}
            className={`cv-tab ${activeQueue === 'all' ? 'cv-tab--on' : ''}`}
            onClick={() => setQueue('all')}
          >
            All Leads <span className="cv-tab-count">{rows.length}</span>
          </button>
        </div>
      </div>

      {/* Contextual Queue Guidance Notice */}
      {activeQueue === 'incomplete' && (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#92400e', display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <Info size={16} style={{ flexShrink: 0 }} />
          <span><strong>Incomplete Queue:</strong> Candidates who started bot or web signup but dropped off before booth selection. <strong>Goal:</strong> Call via TeleCMI to assist registration & explain voter roll advantages.</span>
        </div>
      )}

      {activeQueue === 'registered' && (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#166534', display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <CheckCircle2 size={16} style={{ flexShrink: 0 }} />
          <span><strong>Registered Queue:</strong> Candidates with active accounts. <strong>Goal:</strong> Walk them through their candidate portal and pitch the Pro Plan to unlock full booth slips.</span>
        </div>
      )}

      {/* KPI Metrics Summary Strip */}
      <div className={`cv-kpis cv-kpis--even ${activeQueue === 'paid' ? 'cv-pay-kpis' : ''}`} style={{ marginBottom: 16 }}>
        {activeQueue === 'incomplete' ? (
          <>
            <Kpi icon={UserPlus} label="Incomplete leads" value={inr(stats.total)} tone="warn" />
            <Kpi icon={ThumbsUp} label="Interested" value={inr(stats.interested)} tone="ok" />
            <Kpi icon={PhoneOff} label="Unreachable" value={inr(stats.unreachable)} tone="warn" />
            <Kpi icon={Sparkles} label="Converted" value={inr(stats.converted)} tone="ok" />
          </>
        ) : activeQueue === 'registered' ? (
          <>
            <Kpi icon={ClipboardList} label="Registered candidates" value={inr(stats.total)} tone="ok" />
            <Kpi icon={Sparkles} label="Active Pro" value={inr(stats.pro)} tone="info" />
            <Kpi icon={ThumbsUp} label="Interested" value={inr(stats.interested)} tone="ok" />
            <Kpi icon={Sparkles} label="Converted" value={inr(stats.converted)} tone="ok" />
          </>
        ) : activeQueue === 'paid' ? (
          <>
            <Kpi label="To follow up" value={inr(stats.interested)} note={stats.interested ? `${stats.interested} leads to follow up` : 'queue is clear'} tone={stats.interested ? 'warn' : undefined} />
            <Kpi label="Active Pro" value={inr(stats.pro)} note={stats.pro ? `${stats.pro} paid subscriptions` : 'nothing waiting'} />
            <Kpi label="Converted" value={inr(stats.converted)} note="completed setup" />
            <Kpi label="Payments received" value={inr(stats.pro)} note="confirmed in ledger" />
          </>
        ) : (
          <>
            <Kpi icon={Users} label="Total leads" value={inr(total)} />
            <Kpi icon={ClipboardList} label="Registered" value={inr(stats.registered)} tone="ok" />
            <Kpi icon={Sparkles} label="Active Pro" value={inr(stats.pro)} tone="info" />
            <Kpi icon={ThumbsUp} label="Interested" value={inr(stats.interested)} tone="ok" />
            <Kpi icon={PhoneOff} label="Unreachable" value={inr(stats.unreachable)} tone="warn" />
          </>
        )}
      </div>

      {activeQueue === 'paid' && (
        <details className="cv-disclosure cv-pay-help">
          <summary><Info size={15} /> How payment follow-up works</summary>
          <p>Candidates who paid the UPI QR and upgraded to Active Pro are listed here. Verify their payment status, assist with candidate setup, and follow up with interested leads for renewal or additional booth coverage.</p>
        </details>
      )}

      <Card flush className={activeQueue === 'paid' ? 'cv-pay-queue' : undefined}>
        {scope === 'paid' ? (
          <div className="cv-tabs-row">
            <div className="cv-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={paidTab === 'received'}
                className={`cv-tab ${paidTab === 'received' ? 'cv-tab--on' : ''}`}
                onClick={() => setPaidTab('received')}
              >
                Received <span className="cv-tab-count">{inr(stats.pro)}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={paidTab === 'interested'}
                className={`cv-tab ${paidTab === 'interested' ? 'cv-tab--on' : ''}`}
                onClick={() => setPaidTab('interested')}
              >
                To follow up <span className="cv-tab-count">{inr(stats.interested)}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={paidTab === 'all'}
                className={`cv-tab ${paidTab === 'all' ? 'cv-tab--on' : ''}`}
                onClick={() => setPaidTab('all')}
              >
                All submissions <span className="cv-tab-count">{inr(rows.length)}</span>
              </button>
            </div>
            <label className="cv-search cv-tabs-search">
              <Search size={15} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name, mobile, transaction ID…"
                aria-label="Search payments"
              />
            </label>
          </div>
        ) : (
          /* Filter bar */
          <div className="cv-filters">
            <div className="cv-filters-search" style={{ position: 'relative' }}>
              <Search size={15} style={{ position: 'absolute', left: 10, top: 10, opacity: 0.5 }} />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search candidate name or mobile…"
                style={{ paddingLeft: 30 }}
              />
            </div>

            <Select
              value={statusFilter}
              onChange={(e) => { setPage(1); setStatusFilter(e.target.value); }}
              style={{ minWidth: 160 }}
            >
              <option value="all">All Lead Statuses</option>
              <option value="interested">Interested</option>
              <option value="first_call_complete">1st call done</option>
              <option value="second_call_complete">2nd call done</option>
              <option value="third_call_complete">3rd call done</option>
              <option value="switch_off">Switched off</option>
              <option value="not_answered">Not answered</option>
              <option value="will_call_back">Will call back</option>
              <option value="not_interested">Not interested</option>
              <option value="converted">Converted</option>
            </Select>

            <button
              type="button"
              onClick={() => setHideSnoozed(!hideSnoozed)}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                border: '1px solid',
                borderColor: hideSnoozed ? '#2563eb' : '#cbd5e1',
                background: hideSnoozed ? '#eff6ff' : '#fff',
                color: hideSnoozed ? '#1d4ed8' : '#64748b',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
              title="Toggle between showing only immediately actionable leads or all leads including snoozed ones"
            >
              <span>{hideSnoozed ? '👁️ Actionable Leads Only' : '👁️ Show All (incl. Snoozed)'}</span>
              {snoozedCount > 0 && (
                <span style={{ background: hideSnoozed ? '#2563eb' : '#94a3b8', color: '#fff', borderRadius: 10, padding: '1px 6px', fontSize: 11 }}>
                  {snoozedCount} snoozed
                </span>
              )}
            </button>

            {isAdmin && (
              <Select
                value={agentId}
                onChange={(e) => { setPage(1); setAgentId(e.target.value); }}
                style={{ minWidth: 180, marginLeft: 'auto' }}
              >
                <option value="">All telecallers</option>
                <option value="unassigned">⚠ Unassigned</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            )}
          </div>
        )}

        <DataTable
          columns={scope === 'paid' ? paidColumns : columns}
          rows={view}
          rowKey={(r) => r.clean_mobile}
          loading={loading}
          onRowClick={(r) => refreshOpen(r.phone || r.clean_mobile)}
          empty={
            scope === 'paid'
              ? (search
                  ? `No payments match “${search}”.`
                  : paidTab === 'received'
                  ? 'No payments received yet. Approved proofs appear here.'
                  : paidTab === 'interested'
                  ? 'Nothing to follow up — the queue is clear.'
                  : 'No submissions yet.')
              : (scope === 'all'
                  ? 'No conversations yet. Leads arrive from WhatsApp / WACTO and auto-assign round-robin.'
                  : 'Nothing in this follow-up list yet.')
          }
        />
        <div style={{ padding: 12 }}>
          <Pager page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
        </div>
      </Card>

      <LeadDrawer
        contact={open}
        agents={agents}
        isAdmin={isAdmin}
        canClaim={canClaim}
        onClose={() => setOpen(null)}
        onChanged={() => {
          refreshOpen(open.phone || open.clean_mobile);
          load();
        }}
        setMsg={setMsg}
        setErr={setErr}
      />

      {/* Task 3: 8:00 PM Daily Performance Digest Modal */}
      {digestOpen && (
        <Modal
          open={digestOpen}
          title="Daily Telecalling Digest (Automated 8:00 PM Summary)"
          onClose={() => setDigestOpen(false)}
          width={540}
        >
          <div style={{ display: 'grid', gap: 14 }}>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '14px', fontFamily: 'monospace', whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.6, color: '#1e293b' }}>
              {digestData?.text || 'Compiling performance metrics...'}
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Input
                value={digestPhone}
                onChange={(e) => setDigestPhone(e.target.value)}
                placeholder="Optional: Admin Mobile (defaults to configured admin phone)"
                style={{ flex: 1 }}
              />
              <Button
                variant="primary"
                icon={Send}
                disabled={digestLoading}
                onClick={() => {
                  setDigestLoading(true);
                  setDigestStatus('');
                  api.post('/crm/admin/daily-digest/send', { phone: digestPhone || undefined })
                    .then(({ data }) => setDigestStatus(data.result?.sent ? `✅ Dispatched to WhatsApp (+91 ${data.result.phone})` : `⚠️ Notice: ${data.result?.reason || data.result?.error || 'Check server logs'}`))
                    .catch((e) => setDigestStatus(`❌ Error: ${e?.response?.data?.message || e.message}`))
                    .finally(() => setDigestLoading(false));
                }}
              >
                {digestLoading ? 'Sending…' : 'Send WhatsApp Now'}
              </Button>
            </div>

            {digestStatus && (
              <div style={{ fontSize: 13, fontWeight: 500, color: digestStatus.startsWith('✅') ? '#16a34a' : '#d97706' }}>
                {digestStatus}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

// The call workspace for one lead: contact summary, call-outcome buttons (each
// click is timestamped), a notes box, the assign control (admin), and the full
// status timeline so every past call is visible.
function LeadDrawer({ contact, agents, isAdmin, canClaim, onClose, onChanged, setMsg, setErr }) {
  const webphone = useWebPhone();
  const webConnecting = webphone.status === 'connecting' || webphone.status === 'idle';
  const [note, setNote] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [showMilestones, setShowMilestones] = useState(false);

  useEffect(() => {
    if (contact) {
      setNote('');
      setNotes(contact.agent_notes || '');
      setShowMilestones(false);
    }
  }, [contact?.clean_mobile]);
  if (!contact) return null;
  const phone = contact.phone || contact.clean_mobile;
  const unassigned = !contact.assigned_agent_id && (!contact.assigned_agent_name || contact.assigned_agent_name === '-');

  const claim = () => {
    setSaving(true);
    setErr('');
    api.post(`/crm/conversations/${phone}/claim`)
      .then(({ data }) => {
        setMsg(data.message || 'Lead claimed.');
        onChanged();
      })
      .catch((e) => setErr(e?.response?.data?.message || 'Could not claim.'))
      .finally(() => setSaving(false));
  };

  const setStatus = (lead_status) => {
    setSaving(true);
    api.post(`/crm/conversations/${phone}/lead-status`, { lead_status, note })
      .then(({ data }) => {
        setMsg(data.message || 'Call outcome logged.');
        setNote('');
        onChanged();
      })
      .catch((e) => setErr(e?.response?.data?.message || 'Could not update status.'))
      .finally(() => setSaving(false));
  };

  const saveNotes = () => {
    setSaving(true);
    api.post(`/crm/conversations/${phone}/notes`, { agent_notes: notes })
      .then(({ data }) => {
        setMsg(data.message || 'Notes saved.');
        onChanged();
      })
      .catch((e) => setErr(e?.response?.data?.message || 'Could not save notes.'))
      .finally(() => setSaving(false));
  };

  const assign = (agent_id) => {
    if (!agent_id) return;
    api.post(`/crm/conversations/${phone}/assign`, { agent_id })
      .then(({ data }) => {
        setMsg(data.message || 'Assigned.');
        onChanged();
      })
      .catch((e) => setErr(e?.response?.data?.message || 'Could not assign.'));
  };

  const call = () => {
    setErr('');
    setMsg('');
    if (webphone.ready) {
      setMsg('Starting call…');
      Promise.resolve(webphone.startCall(contact.clean_mobile, contact)).then((r) => {
        if (r?.ok) setMsg('Connecting your web phone to the lead — the lead sees the business number.');
        else {
          setMsg('');
          setErr(r?.message || 'Could not start the call.');
        }
      });
      return;
    }
    if (webphone.status === 'connecting' || webphone.status === 'idle') {
      setErr('Web phone is still connecting — wait until the button says “Call (web)”, then try again.');
      return;
    }
    const who = contact.assigned_agent_name && contact.assigned_agent_name !== '-' ? contact.assigned_agent_name : 'the assigned telecaller';
    setSaving(true);
    api.post(`/crm/conversations/${phone}/call`, { web: true })
      .then(({ data }) => {
        setMsg(data.message || `Ringing ${who}’s web phone — they answer in their browser.`);
        onChanged();
      })
      .catch((e) => setErr(e?.response?.data?.message || `Could not start the call. Make sure ${who} is logged in.`))
      .finally(() => setSaving(false));
  };

  const history = [...(contact._history || contact.status_history || [])].reverse();
  const CALL_SOURCES = ['telecmi', 'softphone'];
  const callLog = history.filter(
    (h) =>
      CALL_SOURCES.includes(h.source) ||
      h.recording ||
      ['first_call_complete', 'second_call_complete', 'third_call_complete', 'call_completed'].includes(h.status)
  );

  return (
    <Modal open={!!contact} title={contact.name || `Candidate ${String(contact.clean_mobile).slice(-4)}`} onClose={onClose} width={640}>
      <div style={{ display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Pill tone={contact.is_registered ? 'ok' : 'warn'} dot>
            {contact.is_registered ? 'Registered Candidate' : 'Incomplete Registration'}
          </Pill>
          {contact.is_pro && <Pill tone="info" icon={Sparkles}>Active Pro</Pill>}
          {unassigned ? (
            <Pill tone="warn">Unassigned</Pill>
          ) : (
            <Pill tone="neutral">
              <UserCheck size={12} /> {contact.assigned_agent_name}
              {contact.taken ? ' · Claimed' : ''}
            </Pill>
          )}
        </div>

        {/* Dynamic Telecaller Talking Points Banner */}
        {!contact.is_registered ? (
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#92400e', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <Info size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <strong>Incomplete Registration Lead:</strong> Candidate started but dropped off before booth selection.
              <div style={{ marginTop: 4, fontSize: 12.5 }}>
                <strong>Talking Points:</strong> Help them finish booth selection for {contact.assembly ? `AC ${contact.assembly}` : (contact.district || 'their constituency')}, explain voter categorization & door-to-door tracking advantages, and activate their candidate login.
              </div>
            </div>
          </div>
        ) : (
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#166534', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <strong>Registered Candidate:</strong> Active login created ({contact.clean_mobile}).
              <div style={{ marginTop: 4, fontSize: 12.5 }}>
                <strong>Talking Points:</strong> Congratulate them on registration. Walk them through logging into their portal, demo the booth voter slip features, and pitch upgrading to the <strong>Pro Plan</strong> to unlock full voter lists.
              </div>
            </div>
          </div>
        )}

        <div className="cv-muted" style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Phone size={13} /> <span className="cv-mono-sm" style={{ fontWeight: 600 }}>{contact.clean_mobile}</span>
          {contact.district && contact.district !== '-' && <span>· District: {contact.district}</span>}
          {contact.assembly && contact.assembly !== '-' && <span>· AC {contact.assembly}</span>}
          {contact.position && contact.position !== '-' && <span>· Role: {contact.position}</span>}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button
            size="sm"
            icon={Phone}
            onClick={call}
            disabled={saving || webConnecting}
            title={
              webphone.ready
                ? 'Call from the browser — talk through your computer headset via TeleCMI'
                : webConnecting
                ? 'Web phone is connecting — wait until it says “Call (web)”'
                : 'Rings your phone first, then connects to the lead'
            }
          >
            {webphone.ready ? 'Call (web)' : webConnecting ? 'Connecting…' : 'Call'}
          </Button>
          <a
            className="cv-btn cv-btn--ghost cv-btn--sm"
            href={waLink(contact.clean_mobile)}
            target="_blank"
            rel="noreferrer"
            title="Open Wacto/WhatsApp chat"
          >
            <MessageCircle size={13} /> Open WhatsApp
          </a>
          {unassigned && (canClaim || isAdmin) && (
            <Button size="sm" variant="ghost" icon={Hand} onClick={claim} disabled={saving}>
              {isAdmin ? 'Take this lead' : 'Claim'}
            </Button>
          )}
        </div>

        <div>
          <div className="cv-field-label" style={{ marginBottom: 6 }}>
            Call outcome <span className="cv-muted">(every tap logs a separate permanent call record)</span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {PRIMARY_OUTCOMES.map((k) => {
              const m = statusMeta(k);
              return (
                <button
                  key={k}
                  type="button"
                  className={`cv-pill cv-pill--${m.tone}`}
                  style={{
                    cursor: 'pointer',
                    border: 'none',
                    fontSize: 12.5,
                    padding: '6px 11px',
                    opacity: saving ? 0.6 : 1,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    fontWeight: 500,
                    transition: 'transform 0.1s ease',
                  }}
                  disabled={saving}
                  onClick={() => setStatus(k)}
                >
                  <span className="cv-pill-dot" />
                  {m.label}
                </button>
              );
            })}
          </div>

          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              className="cv-btn cv-btn--ghost cv-btn--sm"
              style={{ fontSize: 12, padding: '2px 8px' }}
              onClick={() => setShowMilestones((v) => !v)}
            >
              {showMilestones ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {showMilestones ? 'Hide call milestones' : 'More call milestones (1st call, 2nd call, 3rd call)…'}
            </button>
            {showMilestones && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {CALL_MILESTONES.map((k) => {
                  const m = statusMeta(k);
                  return (
                    <button
                      key={k}
                      type="button"
                      className={`cv-pill cv-pill--${m.tone}`}
                      style={{
                        cursor: 'pointer',
                        border: 'none',
                        fontSize: 12,
                        padding: '4px 9px',
                        opacity: saving ? 0.6 : 1,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                      }}
                      disabled={saving}
                      onClick={() => setStatus(k)}
                    >
                      <span className="cv-pill-dot" />
                      {m.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <Field label="Note for this call (optional)">
          <Input
            value={note}
            placeholder="e.g. Explained dashboard features. Ready to pay UPI for 4 booths tomorrow morning."
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>

        {isAdmin && (
          <Field label="Assign to telecaller">
            <Select value={contact.assigned_agent_id || ''} onChange={(e) => assign(e.target.value)}>
              <option value="">— choose —</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="General Notes / Comments on candidate">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div style={{ marginTop: 6 }}>
            <Button size="sm" icon={StickyNote} onClick={saveNotes} disabled={saving}>
              Save notes
            </Button>
          </div>
        </Field>

        {/* Multi-Call Timeline Audit */}
        <div>
          <div className="cv-field-label" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Phone size={13} /> Call History & Audio Audits ({callLog.length} call{callLog.length !== 1 ? 's' : ''})
          </div>
          {callLog.length === 0 ? (
            <p className="cv-muted" style={{ fontSize: 13, background: 'var(--cv-subtle, #f8fafc)', padding: 12, borderRadius: 8 }}>
              No calls logged yet. Click “Call (web)” above to dial this candidate.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
              {callLog.map((h, i) => {
                const callNumber = callLog.length - i;
                const sm = statusMeta(h.status);
                return (
                  <li
                    key={i}
                    style={{
                      border: '1px solid var(--cv-line, #e2e8f0)',
                      borderRadius: 8,
                      padding: '10px 12px',
                      background: '#ffffff',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 600, fontSize: 12.5, background: 'var(--cv-subtle, #f1f5f9)', padding: '2px 8px', borderRadius: 4 }}>
                          Call #{callNumber}
                        </span>
                        <span style={{ fontSize: 12.5, color: '#334155' }}>
                          {h.direction === 'inbound' ? 'Inbound IVR' : 'Outbound Softphone'}
                          {h.duration ? ` · ${h.duration}s talk time` : ''}
                        </span>
                        <Pill tone={sm.tone} dot>{sm.label}</Pill>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--cv-muted, #64748b)' }}>
                        {fmtDateTime(h.at)}
                      </div>
                    </div>
                    {(h.note || h.by) && (
                      <div style={{ marginTop: 6, fontSize: 12.5, color: '#475569', display: 'flex', gap: 6 }}>
                        {h.by && h.by !== 'System' && <span style={{ fontWeight: 500 }}>{h.by}:</span>}
                        {h.note && <span>"{h.note}"</span>}
                      </div>
                    )}
                    {h.recording && (
                      <audio
                        controls
                        preload="none"
                        style={{ width: '100%', marginTop: 8, height: 32 }}
                        src={`/api/crm/recordings?file=${encodeURIComponent(h.recording)}`}
                      >
                        Your browser can’t play this recording.
                      </audio>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Status History */}
        <div>
          <div className="cv-field-label" style={{ marginBottom: 6 }}>
            <Clock size={13} /> Full Status Timeline
          </div>
          {history.length === 0 ? (
            <p className="cv-muted" style={{ fontSize: 13 }}>
              No status changes yet.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
              {history.map((h, i) => {
                const m = statusMeta(h.status);
                return (
                  <li
                    key={i}
                    style={{
                      display: 'flex',
                      gap: 10,
                      alignItems: 'baseline',
                      borderLeft: '2px solid var(--cv-line, #e5e7eb)',
                      paddingLeft: 10,
                    }}
                  >
                    <Pill tone={m.tone} dot>
                      {m.label}
                    </Pill>
                    <span className="cv-muted" style={{ fontSize: 12 }}>
                      <span className="cv-mono-sm">{fmtDateTime(h.at)}</span>
                      {h.by ? ` · ${h.by}` : ''}
                      {h.note ? ` · “${h.note}”` : ''}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
