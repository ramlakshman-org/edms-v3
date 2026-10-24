import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Send, Phone, Hand, RefreshCw, ChevronLeft, Clock, StickyNote, DownloadCloud } from 'lucide-react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useWebPhone, WebPhoneBadge } from '../../civic/webphone.jsx';
import { Pill } from '../../civic/kit.jsx';
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
      .then(({ data }) => { setConvos(data.conversations || []); setErr(''); })
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
    <div className={`cv-inbox ${mobileThread ? 'cv-inbox--thread' : ''}`}>
      {/* ── Conversation list ── */}
      <aside className="cv-inbox-list">
        <div className="cv-inbox-list-head">
          <div className="cv-inbox-title">
            <span>Inbox</span>
            <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
              {isAdmin && <button type="button" className="cv-inbox-sync" onClick={syncTelecmi} disabled={syncing} title="Pull call logs + recordings from TeleCMI"><DownloadCloud size={14} /> {syncing ? 'Syncing…' : 'Sync calls'}</button>}
              <WebPhoneBadge />
            </span>
          </div>
          {toast && <div className="cv-alert cv-alert--ok" style={{ margin: '0 0 8px', fontSize: 12.5 }} onClick={() => setToast('')}>{toast}</div>}
          <div className="cv-inbox-search">
            <Search size={15} /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or mobile…" />
          </div>
          <div className="cv-inbox-filters">
            {FILTERS.map(([k, l]) => <button key={k} type="button" className={`cv-inbox-chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{l}</button>)}
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
          {convos.map((c) => { const m = statusMeta(c.lead_status); return (
            <button key={c.clean_mobile} type="button" className={`cv-inbox-convo ${sel === c.clean_mobile ? 'on' : ''}`} onClick={() => openThread(c.clean_mobile)}>
              <span className="cv-inbox-ava">{initials(c.contact_name, c.clean_mobile)}</span>
              <span className="cv-inbox-convo-main">
                <span className="cv-inbox-convo-top"><strong>{c.contact_name || `User ${String(c.clean_mobile).slice(-4)}`}</strong><em>{timeShort(c.last_message_at)}</em></span>
                <span className="cv-inbox-convo-sub">{c.last_message || c.clean_mobile}</span>
                <span className="cv-inbox-convo-tags">
                  <Pill tone={m.tone}>{m.emoji} {m.label}</Pill>
                  {!c.assigned_agent_id ? <Pill tone="warn">Unassigned</Pill> : (isAdmin && <Pill tone="neutral">{c.assigned_agent_name}</Pill>)}
                </span>
              </span>
              {c.unread_count > 0 && <span className="cv-inbox-unread">{c.unread_count}</span>}
            </button>
          ); })}
        </div>
      </aside>

      {/* ── Chat thread ── */}
      <section className="cv-inbox-thread">
        {!sel ? (
          <div className="cv-inbox-empty"><p>Select a conversation to start.</p></div>
        ) : (
          <>
            <header className="cv-inbox-thread-head">
              <button type="button" className="cv-inbox-back" onClick={() => setMobileThread(false)} aria-label="Back"><ChevronLeft size={20} /></button>
              <span className="cv-inbox-ava">{initials(contact?.name, sel)}</span>
              <div className="cv-inbox-thread-id">
                <strong>{contact?.name || `User ${String(sel).slice(-4)}`}</strong>
                <small>+91{sel}{contact?.assigned_agent_name && contact.assigned_agent_name !== '-' ? ` · ${contact.assigned_agent_name}` : ''}</small>
              </div>
              <div className="cv-inbox-thread-actions">
                <Button size="sm" icon={Phone} onClick={callLead} disabled={!webphone.ready && false}>{webphone.ready ? 'Call' : 'Call'}</Button>
                <button type="button" className="cv-icon-btn" onClick={refreshThread} title="Refresh"><RefreshCw size={15} /></button>
              </div>
            </header>

            <div className="cv-inbox-msgs">
              {!thread ? <p className="cv-muted" style={{ textAlign: 'center', padding: 20 }}>Loading…</p> : thread.messages.length === 0 ? (
                <p className="cv-muted" style={{ textAlign: 'center', padding: 20 }}>No messages yet.</p>
              ) : thread.messages.map((msg, i) => {
                if (msg.type === 'call') {
                  const rec = msg.metadata?.recording;
                  const sec = Number(msg.metadata?.answeredsec ?? msg.metadata?.seconds ?? String(msg.body).match(/\((\d+)s\)/)?.[1] ?? 0);
                  const tone = callTone(msg.body);
                  const label = tone === 'ok' ? 'Voice call' : tone === 'bad' ? (/missed|not answer/i.test(msg.body) ? 'Missed call' : 'Call not connected') : 'Call connecting';
                  const mm = String(Math.floor(sec / 60)).padStart(2, '0');
                  const ss = String(sec % 60).padStart(2, '0');
                  return (
                    <div key={i} className={`cv-msg ${msg.direction === 'outgoing' ? 'cv-msg--out' : 'cv-msg--in'}`}>
                      <div className={`cv-callcard cv-callcard--${tone}`}>
                        <div className="cv-callcard-row">
                          <span className="cv-callcard-ic"><PhoneGlyph c="#334155" s={18} /></span>
                          <div className="cv-callcard-txt"><strong>{label}</strong><small>{sec ? `${mm}:${ss} min` : (msg.direction === 'outgoing' ? 'Outgoing' : 'Incoming')}</small></div>
                        </div>
                        {rec && <audio controls preload="none" className="cv-callcard-audio" src={`/api/crm/recordings?file=${encodeURIComponent(rec)}`} />}
                      </div>
                      <span className="cv-msg-time">{timeShort(msg.created_at)}</span>
                    </div>
                  );
                }
                return (
                  <div key={i} className={`cv-msg ${msg.direction === 'outgoing' ? 'cv-msg--out' : 'cv-msg--in'}`}>
                    <div className="cv-msg-bubble">{msg.body}{msg.metadata?.headerUrl && /\.(jpg|jpeg|png|webp)/i.test(msg.metadata.headerUrl) && <img src={msg.metadata.headerUrl} alt="" className="cv-msg-img" />}</div>
                    <span className="cv-msg-time">{timeShort(msg.created_at)}</span>
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>

            <div className="cv-inbox-status-bar">
              {['contacted', 'interested', 'call_back', 'not_answered', 'switch_off'].map((k) => { const m = statusMeta(k); return (
                <button key={k} type="button" className={`cv-pill cv-pill--${m.tone}`} style={{ cursor: 'pointer', border: 'none', fontSize: 12.5, padding: '5px 9px' }} onClick={() => setStatus(k)}>{m.emoji} {m.label}</button>
              ); })}
              <span className="cv-inbox-status-calls">
                {['first_call_complete', 'second_call_complete', 'third_call_complete'].map((k) => { const m = statusMeta(k); return (
                  <button key={k} type="button" className={`cv-pill cv-pill--${m.tone}`} style={{ cursor: 'pointer', border: 'none', fontSize: 12.5, padding: '5px 9px' }} onClick={() => setStatus(k)}>{m.emoji} {m.label}</button>
                ); })}
              </span>
            </div>

            <div className="cv-inbox-composer">
              {windowOpen ? (
                <>
                  <Input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Type a message…" />
                  <button type="button" className="cv-inbox-send" onClick={send} disabled={sending || !text.trim()} aria-label="Send"><Send size={18} /></button>
                </>
              ) : (
                <p className="cv-inbox-closed">⏳ The 24-hour WhatsApp window is closed — the lead must message first before you can send a free-form reply.</p>
              )}
            </div>
          </>
        )}
      </section>

      {/* ── Lead details ── */}
      {sel && contact && (
        <aside className="cv-inbox-details">
          <div className="cv-inbox-ava cv-inbox-ava--lg">{initials(contact.name, sel)}</div>
          <h3>{contact.name || `User ${String(sel).slice(-4)}`}</h3>
          <p className="cv-muted">+91{sel}</p>
          <div className="cv-inbox-tags">
            <Pill tone={contact.is_registered ? 'ok' : 'neutral'}>{contact.is_registered ? 'Registered' : 'Not registered'}</Pill>
            {contact.is_pro && <Pill tone="info">⭐ Pro</Pill>}
            {unassigned ? <Pill tone="warn">Unassigned</Pill> : <Pill tone="neutral">{contact.assigned_agent_name}{contact.taken ? ' 🔒' : ''}</Pill>}
          </div>
          {unassigned && (canClaim || isAdmin) && <Button size="sm" variant="ghost" icon={Hand} onClick={claim} style={{ marginTop: 10 }}>{isAdmin ? 'Take lead' : 'Claim'}</Button>}
          <dl className="cv-inbox-kv">
            <div><dt>District</dt><dd>{contact.district || '—'}</dd></div>
            <div><dt>Assembly</dt><dd>{contact.assembly || '—'}</dd></div>
            <div><dt>Position</dt><dd>{contact.position && contact.position !== '-' ? contact.position : '—'}</dd></div>
            <div><dt>Passcode</dt><dd>{contact.passcode && contact.passcode !== '-' ? contact.passcode : '—'}</dd></div>
          </dl>
          <div className="cv-inbox-notes">
            <div className="cv-field-label"><StickyNote size={13} /> Notes &amp; comments</div>
            <textarea className="cv-input cv-textarea" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add a note about this lead…" />
            <Button size="sm" icon={StickyNote} onClick={saveNotes} style={{ marginTop: 6 }}>{savedNote ? 'Saved ✓' : 'Save note'}</Button>
          </div>

          <div className="cv-inbox-history">
            <div className="cv-field-label"><Clock size={13} /> Recent activity</div>
            {(contact.status_history || []).slice(-6).reverse().map((h, i) => { const m = statusMeta(h.status); return (
              <div key={i} className="cv-inbox-hist-row">
                <Pill tone={m.tone}>{m.emoji} {m.label}</Pill>
                <span className="cv-muted">{fmtDateTime(h.at)}</span>
                {h.recording && <audio controls preload="none" src={`/api/crm/recordings?file=${encodeURIComponent(h.recording)}`} style={{ width: '100%', height: 32, marginTop: 4 }} />}
              </div>
            ); })}
          </div>
        </aside>
      )}
    </div>
  );
}
