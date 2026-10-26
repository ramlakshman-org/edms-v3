import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, Send, Phone, Hand, RefreshCw, ChevronLeft, Clock, StickyNote, DownloadCloud,
  PhoneCall, CheckCircle2, PhoneMissed, PhoneOff, PhoneForwarded, Sparkles, Lock
} from 'lucide-react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useWebPhone, WebPhoneBadge } from '../../civic/webphone.jsx';
import { PageHeader, Pill } from '../../civic/kit.jsx';
import { Select, Input, Button, fmtDateTime, loadError } from '../../civic/ui.jsx';
import { statusMeta, STATUS_BUTTONS } from '../../civic/leadStatus.js';
import './inbox.css';

const FILTERS = [['all', 'All'], ['open', 'Open'], ['interested', 'Interested'], ['not_interested', 'Not interested']];
const PhoneGlyph = ({ c = '#64748b', s = 13 }) => (<svg width={s} height={s} viewBox="0 0 24 24" fill={c} stroke="none" style={{ flex: 'none' }}><path d="M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.24 11 11 0 0 0 3.5.56 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1 11 11 0 0 0 .56 3.5 1 1 0 0 1-.24 1z" /></svg>);
const callTone = (body) => (/answered/i.test(body) ? 'ok' : /missed|failed|not/i.test(body) ? 'bad' : 'info');
const initials = (name, mobile) => {
  const s = String(name || '').replace(/\+?\d+/g, '').trim();
  return s ? s.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() : String(mobile || '?').slice(-2);
};
const timeShort = (d) => { if (!d) return ''; const dt = new Date(d); const today = new Date(); return dt.toDateString() === today.toDateString() ? dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }); };

// WATI-style shared inbox: conversation list · chat thread · lead details.
export default function Inbox() {
  const { user } = useAuth();
  const isAdmin = Number(user?.group_id || user?.user_group_id) === 1;
  const webphone = useWebPhone();

  const [convos, setConvos] = useState([]);
  const [sel, setSel] = useState(null);           // selected clean_mobile
  const [thread, setThread] = useState(null);     // { contact, messages }
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [agentId, setAgentId] = useState('');
  const [agents, setAgents] = useState([]);
  const [canClaim, setCanClaim] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState('');
  const [notes, setNotes] = useState('');
  const [savedNote, setSavedNote] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState('');
  const [err, setErr] = useState('');
  const [mobileThread, setMobileThread] = useState(false); // phone: show thread over list
  const endRef = useRef(null);

  useEffect(() => { if (isAdmin) api.get('/crm/agents').then(({ data }) => setAgents(data.agents || [])).catch(() => {}); }, [isAdmin]);
  useEffect(() => { api.get('/crm/settings').then(({ data }) => setCanClaim(!!data.config?.claim_unassigned)).catch(() => {}); }, []);

  const loadList = () => {
    const params = { limit: 100 };
    if (search.trim()) params.search = search.trim();
    if (filter !== 'all') params.lead_status = filter;
    if (isAdmin && agentId) params.agent_id = agentId;
    api.get('/crm/conversations', { params })
      .then(({ data }) => {
        const list = data.conversations || [];
        setConvos(list);
        setErr('');
        if (!sel && list.length > 0 && typeof window !== 'undefined' && window.innerWidth > 760) {
          openThread(list[0].clean_mobile);
        }
      })
      .catch((e) => setErr(loadError(e, 'conversations')))
      .finally(() => setLoading(false));
  };
  useEffect(loadList, [filter, agentId]);
  useEffect(() => { const t = setTimeout(loadList, 350); return () => clearTimeout(t); }, [search]);

  const openThread = (m) => {
    setSel(m); setMobileThread(true); setThread(null); setSavedNote(false);
    api.get(`/crm/conversations/${m}`).then(({ data }) => { setThread(data); setNotes(data.contact?.agent_notes || ''); }).catch(() => setThread({ contact: {}, messages: [] }));
  };
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [thread?.messages?.length]);

  const refreshThread = () => { if (sel) { api.get(`/crm/conversations/${sel}`).then(({ data }) => setThread(data)).catch(() => {}); loadList(); } };

  const contact = thread?.contact;
  const windowOpen = !!contact?.window_active;

  const send = () => {
    if (!text.trim() || !sel) return;
    setSending(true);
    api.post('/crm/messages/send', { phone: sel, message: text.trim() })
      .then(() => { setText(''); refreshThread(); })
      .catch((e) => setErr(e?.response?.data?.message || 'Could not send.'))
      .finally(() => setSending(false));
  };
  const setStatus = (lead_status) => { if (!sel) return; api.post(`/crm/conversations/${sel}/lead-status`, { lead_status }).then(refreshThread).catch((e) => setErr(e?.response?.data?.message || 'Failed.')); };
  const saveNotes = () => { if (!sel) return; api.post(`/crm/conversations/${sel}/notes`, { agent_notes: notes }).then(() => { setSavedNote(true); setTimeout(() => setSavedNote(false), 2000); refreshThread(); }).catch((e) => setErr(e?.response?.data?.message || 'Could not save notes.')); };
  const syncTelecmi = () => {
    setSyncing(true); setToast('');
    api.post('/crm/sync-recordings', { days: 7 })
      .then(({ data }) => { setToast(data.message || 'Synced.'); loadList(); if (sel) openThread(sel); setTimeout(() => setToast(''), 4000); })
      .catch((e) => setToast(e?.response?.data?.message || 'Sync failed.'))
      .finally(() => setSyncing(false));
  };
  const claim = () => { if (!sel) return; api.post(`/crm/conversations/${sel}/claim`).then(refreshThread).catch((e) => setErr(e?.response?.data?.message || 'Could not claim.')); };
  const callLead = () => {
    if (!sel) return;
    if (webphone.ready) { webphone.startWebCall(sel, contact || {}); return; }
    api.post(`/crm/conversations/${sel}/call`).then(refreshThread).catch((e) => setErr(e?.response?.data?.message || 'Could not call.'));
  };

  const unassigned = contact && !contact.assigned_agent_id && (!contact.assigned_agent_name || contact.assigned_agent_name === '-');

  return (
    <div className="cv-page">
      <PageHeader
        eyebrow={isAdmin ? 'Telecalling' : 'My work'}
        title="Shared Inbox"
        subtitle={isAdmin ? 'Call, message, and manage WhatsApp leads across your team.' : 'Your active conversations. Call, chat, and update lead status.'}
        actions={(
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <WebPhoneBadge />
            {isAdmin && (
              <Button
                variant="ghost"
                icon={DownloadCloud}
                onClick={syncTelecmi}
                disabled={syncing}
                title="Pull call logs + recordings from TeleCMI"
              >
                {syncing ? 'Syncing…' : 'Sync calls'}
              </Button>
            )}
          </div>
        )}
      />

      {toast && (
        <div className="cv-alert cv-alert--ok" style={{ cursor: 'pointer' }} onClick={() => setToast('')}>
          {toast}
        </div>
      )}
      {err && (
        <div className="cv-alert cv-alert--bad" style={{ cursor: 'pointer' }} onClick={() => setErr('')}>
          {err}
        </div>
      )}

      <div className={`cv-inbox-frame ${mobileThread ? 'cv-inbox-frame--thread' : ''}`}>
        {/* ── Conversation list ── */}
        <aside className="cv-inbox-list">
          <div className="cv-inbox-list-head">
            <div className="cv-inbox-search">
              <Search size={15} />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or mobile…"
              />
            </div>
            <div className="cv-inbox-filters">
              {FILTERS.map(([k, l]) => (
                <button
                  key={k}
                  type="button"
                  className={`cv-inbox-chip ${filter === k ? 'on' : ''}`}
                  onClick={() => setFilter(k)}
                >
                  {l}
                </button>
              ))}
            </div>
            {isAdmin && (
              <Select value={agentId} onChange={(e) => setAgentId(e.target.value)} style={{ marginTop: 8 }}>
                <option value="">All telecallers</option>
                <option value="unassigned">⚠ Unassigned</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            )}
          </div>
          <div className="cv-inbox-convos">
            {loading && <p className="cv-muted" style={{ padding: 16 }}>Loading…</p>}
            {!loading && convos.length === 0 && <p className="cv-muted" style={{ padding: 16 }}>No conversations.</p>}
            {convos.map((c) => {
              const m = statusMeta(c.lead_status);
              return (
                <button
                  key={c.clean_mobile}
                  type="button"
                  className={`cv-inbox-convo ${sel === c.clean_mobile ? 'on' : ''}`}
                  onClick={() => openThread(c.clean_mobile)}
                >
                  <span className="cv-inbox-ava">{initials(c.contact_name, c.clean_mobile)}</span>
                  <span className="cv-inbox-convo-main">
                    <span className="cv-inbox-convo-top">
                      <strong>{c.contact_name || `User ${String(c.clean_mobile).slice(-4)}`}</strong>
                      <em>{timeShort(c.last_message_at)}</em>
                    </span>
                    <span className="cv-inbox-convo-sub">{c.last_message || c.clean_mobile}</span>
                    <span className="cv-inbox-convo-tags">
                      <Pill tone={m.tone} dot>{m.label}</Pill>
                      {!c.assigned_agent_id ? (
                        <Pill tone="warn">Unassigned</Pill>
                      ) : (
                        isAdmin && <Pill tone="neutral">{c.assigned_agent_name}</Pill>
                      )}
                    </span>
                  </span>
                  {c.unread_count > 0 && <span className="cv-inbox-unread">{c.unread_count}</span>}
                </button>
              );
            })}
          </div>
        </aside>

        {/* ── Chat thread ── */}
        <section className="cv-inbox-thread">
          {!sel ? (
            <div className="cv-inbox-empty">
              <p>Select a conversation to view messages and make calls.</p>
            </div>
          ) : (
            <>
              <header className="cv-inbox-thread-head">
                <button
                  type="button"
                  className="cv-inbox-back"
                  onClick={() => setMobileThread(false)}
                  aria-label="Back"
                >
                  <ChevronLeft size={20} />
                </button>
                <span className="cv-inbox-ava">{initials(contact?.name, sel)}</span>
                <div className="cv-inbox-thread-id">
                  <strong>{contact?.name || `User ${String(sel).slice(-4)}`}</strong>
                  <small>
                    <span className="cv-mono-sm">+91{sel}</span>
                    {contact?.assigned_agent_name && contact.assigned_agent_name !== '-'
                      ? ` · ${contact.assigned_agent_name}`
                      : ''}
                  </small>
                </div>
                <div className="cv-inbox-thread-actions">
                  <Button size="sm" icon={Phone} onClick={callLead}>
                    Call
                  </Button>
                  <button
                    type="button"
                    className="cv-icon-btn cv-icon-btn--sm"
                    onClick={refreshThread}
                    title="Refresh"
                  >
                    <RefreshCw size={14} />
                  </button>
                </div>
              </header>

              <div className="cv-inbox-msgs">
                {!thread ? (
                  <p className="cv-muted" style={{ textAlign: 'center', padding: 20 }}>Loading…</p>
                ) : thread.messages.length === 0 ? (
                  <p className="cv-muted" style={{ textAlign: 'center', padding: 20 }}>No messages yet.</p>
                ) : (
                  thread.messages.map((msg, i) => {
                    if (msg.type === 'call') {
                      const rec = msg.metadata?.recording;
                      const sec = Number(
                        msg.metadata?.answeredsec ??
                          msg.metadata?.seconds ??
                          String(msg.body).match(/\((\d+)s\)/)?.[1] ??
                          0
                      );
                      const tone = callTone(msg.body);
                      const label =
                        tone === 'ok'
                          ? 'Voice call'
                          : tone === 'bad'
                          ? /missed|not answer/i.test(msg.body)
                            ? 'Missed call'
                            : 'Call not connected'
                          : 'Call connecting';
                      const mm = String(Math.floor(sec / 60)).padStart(2, '0');
                      const ss = String(sec % 60).padStart(2, '0');
                      return (
                        <div
                          key={i}
                          className={`cv-msg ${msg.direction === 'outgoing' ? 'cv-msg--out' : 'cv-msg--in'}`}
                        >
                          <div className={`cv-callcard cv-callcard--${tone}`}>
                            <div className="cv-callcard-row">
                              <span className="cv-callcard-ic">
                                <PhoneGlyph c="var(--cv-accent)" s={16} />
                              </span>
                              <div className="cv-callcard-txt">
                                <strong>{label}</strong>
                                <small>
                                  {sec
                                    ? `${mm}:${ss} min`
                                    : msg.direction === 'outgoing'
                                    ? 'Outgoing'
                                    : 'Incoming'}
                                </small>
                              </div>
                            </div>
                            {rec && (
                              <audio
                                controls
                                preload="none"
                                className="cv-callcard-audio"
                                src={`/api/crm/recordings?file=${encodeURIComponent(rec)}`}
                              />
                            )}
                          </div>
                          <span className="cv-msg-time">{timeShort(msg.created_at)}</span>
                        </div>
                      );
                    }
                    return (
                      <div
                        key={i}
                        className={`cv-msg ${msg.direction === 'outgoing' ? 'cv-msg--out' : 'cv-msg--in'}`}
                      >
                        <div className="cv-msg-bubble">
                          {msg.body}
                          {msg.metadata?.headerUrl &&
                            /\.(jpg|jpeg|png|webp)/i.test(msg.metadata.headerUrl) && (
                              <img src={msg.metadata.headerUrl} alt="" className="cv-msg-img" />
                            )}
                        </div>
                        <span className="cv-msg-time">{timeShort(msg.created_at)}</span>
                      </div>
                    );
                  })
                )}
                <div ref={endRef} />
              </div>

              <div className="cv-inbox-status-bar">
                <span className="cv-inbox-status-label">Outcome:</span>
                <div className="cv-inbox-outcome-group">
                  {[
                    ['contacted', 'Contacted', PhoneCall],
                    ['interested', 'Interested', CheckCircle2],
                    ['call_back', 'Call back', Clock],
                    ['not_answered', 'Not answered', PhoneMissed],
                    ['switch_off', 'Switched off', PhoneOff],
                  ].map(([k, label, Icon]) => {
                    const active = contact?.lead_status === k;
                    const m = statusMeta(k);
                    return (
                      <button
                        key={k}
                        type="button"
                        className={`cv-outcome-btn cv-outcome-btn--${m.tone} ${active ? 'is-active' : ''}`}
                        onClick={() => setStatus(k)}
                        title={`Set outcome: ${label}`}
                      >
                        <Icon size={12} />
                        <span>{label}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="cv-inbox-status-calls">
                  {[
                    ['first_call_complete', '1st Call'],
                    ['second_call_complete', '2nd Call'],
                    ['third_call_complete', '3rd Call'],
                  ].map(([k, label]) => {
                    const active = contact?.lead_status === k;
                    return (
                      <button
                        key={k}
                        type="button"
                        className={`cv-call-step-btn ${active ? 'is-active' : ''}`}
                        onClick={() => setStatus(k)}
                        title={`Log: ${label}`}
                      >
                        <PhoneForwarded size={11} />
                        <span>{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="cv-inbox-composer">
                {windowOpen ? (
                  <>
                    <Input
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          send();
                        }
                      }}
                      placeholder="Type a WhatsApp reply…"
                    />
                    <button
                      type="button"
                      className="cv-inbox-send"
                      onClick={send}
                      disabled={sending || !text.trim()}
                      aria-label="Send"
                    >
                      <Send size={16} />
                    </button>
                  </>
                ) : (
                  <p className="cv-inbox-closed">
                    ⏳ The 24-hour WhatsApp messaging window is closed. (The contact must message first to re-open free-form replies.)
                  </p>
                )}
              </div>
            </>
          )}
        </section>

        {/* ── Lead details ── */}
        {sel && contact && (
          <aside className="cv-inbox-details">
            <div className="cv-inbox-details-card">
              <div className="cv-inbox-ava cv-inbox-ava--lg">{initials(contact.name, sel)}</div>
              <h3 className="cv-inbox-contact-name">{contact.name || `User ${String(sel).slice(-4)}`}</h3>
              <p className="cv-muted cv-mono-sm">+91{sel}</p>
              <div className="cv-inbox-tags">
                <Pill tone={contact.is_registered ? 'ok' : 'neutral'} dot>
                  {contact.is_registered ? 'Registered' : 'Not registered'}
                </Pill>
                {contact.is_pro && <Pill tone="info" icon={Sparkles}>Pro</Pill>}
                {unassigned ? (
                  <Pill tone="warn">Unassigned</Pill>
                ) : (
                  <Pill tone="neutral" icon={contact.taken ? Lock : undefined}>
                    {contact.assigned_agent_name}{contact.taken ? ' (Claimed)' : ''}
                  </Pill>
                )}
              </div>
              {unassigned && (canClaim || isAdmin) && (
                <Button size="sm" variant="ghost" icon={Hand} onClick={claim} style={{ marginTop: 10 }}>
                  {isAdmin ? 'Take lead' : 'Claim'}
                </Button>
              )}
            </div>

            <div className="cv-inbox-section">
              <div className="cv-field-label">Electoral Info</div>
              <dl className="cv-inbox-kv">
                <div><dt>District</dt><dd>{contact.district || '—'}</dd></div>
                <div><dt>Assembly</dt><dd>{contact.assembly || '—'}</dd></div>
                <div><dt>Position</dt><dd>{contact.position && contact.position !== '-' ? contact.position : '—'}</dd></div>
                <div><dt>Passcode</dt><dd className="cv-mono-sm">{contact.passcode && contact.passcode !== '-' ? contact.passcode : '—'}</dd></div>
              </dl>
            </div>

            <div className="cv-inbox-notes">
              <div className="cv-field-label"><StickyNote size={13} /> Notes &amp; remarks</div>
              <textarea
                className="cv-input cv-textarea"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Log notes about this call..."
              />
              <Button size="sm" icon={StickyNote} onClick={saveNotes} style={{ marginTop: 6 }}>
                {savedNote ? 'Saved ✓' : 'Save note'}
              </Button>
            </div>

            <div className="cv-inbox-history">
              <div className="cv-field-label"><Clock size={13} /> Status Activity</div>
              {(contact.status_history || []).slice(-6).reverse().map((h, i) => {
                const m = statusMeta(h.status);
                return (
                  <div key={i} className="cv-inbox-hist-row">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Pill tone={m.tone} dot>{m.label}</Pill>
                      <span className="cv-muted" style={{ fontSize: 11 }}>{fmtDateTime(h.at)}</span>
                    </div>
                    {h.recording && (
                      <audio
                        controls
                        preload="none"
                        src={`/api/crm/recordings?file=${encodeURIComponent(h.recording)}`}
                        style={{ width: '100%', height: 30, marginTop: 4 }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
