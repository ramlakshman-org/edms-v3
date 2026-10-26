import { useEffect, useMemo, useState } from 'react';
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
} from 'lucide-react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useWebPhone, WebPhoneBadge } from '../../civic/webphone.jsx';
import { PageHeader, Card, Pill, Kpi, inr } from '../../civic/kit.jsx';
import { DataTable, Pager, Button, Select, Input, Modal, Textarea, Field, loadError, fmtDateTime, waLink } from '../../civic/ui.jsx';
import { statusMeta, STATUS_BUTTONS } from '../../civic/leadStatus.js';

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
export default function CrmLeads({ scope = 'all', title = 'CRM Leads', subtitle }) {
  const { user } = useAuth();
  const isAdmin = Number(user?.group_id || user?.user_group_id) === 1;

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

  const [canClaim, setCanClaim] = useState(false);
  useEffect(() => { if (isAdmin) api.get('/crm/agents').then(({ data }) => setAgents(data.agents || [])).catch(() => {}); }, [isAdmin]);
  useEffect(() => { api.get('/crm/settings').then(({ data }) => setCanClaim(!!data.config?.claim_unassigned)).catch(() => {}); }, []);

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

  // Client-side scope for the telecaller follow-up menus.
  const view = useMemo(() => rows.filter((r) => {
    if (scope === 'unregistered') return !r.is_registered;
    if (scope === 'registered') return r.is_registered;
    if (scope === 'paid') {
      if (paidTab === 'received') return r.is_pro;
      if (paidTab === 'interested') return r.lead_status === 'interested';
      return true;
    }
    return true;
  }), [rows, scope, paidTab]);

  // Summary statistics for KPI cards
  const stats = useMemo(() => {
    const list = scope === 'paid' ? rows : view;
    const registered = list.filter((r) => r.is_registered).length;
    const pro = list.filter((r) => r.is_pro).length;
    const interested = list.filter((r) => r.lead_status === 'interested').length;
    const unreachable = list.filter((r) => ['switch_off', 'not_answered', 'will_call_back'].includes(r.lead_status)).length;
    const converted = list.filter((r) => ['converted', 'registration_completed'].includes(r.lead_status)).length;
    return { total: list.length, registered, pro, interested, unreachable, converted };
  }, [rows, view, scope]);

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
        return <Pill tone={m.tone} dot>{m.label}</Pill>;
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

  const pageEyebrow = scope === 'paid' ? undefined : (scope !== 'all' ? 'Follow-up' : (isAdmin ? 'Telecalling' : 'My work'));
  const pageTitle =
    scope === 'paid'
      ? 'Payments'
      : title === 'CRM Leads' && !isAdmin
      ? 'My Leads / Chats'
      : scope === 'unregistered'
      ? 'Incomplete Registrations'
      : scope === 'registered'
      ? 'Registrations'
      : title;

  return (
    <div className="cv-page">
      <PageHeader
        eyebrow={pageEyebrow}
        title={pageTitle}
        subtitle={
          subtitle ||
          (scope === 'paid'
            ? 'Verify UPI QR payment proofs and see the payments received'
            : isAdmin
            ? 'Every WhatsApp lead. Assign, distribute, and set call outcomes.'
            : 'Your assigned leads. Call, then set the outcome with a note.')
        }
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <WebPhoneBadge />
            <Button variant="ghost" icon={RefreshCw} onClick={load} disabled={loading}>
              Refresh
            </Button>
            {isAdmin && (
              <Button variant="ghost" icon={Shuffle} onClick={distribute} disabled={busy}>
                Distribute
              </Button>
            )}
          </div>
        }
      />

      {err && <div className="cv-alert cv-alert--bad" style={{ marginBottom: 12 }}>{err}</div>}
      {msg && <div className="cv-alert cv-alert--ok" style={{ marginBottom: 12 }} onClick={() => setMsg('')}>{msg}</div>}

      {/* KPI Metrics Summary Strip */}
      <div className={`cv-kpis cv-kpis--even ${scope === 'paid' ? 'cv-pay-kpis' : ''}`} style={{ marginBottom: 16 }}>
        {scope === 'unregistered' ? (
          <>
            <Kpi icon={UserPlus} label="Incomplete leads" value={inr(stats.total)} tone="warn" />
            <Kpi icon={ThumbsUp} label="Interested" value={inr(stats.interested)} tone="ok" />
            <Kpi icon={PhoneOff} label="Unreachable" value={inr(stats.unreachable)} tone="warn" />
            <Kpi icon={Star} label="Converted" value={inr(stats.converted)} tone="ok" />
          </>
        ) : scope === 'registered' ? (
          <>
            <Kpi icon={ClipboardList} label="Registered candidates" value={inr(stats.total)} tone="ok" />
            <Kpi icon={Crown} label="Active Pro" value={inr(stats.pro)} tone="info" />
            <Kpi icon={ThumbsUp} label="Interested" value={inr(stats.interested)} tone="ok" />
            <Kpi icon={Star} label="Converted" value={inr(stats.converted)} tone="ok" />
          </>
        ) : scope === 'paid' ? (
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
            <Kpi icon={Crown} label="Active Pro" value={inr(stats.pro)} tone="info" />
            <Kpi icon={ThumbsUp} label="Interested" value={inr(stats.interested)} tone="ok" />
            <Kpi icon={PhoneOff} label="Unreachable" value={inr(stats.unreachable)} tone="warn" />
          </>
        )}
      </div>

      {scope === 'paid' && (
        <details className="cv-disclosure cv-pay-help">
          <summary><Info size={15} /> How payment follow-up works</summary>
          <p>Candidates who paid the UPI QR and upgraded to Active Pro are listed here. Verify their payment status, assist with candidate setup, and follow up with interested leads for renewal or additional booth coverage.</p>
        </details>
      )}

      <Card flush className={scope === 'paid' ? 'cv-pay-queue' : undefined}>
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
  useEffect(() => {
    if (contact) {
      setNote('');
      setNotes(contact.agent_notes || '');
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
        setMsg(data.message || 'Status updated.');
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
    <Modal open={!!contact} title={contact.name || `Candidate ${String(contact.clean_mobile).slice(-4)}`} onClose={onClose} width={620}>
      <div style={{ display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Pill tone={contact.is_registered ? 'ok' : 'neutral'} dot>
            {contact.is_registered ? 'Registered' : 'Not registered'}
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
          <Pill tone={contact.window_active ? 'ok' : 'warn'} dot>
            {contact.window_active ? 'WhatsApp window open' : 'Window closed'}
          </Pill>
        </div>

        <div className="cv-muted" style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Phone size={13} /> <span className="cv-mono-sm">{contact.clean_mobile}</span> · {contact.district || '—'} · {contact.assembly || '—'}
          {contact.position && contact.position !== '-' ? ` · ${contact.position}` : ''}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button
            size="sm"
            icon={Phone}
            onClick={call}
            disabled={saving || webConnecting}
            title={
              webphone.ready
                ? 'Call from the browser — talk through your computer (no mobile rings)'
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
          >
            <MessageCircle size={13} /> WhatsApp
          </a>
          {unassigned && (canClaim || isAdmin) && (
            <Button size="sm" variant="ghost" icon={Hand} onClick={claim} disabled={saving}>
              {isAdmin ? 'Take this lead' : 'Claim'}
            </Button>
          )}
        </div>

        <div>
          <div className="cv-field-label" style={{ marginBottom: 6 }}>
            Call outcome <span className="cv-muted">(each tap is logged with time)</span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {STATUS_BUTTONS.map((k) => {
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
                    padding: '5px 10px',
                    opacity: saving ? 0.6 : 1,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
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
        </div>

        <Field label="Note for this call (optional)">
          <Input
            value={note}
            placeholder="e.g. Asked to call back tomorrow morning"
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

        <Field label="Notes / comments on this candidate">
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div style={{ marginTop: 6 }}>
            <Button size="sm" icon={StickyNote} onClick={saveNotes} disabled={saving}>
              Save notes
            </Button>
          </div>
        </Field>

        <div>
          <div className="cv-field-label" style={{ marginBottom: 6 }}>
            <Phone size={13} /> Call history
          </div>
          {callLog.length === 0 ? (
            <p className="cv-muted" style={{ fontSize: 13 }}>
              No calls logged yet.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
              {callLog.map((h, i) => (
                <li
                  key={i}
                  style={{
                    border: '1px solid var(--cv-line, #e5e7eb)',
                    borderRadius: 8,
                    padding: '8px 10px',
                    background: 'var(--cv-subtle, #f8fafc)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 8,
                      flexWrap: 'wrap',
                      alignItems: 'center',
                    }}
                  >
                    <span style={{ fontSize: 13 }}>
                      {h.direction === 'inbound' ? 'Incoming' : 'Outgoing'}
                      {h.duration ? ` · ${h.duration}s` : ''}
                      <span className="cv-muted">
                        {' '}
                        · {statusMeta(h.status).label}
                        {h.by && h.by !== 'System' ? ` · ${h.by}` : ''}
                      </span>
                    </span>
                    <span className="cv-muted cv-mono-sm" style={{ fontSize: 12 }}>
                      {fmtDateTime(h.at)}
                    </span>
                  </div>
                  {h.recording && (
                    <audio
                      controls
                      preload="none"
                      style={{ width: '100%', marginTop: 6, height: 34 }}
                      src={`/api/crm/recordings?file=${encodeURIComponent(h.recording)}`}
                    >
                      Your browser can’t play this recording.
                    </audio>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <div className="cv-field-label" style={{ marginBottom: 6 }}>
            <Clock size={13} /> Status history
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
                    <Pill tone={m.tone}>
                      {m.emoji} {m.label}
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
