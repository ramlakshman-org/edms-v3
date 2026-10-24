// TeleCMI cloud-telephony integration (click-to-call + helpers).
// Docs: https://doc.telecmi.com/chub/docs/click-to-call-admin
//   POST https://rest.telecmi.com/v2/webrtc/click2call
//   body: { user_id, secret, to, callerid?, webrtc?, followme?, extra_params? }
//   200 → { code, msg, request_id } · 400 missing · 404 bad user_id · 407 bad secret

const BASE = (process.env.TELECMI_BASE || 'https://rest.telecmi.com').replace(/\/$/, '');
const APP_ID = process.env.TELECMI_APP_ID || '';
const SECRET = process.env.TELECMI_APP_SECRET || '';
const DEFAULT_CALLER = process.env.TELECMI_CALLER_ID || '';

export function telecmiConfigured() { return !!(APP_ID && SECRET); }
export function telecmiAppId() { return APP_ID; }

// Normalise an Indian mobile to the 91XXXXXXXXXX form TeleCMI expects.
export function toDialNumber(m) {
  const d = String(m ?? '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 10) return `91${d}`;
  return d;
}

/**
 * Place a click-to-call. The agent's phone (softphone when webrtc, else their
 * registered mobile via followme) rings first, then TeleCMI dials `to`.
 * @param {object} p
 * @param {string} p.userId    TeleCMI user id of the telecaller (agent).
 * @param {string|number} p.to Destination (the lead) — any format; normalised here.
 * @param {string|number} [p.callerid] Caller id to present (defaults to env / user default).
 * @param {boolean} [p.followme=true] true → ring the agent's mobile (webrtc off).
 */
export async function click2call({ userId, to, callerid, followme = true }) {
  if (!telecmiConfigured()) throw new Error('TeleCMI is not configured (set TELECMI_APP_SECRET).');
  if (!userId) throw new Error('This telecaller has no TeleCMI User ID set.');
  const dest = toDialNumber(to);
  if (!dest) throw new Error('Invalid destination number.');

  const body = {
    user_id: String(userId),
    secret: SECRET,
    to: Number(dest),
    webrtc: !followme,      // followme (ring mobile) requires webrtc:false
    followme: !!followme,
    extra_params: { crm: true },
  };
  const cid = callerid || DEFAULT_CALLER;
  if (cid) body.callerid = Number(toDialNumber(cid));

  let res, data;
  try {
    res = await fetch(`${BASE}/v2/webrtc/click2call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    data = await res.json().catch(() => ({}));
  } catch (e) {
    throw new Error(`Could not reach TeleCMI: ${e.message}`);
  }

  const ok = res.status === 200 && (data.code === undefined || Number(data.code) === 200);
  if (!ok) {
    const map = {
      400: 'Missing user id/secret, or no call method is enabled.',
      404: 'Invalid TeleCMI User ID for this telecaller.',
      407: 'Invalid TeleCMI app secret — check TELECMI_APP_SECRET.',
    };
    throw new Error(data?.msg || map[res.status] || `TeleCMI click-to-call failed (HTTP ${res.status}).`);
  }
  return { request_id: data.request_id, msg: data.msg || 'Call initiated' };
}

/**
 * Fetch a TeleCMI user's call detail records (incoming + outgoing, answered + missed)
 * for a time window, normalised for CRM import. Needs the user's id + softphone password.
 * APIs: POST /v2/user/login → token, then /v2/user/out_cdr and /v2/user/in_cdr.
 */
export async function fetchUserCdr({ userId, password, from, to }) {
  const L = await fetch(`${BASE}/v2/user/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: String(userId), password: String(password) }) });
  const lj = await L.json().catch(() => ({}));
  if (!lj.token) throw new Error('TeleCMI user login failed — check the TeleCMI User ID / softphone password.');
  const token = lj.token;
  const LIMIT = 10;
  const rows = [];
  for (const [path, direction] of [['out_cdr', 'outgoing'], ['in_cdr', 'incoming']]) {
    for (const type of [1, 0]) { // 1 = answered, 0 = missed
      for (let page = 1; page <= 40; page += 1) {
        let j;
        try {
          const r = await fetch(`${BASE}/v2/user/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, token, from, to, page, limit: LIMIT }) });
          j = await r.json();
        } catch { break; }
        const cdr = Array.isArray(j?.cdr) ? j.cdr : [];
        for (const c of cdr) {
          const raw = direction === 'outgoing' ? c.to : c.from;
          const number = String(raw ?? '').replace(/\D/g, '').slice(-10);
          rows.push({ cmiuid: c.cmiuid || null, direction, answered: type === 1, duration: Number(c.duration || 0), filename: c.filename || null, number, time: Number(c.time) || Date.now(), name: c.name });
        }
        if (cdr.length < LIMIT) break;
      }
    }
  }
  return rows;
}
