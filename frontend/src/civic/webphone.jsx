import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import PIOPIY from 'piopiyjs';
import { Headset, Loader } from 'lucide-react';
import api from '../api/client.js';

// Browser softphone (TeleCMI PIOPIY WebRTC). The telecaller talks through the
// computer — no mobile rings, and the lead sees the account DID as caller id.
// Credentials come from GET /crm/softphone (the logged-in telecaller's own).

const Ctx = createContext(null);
export const useWebPhone = () => useContext(Ctx) || { ready: false };

const dial = (m) => { const d = String(m || '').replace(/\D/g, ''); return d.length === 10 ? `91${d}` : d; };

export function WebPhoneProvider({ children }) {
  const piopiyRef = useRef(null);
  const [status, setStatus] = useState('idle'); // idle | connecting | ready | unavailable | error
  const [reason, setReason] = useState('');       // why unavailable (admin / missing creds)
  const [call, setCall] = useState(null);         // { contact, number, state, startedAt }
  const [recSync, setRecSync] = useState(0);       // bumped after an auto recording-sync, so the inbox refreshes
  const callRef = useRef(null);
  callRef.current = call;
  const pendingRef = useRef(null);                 // an outbound web call we just asked TeleCMI to bridge
  const bridgingRef = useRef(false);               // our own leg is up; the LEAD is still being dialed (keep "Ringing…")

  // POST the finished call's outcome into the lead history.
  const logOutcome = useCallback((c, outcome) => {
    if (!c?.number) return;
    const seconds = c.startedAt ? Math.round((Date.now() - c.startedAt) / 1000) : 0;
    api.post(`/crm/conversations/${dial(c.number)}/call-log`, { outcome, seconds }).catch(() => {});
  }, []);

  useEffect(() => {
    let piopiy;
    let cancelled = false;
    setStatus('connecting');
    api.get('/crm/softphone')
      .then(({ data }) => {
        if (cancelled) return;
        if (!data.softphone) { setStatus('unavailable'); setReason(data.message || ''); return; }
        const { user_id, password, sbc, name } = data.softphone;
        piopiy = new PIOPIY({ name: name || 'EDMS', debug: false, autoplay: true, ringTime: 60 });
        piopiyRef.current = piopiy;

        const log = (ev, o) => console.info(`[webphone] ${ev}`, o || '');
        let loginOk = false;
        piopiy.on('login', (o) => { log('login', o); if (!cancelled && (o?.code === 200 || o?.code === undefined)) { loginOk = true; setStatus('ready'); } });
        // A 407 is the normal SIP auth challenge and is immediately followed by a
        // successful login, so a loginFailed is almost always transient. Don't flag
        // an error right away — only if we still aren't 'ready' a few seconds later.
        piopiy.on('loginFailed', (o) => {
          log('loginFailed', o);
          if (cancelled || loginOk) return;
          setTimeout(() => {
            if (!cancelled && !loginOk) {
              setStatus('error');
              setReason('TeleCMI softphone login failed — check the telecaller’s TeleCMI User ID/password.');
            }
          }, 8000);
        });
        piopiy.on('trying', (o) => { log('trying', o); setCall((c) => c && { ...c, state: 'trying' }); });
        piopiy.on('ringing', (o) => { log('ringing', o); setCall((c) => c && { ...c, state: 'ringing' }); });
        piopiy.on('answered', (o) => {
          log('answered', o);
          // On an outbound web call our OWN leg auto-answers first while the lead is
          // still ringing — ignore that one (keep showing "Ringing…"); the lead's
          // actual answer arrives as a later answered/callStream event.
          if (bridgingRef.current) { bridgingRef.current = false; return; }
          setCall((c) => c && { ...c, state: 'answered', startedAt: c.startedAt || Date.now() });
        });
        piopiy.on('callStream', (o) => {
          log('callStream', o);
          // Media is flowing → the lead has connected. Start the timer now.
          bridgingRef.current = false;
          setCall((c) => c && { ...c, state: 'answered', startedAt: c.startedAt || Date.now() });
        });
        const onEnd = (o) => {
          log('hangup/ended', o);
          bridgingRef.current = false;
          const c = callRef.current;
          if (c) logOutcome(c, c.state === 'answered' ? 'answered' : (o?.code && o.code !== 200 ? 'failed' : 'missed'));
          // An answered call has a recording on TeleCMI a few seconds later. Pull it
          // in automatically (a couple of attempts, since processing takes a moment)
          // so the voice recording appears in the thread on its own — no manual sync.
          if (c?.state === 'answered') {
            let tries = 0;
            const pull = () => {
              tries += 1;
              api.post('/crm/sync-recordings', { days: 1 }).then(() => setRecSync(Date.now())).catch(() => {});
              if (tries < 3) setTimeout(pull, 20000);
            };
            setTimeout(pull, 10000);
          }
          setCall(null);
        };
        piopiy.on('hangup', onEnd);
        piopiy.on('ended', onEnd);
        piopiy.on('error', (o) => { log('error', o); setCall((c) => { if (c) logOutcome(c, 'failed'); return null; }); });
        // Incoming INVITE: either the bridged leg of a web call we just started
        // (auto-answer it — the agent wanted this call), or a genuine inbound lead.
        piopiy.on('inComingCall', (o) => {
          log('inComingCall', o);
          const pend = pendingRef.current;
          if (pend && Date.now() - pend.at < 40000) {
            pendingRef.current = null;
            bridgingRef.current = true; // our leg answers now; keep "Ringing…" until the lead connects
            try { piopiy.answer(); } catch { /* ignore */ }
            setCall((c) => ({ ...(c || {}), contact: pend.contact, number: pend.number, state: 'ringing', direction: 'outbound', startedAt: null }));
            return;
          }
          const num = o?.from || o?.caller || o?.number || o?.remote || '';
          setCall({ contact: { name: o?.name || null }, number: String(num), state: 'incoming', direction: 'incoming', startedAt: null });
        });

        try { piopiy.login(user_id, password, sbc); } catch (e) { setStatus('error'); setReason(e.message); }
      })
      .catch(() => { if (!cancelled) { setStatus('unavailable'); setReason('Could not load softphone credentials.'); } });

    return () => {
      cancelled = true;
      try { piopiy?.terminate?.(); } catch { /* ignore */ }
      piopiyRef.current = null;
    };
  }, [logOutcome]);

  const startCall = useCallback(async (number, contact) => {
    const p = piopiyRef.current;
    if (!p || status !== 'ready') return { ok: false, message: reason || 'Softphone not connected yet.' };
    // Show the call card immediately (Calling…), before the mic prompt, so there's a preview.
    setCall({ contact: contact || {}, number, state: 'trying', direction: 'outbound', startedAt: null });
    // The browser call needs the microphone (and a secure page: localhost or https).
    // Check it first so failures are a clear message, not a silent no-ring.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch (e) {
      setCall(null);
      const insecure = location.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(location.hostname);
      return { ok: false, message: insecure
        ? 'Microphone is blocked because the page isn’t secure. Open the CRM at http://localhost:5173 (or an https URL) to call from the browser.'
        : 'Microphone was blocked or not found. Click the 🔒 in the address bar, allow the microphone, then try again.' };
    }
    try {
      // Direct dial from the browser softphone. PIOPIY reports accurate call
      // progress: 'ringing' while the LEAD's phone rings, 'answered' when they
      // actually pick up (timer starts then), 'ended' on no-answer/hangup
      // (card auto-closes). extra_param must be a string per the SDK.
      p.call(dial(number), { extra_param: 'crm' });
      return { ok: true };
    } catch (e) {
      setCall(null);
      return { ok: false, message: e.message || 'Could not start the call.' };
    }
  }, [status, reason]);

  // Web call: TeleCMI originates the call (so it passes the DID as caller id) and
  // rings this browser softphone, which we auto-answer — the lead then sees the DID.
  const startWebCall = useCallback(async (number, contact) => {
    if (status !== 'ready') return { ok: false, message: reason || 'Softphone not connected yet.' };
    // Show the call card immediately, the moment Call is clicked, so there is a
    // visible preview even while the mic prompt / bridge is still being set up.
    setCall({ contact: contact || {}, number, state: 'trying', direction: 'outbound', startedAt: null });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch (e) {
      setCall(null);
      const insecure = location.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(location.hostname);
      return { ok: false, message: insecure
        ? 'Microphone is blocked because the page isn’t secure. Open the CRM at http://localhost:5173 (or https).'
        : 'Microphone was blocked or not found. Click the 🔒/🎤 in the address bar, allow the microphone, then click Call again.' };
    }
    pendingRef.current = { number, contact: contact || {}, at: Date.now() };
    const placeCall = () => api.post(`/crm/conversations/${dial(number)}/call`, { web: true });
    try {
      await placeCall();
      return { ok: true };
    } catch (e) {
      // A 5xx usually means the API restarted for a moment — retry once before failing.
      if (e?.response?.status >= 500 || !e?.response) {
        await new Promise((r) => setTimeout(r, 900));
        try { await placeCall(); return { ok: true }; } catch (e2) { e = e2; }
      }
      pendingRef.current = null;
      setCall(null);
      return { ok: false, message: e?.response?.data?.message || 'Could not start the call. Please try again in a moment.' };
    }
  }, [status, reason]);

  const hangup = useCallback(() => { pendingRef.current = null; try { piopiyRef.current?.terminate?.(); } catch { /* ignore */ } }, []);
  const answer = useCallback(() => {
    try { piopiyRef.current?.answer?.(); setCall((c) => c && { ...c, state: 'answered', startedAt: Date.now() }); } catch { /* ignore */ }
  }, []);
  const reject = useCallback(() => { try { piopiyRef.current?.reject?.(); } catch { /* ignore */ } setCall(null); }, []);
  const sendDtmf = useCallback((d) => { try { piopiyRef.current?.sendDtmf?.(String(d)); } catch { /* ignore */ } }, []);
  const [muted, setMuted] = useState(false);
  const toggleMute = useCallback(() => {
    const p = piopiyRef.current; if (!p) return;
    try { if (muted) { (p.unMute || p.unmute)?.call(p); } else { p.mute?.(); } setMuted((m) => !m); } catch { /* ignore */ }
  }, [muted]);
  const [held, setHeld] = useState(false);
  const toggleHold = useCallback(() => {
    const p = piopiyRef.current; if (!p) return;
    try { p.hold?.(); setHeld((h) => !h); } catch { /* ignore */ }
  }, []);
  useEffect(() => { if (!call) { setMuted(false); setHeld(false); } }, [call]);

  const value = { ready: status === 'ready', status, reason, call, recordingSyncedAt: recSync, startCall, startWebCall, hangup, answer, reject, sendDtmf, muted, toggleMute, held, toggleHold };
  return (
    <Ctx.Provider value={value}>
      {children}
      <CallBar />
    </Ctx.Provider>
  );
}

// Small status chip so the telecaller can SEE whether web calling is live before clicking Call.
export function WebPhoneBadge() {
  const { status, reason } = useWebPhone();
  if (status === 'unavailable' && reason && /admin/i.test(reason)) return null; // admin uses the bridge; no badge
  const map = {
    connecting: { tone: 'warn', icon: Loader, text: 'Web phone: connecting…', spin: true },
    ready: { tone: 'ok', icon: Headset, text: 'Web phone: ready' },
    unavailable: { tone: 'neutral', icon: Headset, text: 'Web phone: not set up' },
    error: { tone: 'bad', icon: Headset, text: 'Web phone: login failed' },
    idle: { tone: 'neutral', icon: Headset, text: 'Web phone: starting…' },
  };
  const m = map[status] || map.idle;
  const Icon = m.icon;
  return (
    <span className={`cv-pill cv-pill--${m.tone}`} title={reason || m.text} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <Icon size={13} style={m.spin ? { animation: 'cv-spin 0.9s linear infinite' } : undefined} />
      {m.text}
    </span>
  );
}

const DTMF_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

// Inline SVG icons with hardcoded colors — no dependency on an icon library or
// theme variables, so they always render on the portaled call card in any browser.
const stroked = { fill: 'none', strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round' };
const MicI = ({ c = '#1f2937', s = 22 }) => (<svg width={s} height={s} viewBox="0 0 24 24" stroke={c} {...stroked}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><line x1="12" y1="18" x2="12" y2="22" /></svg>);
const MicOffI = ({ c = '#fff', s = 22 }) => (<svg width={s} height={s} viewBox="0 0 24 24" stroke={c} {...stroked}><line x1="3" y1="3" x2="21" y2="21" /><path d="M9 9v3a3 3 0 0 0 5 2.1" /><path d="M15 10.5V6a3 3 0 0 0-6 0" /><path d="M5 11a7 7 0 0 0 11 4.9" /><line x1="12" y1="18" x2="12" y2="22" /></svg>);
const KeypadI = ({ c = '#1f2937', s = 22 }) => (<svg width={s} height={s} viewBox="0 0 24 24" fill={c} stroke="none">{[6, 12, 18].flatMap((y) => [6, 12, 18].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.7" />))}</svg>);
const PauseI = ({ c = '#1f2937', s = 22 }) => (<svg width={s} height={s} viewBox="0 0 24 24" fill={c} stroke="none"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>);
const PlayI = ({ c = '#fff', s = 22 }) => (<svg width={s} height={s} viewBox="0 0 24 24" fill={c} stroke="none"><path d="M7 5l12 7-12 7z" /></svg>);
const PhoneI = ({ c = '#fff', s = 24 }) => (<svg width={s} height={s} viewBox="0 0 24 24" fill={c} stroke="none"><path d="M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.24 11 11 0 0 0 3.5.56 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1 11 11 0 0 0 .56 3.5 1 1 0 0 1-.24 1z" /></svg>);
const PhoneOffI = ({ c = '#fff', s = 26 }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" stroke={c} {...stroked}>
    <path d="M3.5 13C5 9.7 8.2 8.5 12 8.5s7 1.2 8.5 4.5c.5 1.1 0 2.4-1.1 2.8l-1.6.6c-.9.3-2-.1-2.5-1l-.5-.9c-.6-1-1.6-1.6-2.8-1.6s-2.2.6-2.8 1.6l-.5.9c-.5.9-1.6 1.3-2.5 1l-1.6-.6c-1.1-.4-1.6-1.7-1.1-2.8z" />
  </svg>
);

// A mobile-dialer-style call card: avatar, name/number, live timer, and round
// controls (mute · keypad · hold · hang up; answer/decline for incoming calls).
function CallBar() {
  const { call, hangup, answer, reject, sendDtmf, muted, toggleMute, held, toggleHold } = useWebPhone();
  const [elapsed, setElapsed] = useState(0);
  const [pad, setPad] = useState(false);
  const [typed, setTyped] = useState('');
  useEffect(() => {
    if (call?.state !== 'answered' || !call.startedAt) { setElapsed(0); return undefined; }
    const t = setInterval(() => setElapsed(Math.round((Date.now() - call.startedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [call?.state, call?.startedAt]);
  useEffect(() => { if (!call) { setPad(false); setTyped(''); } }, [call]);
  // When the lead actually answers, open the dialpad so DTMF digits can be pressed right away.
  useEffect(() => { if (call?.state === 'answered') setPad(true); }, [call?.state]);
  if (!call) return null;

  const incoming = call.state === 'incoming';
  const answered = call.state === 'answered';
  const label = incoming ? 'Incoming call' : { trying: 'Calling…', ringing: 'Ringing…', answered: 'In call' }[call.state] || 'Calling…';
  const name = call.contact?.name || call.contact?.contact_name || (call.number ? `+${String(call.number).replace(/\D/g, '')}` : 'Unknown');
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  const initials = String(name).replace(/\+?\d+/g, '').trim().split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '📞';
  const press = (k) => { setTyped((s) => (s + k).slice(-20)); sendDtmf(k); };

  return (
    <div className="cv-phone" role="dialog" aria-label="Call" aria-live="polite">
      <div className="cv-phone-head">
        <span className={`cv-phone-avatar ${answered ? 'cv-phone-avatar--live' : ''}`}>{initials}</span>
        <div className="cv-phone-id">
          <strong>{name}</strong>
          <span className="cv-phone-num">{call.number ? `+${String(call.number).replace(/\D/g, '')}` : ''}</span>
        </div>
        <span className={`cv-phone-status ${incoming ? 'cv-phone-status--ring' : ''}`}>
          {answered ? `${mm}:${ss}` : label}
        </span>
      </div>

      {pad && answered && (
        <div className="cv-phone-pad">
          {typed && <div className="cv-phone-typed">{typed}</div>}
          <div className="cv-phone-keys">
            {DTMF_KEYS.map((k) => (
              <button key={k} type="button" className="cv-phone-key" onClick={() => press(k)}>{k}</button>
            ))}
          </div>
        </div>
      )}

      <div className="cv-phone-actions">
        {incoming ? (
          <>
            <button type="button" className="cv-phone-btn cv-phone-btn--end" onClick={reject} title="Decline" aria-label="Decline">
              <PhoneOffI c="#fff" s={26} />
            </button>
            <button type="button" className="cv-phone-btn cv-phone-btn--answer" onClick={answer} title="Answer" aria-label="Answer">
              <PhoneI c="#fff" s={24} />
            </button>
          </>
        ) : answered ? (
          <>
            <button type="button" className={`cv-phone-btn ${muted ? 'cv-phone-btn--on' : ''}`} onClick={toggleMute} title={muted ? 'Unmute' : 'Mute'} aria-label={muted ? 'Unmute' : 'Mute'}>
              {muted ? <MicOffI c="#fff" /> : <MicI c="#1f2937" />}
            </button>
            <button type="button" className={`cv-phone-btn ${pad ? 'cv-phone-btn--on' : ''}`} onClick={() => setPad((p) => !p)} title="Keypad" aria-label="Keypad">
              <KeypadI c={pad ? '#fff' : '#1f2937'} />
            </button>
            <button type="button" className={`cv-phone-btn ${held ? 'cv-phone-btn--on' : ''}`} onClick={toggleHold} title={held ? 'Resume' : 'Hold'} aria-label={held ? 'Resume' : 'Hold'}>
              {held ? <PlayI c="#fff" /> : <PauseI c="#1f2937" />}
            </button>
            <button type="button" className="cv-phone-btn cv-phone-btn--end" onClick={hangup} title="Hang up" aria-label="Hang up">
              <PhoneOffI c="#fff" s={26} />
            </button>
          </>
        ) : (
          // Calling / ringing — just the cancel (hang up) button, like a phone dialing screen.
          <button type="button" className="cv-phone-btn cv-phone-btn--end" onClick={hangup} title="Cancel" aria-label="Cancel call">
            <PhoneOffI c="#fff" s={26} />
          </button>
        )}
      </div>
    </div>
  );
}
