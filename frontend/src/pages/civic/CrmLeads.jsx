import { useEffect, useMemo, useState } from 'react';
import { Phone, MessageCircle, Search, Shuffle, StickyNote, Clock, UserCheck, Hand, Sparkles, Lock } from 'lucide-react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useWebPhone, WebPhoneBadge } from '../../civic/webphone.jsx';
import { PageHeader, Card, Pill } from '../../civic/kit.jsx';
import { DataTable, Pager, Button, Select, Input, Modal, Textarea, Field, loadError, fmtDateTime, waLink } from '../../civic/ui.jsx';
import { statusMeta, STATUS_BUTTONS } from '../../civic/leadStatus.js';

const PAGE_SIZE = 50;

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
    if (isAdmin && agentId) params.agent_id = agentId;
    api.get('/crm/conversations', { params })
      .then(({ data }) => { setRows(data.conversations || []); setTotal(data.total || 0); setErr(''); })
      .catch((e) => setErr(loadError(e, 'conversations')))
      .finally(() => setLoading(false));
  };
  useEffect(load, [page, agentId]);
  useEffect(() => { const t = setTimeout(() => { setPage(1); load(); }, 350); return () => clearTimeout(t); }, [search]);

  // Client-side scope for the telecaller follow-up menus.
  const view = useMemo(() => rows.filter((r) => {
    if (scope === 'unregistered') return !r.is_registered;
    if (scope === 'registered') return r.is_registered;
    if (scope === 'paid') return r.is_pro;
    return true;
  }), [rows, scope]);

  const refreshOpen = (phone) => api.get(`/crm/conversations/${phone}`).then(({ data }) => setOpen({ ...data.contact, _history: data.contact.status_history || [] })).catch(() => {});

  const columns = [
    { key: 'contact', label: 'Contact', primary: true, render: (r) => (
      <div>
        <strong>{r.contact_name || `User ${String(r.clean_mobile || '').slice(-4)}`}</strong>
        <div className="cv-muted" style={{ fontSize: 12 }}>{r.clean_mobile}</div>
      </div>
    ) },
    { key: 'flags', label: 'Candidate', medium: false, render: (r) => (
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Pill tone={r.is_registered ? 'ok' : 'neutral'} dot>{r.is_registered ? 'Registered' : 'Not registered'}</Pill>
        {r.is_pro && <Pill tone="info" icon={Sparkles}>Pro</Pill>}
      </div>
    ) },
    { key: 'status', label: 'Lead status', render: (r) => { const m = statusMeta(r.lead_status); return <Pill tone={m.tone} dot>{m.label}</Pill>; } },
    { key: 'agent', label: 'Telecaller', medium: false, render: (r) => (
      r.assigned_agent_id
        ? <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>{r.assigned_agent_name || 'Assigned'}{r.taken && <Pill tone="info" icon={Lock}>Claimed</Pill>}</span>
        : <Pill tone="warn">Unassigned</Pill>
    ) },
    { key: 'last', label: 'Last activity', align: 'right', medium: false, render: (r) => <span className="cv-muted" style={{ fontSize: 12 }}>{fmtDateTime(r.last_message_at)}</span> },
  ];

  const distribute = () => {
    if (!window.confirm('Distribute all unassigned WhatsApp conversations across active team members (round-robin)?')) return;
    setBusy(true);
    api.post('/crm/distribute-leads', {})
      .then(({ data }) => { setMsg(data.message || 'Distributed.'); load(); })
      .catch((e) => setErr(e?.response?.data?.message || 'Could not distribute.'))
      .finally(() => setBusy(false));
  };

  return (
    <div className="cv-page">
      <PageHeader
        eyebrow={isAdmin ? 'Telecalling' : 'My work'}
        title={title}
        subtitle={subtitle || (isAdmin ? 'Every WhatsApp lead. Assign, distribute, and set call outcomes.' : 'Your assigned leads. Call, then set the outcome with a note.')}
        actions={(
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <WebPhoneBadge />
            {isAdmin && <Button variant="ghost" icon={Shuffle} onClick={distribute} disabled={busy}>Distribute</Button>}
          </div>
        )}
      />

      {err && <div className="cv-alert cv-alert--bad" style={{ marginBottom: 12 }}>{err}</div>}
      {msg && <div className="cv-alert cv-alert--ok" style={{ marginBottom: 12 }} onClick={() => setMsg('')}>{msg}</div>}

      <Card flush>
        <div style={{ display: 'flex', gap: 10, padding: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: '1 1 240px' }}>
            <Search size={15} style={{ position: 'absolute', left: 10, top: 10, opacity: 0.5 }} />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or mobile…" style={{ paddingLeft: 30 }} />
          </div>
          {isAdmin && (
            <Select value={agentId} onChange={(e) => { setPage(1); setAgentId(e.target.value); }} style={{ flex: '0 1 220px' }}>
              <option value="">All telecallers</option>
              <option value="unassigned">⚠ Unassigned</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          )}
        </div>
        <DataTable
          columns={columns}
          rows={view}
          rowKey={(r) => r.clean_mobile}
          loading={loading}
          onRowClick={(r) => refreshOpen(r.phone || r.clean_mobile)}
          empty={scope === 'all' ? 'No conversations yet. Leads arrive from WhatsApp / WACTO and auto-assign round-robin.' : 'Nothing in this list yet.'}
        />
        <div style={{ padding: 12 }}><Pager page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} /></div>
      </Card>

      <LeadDrawer
        contact={open}
        agents={agents}
        isAdmin={isAdmin}
        canClaim={canClaim}
        onClose={() => setOpen(null)}
        onChanged={() => { refreshOpen(open.phone || open.clean_mobile); load(); }}
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
  useEffect(() => { if (contact) { setNote(''); setNotes(contact.agent_notes || ''); } }, [contact?.clean_mobile]);
  if (!contact) return null;
  const phone = contact.phone || contact.clean_mobile;
  const unassigned = !contact.assigned_agent_id && (!contact.assigned_agent_name || contact.assigned_agent_name === '-');

  const claim = () => {
    setSaving(true); setErr('');
    api.post(`/crm/conversations/${phone}/claim`)
      .then(({ data }) => { setMsg(data.message || 'Lead claimed.'); onChanged(); })
      .catch((e) => setErr(e?.response?.data?.message || 'Could not claim.'))
      .finally(() => setSaving(false));
  };

  const setStatus = (lead_status) => {
    setSaving(true);
    api.post(`/crm/conversations/${phone}/lead-status`, { lead_status, note })
      .then(({ data }) => { setMsg(data.message || 'Status updated.'); setNote(''); onChanged(); })
      .catch((e) => setErr(e?.response?.data?.message || 'Could not update status.'))
      .finally(() => setSaving(false));
  };
  const saveNotes = () => {
    setSaving(true);
    api.post(`/crm/conversations/${phone}/notes`, { agent_notes: notes })
      .then(({ data }) => { setMsg(data.message || 'Notes saved.'); onChanged(); })
      .catch((e) => setErr(e?.response?.data?.message || 'Could not save notes.'))
      .finally(() => setSaving(false));
  };
  const assign = (agent_id) => {
    if (!agent_id) return;
    api.post(`/crm/conversations/${phone}/assign`, { agent_id })
      .then(({ data }) => { setMsg(data.message || 'Assigned.'); onChanged(); })
      .catch((e) => setErr(e?.response?.data?.message || 'Could not assign.'));
  };
  const call = () => {
    setErr(''); setMsg('');
    // Preferred: browser softphone — TeleCMI bridges to your web phone (no mobile rings), lead sees the DID.
    if (webphone.ready) {
      setMsg('Starting call…');
      Promise.resolve(webphone.startWebCall(contact.clean_mobile, contact)).then((r) => {
        if (r?.ok) setMsg('Connecting your web phone to the lead — the lead sees the business number.');
        else { setMsg(''); setErr(r?.message || 'Could not start the call.'); }
      });
      return;
    }
    // Fallback: mobile bridge (rings the telecaller's phone first, then the lead).
    setSaving(true);
    api.post(`/crm/conversations/${phone}/call`)
      .then(({ data }) => { setMsg(data.message || 'Calling…'); onChanged(); })
      .catch((e) => setErr(e?.response?.data?.message || 'Could not start the call.'))
      .finally(() => setSaving(false));
  };

  const history = [...(contact._history || contact.status_history || [])].reverse();
  const CALL_SOURCES = ['telecmi', 'softphone'];
  const callLog = history.filter((h) => CALL_SOURCES.includes(h.source) || h.recording || ['first_call_complete', 'second_call_complete', 'third_call_complete', 'call_completed'].includes(h.status));

  return (
    <Modal open={!!contact} title={contact.name || `Lead ${String(contact.clean_mobile).slice(-4)}`} onClose={onClose} width={620}>
      <div style={{ display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Pill tone={contact.is_registered ? 'ok' : 'neutral'} dot>{contact.is_registered ? 'Registered' : 'Not registered'}</Pill>
          {contact.is_pro && <Pill tone="info" icon={Sparkles}>Active Pro</Pill>}
          {unassigned
            ? <Pill tone="warn">Unassigned</Pill>
            : <Pill tone="neutral"><UserCheck size={12} /> {contact.assigned_agent_name}{contact.taken ? ' · Claimed' : ''}</Pill>}
          <Pill tone={contact.window_active ? 'ok' : 'warn'} dot>{contact.window_active ? 'WhatsApp window open' : 'Window closed'}</Pill>
        </div>

        <div className="cv-muted" style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Phone size={13} /> {contact.clean_mobile} · {contact.district || '—'} · {contact.assembly || '—'}
          {contact.position && contact.position !== '-' ? ` · ${contact.position}` : ''}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="sm" icon={Phone} onClick={call} disabled={saving || webConnecting}
            title={webphone.ready ? 'Call from the browser — talk through your computer (no mobile rings)' : webConnecting ? 'Web phone is connecting — wait until it says “Call (web)”' : 'Rings your phone first, then connects to the lead'}>
            {webphone.ready ? 'Call (web)' : webConnecting ? 'Connecting…' : 'Call'}
          </Button>
          <a className="cv-btn cv-btn--ghost cv-btn--sm" href={waLink(contact.clean_mobile)} target="_blank" rel="noreferrer"><MessageCircle size={13} /> WhatsApp</a>
          {unassigned && (canClaim || isAdmin) && (
            <Button size="sm" variant="ghost" icon={Hand} onClick={claim} disabled={saving}>{isAdmin ? 'Take this lead' : 'Claim'}</Button>
          )}
        </div>

        <div>
          <div className="cv-field-label" style={{ marginBottom: 6 }}>Call outcome <span className="cv-muted">(each tap is logged with the time)</span></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {STATUS_BUTTONS.map((k) => { const m = statusMeta(k); return (
              <button key={k} type="button" className={`cv-pill cv-pill--${m.tone}`} style={{ cursor: 'pointer', border: 'none', fontSize: 12.5, padding: '5px 10px', opacity: saving ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', gap: 5 }} disabled={saving} onClick={() => setStatus(k)}>
                <span className="cv-pill-dot" />
                {m.label}
              </button>
            ); })}
          </div>
        </div>

        <Field label="Note for this call (optional)">
          <Input value={note} placeholder="e.g. Asked to call back after 6pm" onChange={(e) => setNote(e.target.value)} />
        </Field>

        {isAdmin && (
          <Field label="Assign to telecaller">
            <Select value={contact.assigned_agent_id || ''} onChange={(e) => assign(e.target.value)}>
              <option value="">— choose —</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
        )}

        <Field label="Notes / comments on this candidate">
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div style={{ marginTop: 6 }}><Button size="sm" icon={StickyNote} onClick={saveNotes} disabled={saving}>Save notes</Button></div>
        </Field>

        <div>
          <div className="cv-field-label" style={{ marginBottom: 6 }}><Phone size={13} /> Call history</div>
          {callLog.length === 0 ? <p className="cv-muted" style={{ fontSize: 13 }}>No calls logged yet.</p> : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
              {callLog.map((h, i) => (
                <li key={i} style={{ border: '1px solid var(--cv-line, #e5e7eb)', borderRadius: 8, padding: '8px 10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ fontSize: 13 }}>
                      {h.direction === 'inbound' ? '📥 Incoming' : '📤 Outgoing'}
                      {h.duration ? ` · ${h.duration}s` : ''}
                      <span className="cv-muted"> · {statusMeta(h.status).label}{h.by && h.by !== 'System' ? ` · ${h.by}` : ''}</span>
                    </span>
                    <span className="cv-muted" style={{ fontSize: 12 }}>{fmtDateTime(h.at)}</span>
                  </div>
                  {h.recording && (
                    <audio controls preload="none" style={{ width: '100%', marginTop: 6, height: 34 }}
                      src={`/api/crm/recordings?file=${encodeURIComponent(h.recording)}`}>
                      Your browser can’t play this recording.
                    </audio>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <div className="cv-field-label" style={{ marginBottom: 6 }}><Clock size={13} /> Status history</div>
          {history.length === 0 ? <p className="cv-muted" style={{ fontSize: 13 }}>No status changes yet.</p> : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
              {history.map((h, i) => { const m = statusMeta(h.status); return (
                <li key={i} style={{ display: 'flex', gap: 10, alignItems: 'baseline', borderLeft: '2px solid var(--cv-line, #e5e7eb)', paddingLeft: 10 }}>
                  <Pill tone={m.tone}>{m.emoji} {m.label}</Pill>
                  <span className="cv-muted" style={{ fontSize: 12 }}>{fmtDateTime(h.at)}{h.by ? ` · ${h.by}` : ''}{h.note ? ` · “${h.note}”` : ''}</span>
                </li>
              ); })}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
