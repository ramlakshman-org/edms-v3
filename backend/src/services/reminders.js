// WhatsApp reminders (Ram, 2026-10-16). Two jobs, both behind the switches in services/features.js:
//  • payment     — registered, not paid: 5 template reminders, the 1st 24 h after registration, then +24 h, +24 h, +48 h,
//                  +48 h after the reminder before (exact to the job's 2-minute tick). Stops when paid; waits while a
//                  payment proof is pending; "Pay Later" pauses 48 h; after the 5th the person stays for a phone call.
//  • incomplete  — messaged the bot / started the website form, no account: one FREE nudge 2 h after they go quiet
//                  (WhatsApp only, still inside WhatsApp's 24 h window), then a template 24 h after their last message
//                  and a 2nd one 48 h after that — templates only for people who chose at least one option.
// Reply STOP (stop_optout) ends every reminder for that number. Each send (or dry-run "would send") is written to
// tbl_reminder_log; the state per number and kind lives in tbl_reminders. Only registrations / contacts from the moment a
// job was first switched on are handled automatically (older ones are sent by hand from the admin page).
// Only findOne / find / insertOne / updateOne($set) are used, so the offline harness's fake DB runs all of it.
import { getFeatureSettings, modeFor } from './features.js';

export const REMINDERS_COLL = 'tbl_reminders';
export const REMINDER_LOG_COLL = 'tbl_reminder_log';
export const OPTOUT_COLL = 'tbl_wa_optout';
export const PAYMENT_GAPS_H = [24, 24, 24, 48, 48]; // gap before reminder 1..5 (1st: after registration)
export const NUDGE_AFTER_H = 2;
export const INCOMPLETE_T1_AFTER_H = 24;
export const INCOMPLETE_T2_AFTER_H = 48;
const RETRY_H = 1;
const MAX_TRIES = 6;
const H = 3600 * 1000;

const ten = (m) => String(m || '').replace(/\D/g, '').slice(-10);
const iso = (d) => new Date(d).toISOString();
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || 'there';
const last4 = (m) => `******${ten(m).slice(-4)}`;

export function planFor(booths) {
  const n = Number(booths) || 1;
  if (n <= 1) return { name: '1 Booth', price: '₹2,000' };
  if (n <= 5) return { name: 'Up to 5 Booths', price: '₹5,000' };
  if (n <= 10) return { name: 'Up to 10 Booths', price: '₹10,000' };
  if (n <= 25) return { name: 'Up to 25 Booths', price: '₹25,000' };
  return { name: 'Up to 100 Booths', price: '₹50,000' };
}

export async function resolveHeaderImg(db, key) {
  try {
    const asset = await db.collection('app_flow_images').findOne({ key });
    if (asset?.url) return String(asset.url).replace(/^http:\/\//, 'https://');
  } catch {}
  return 'https://tnedms.com/EDM.png';
}

// The template message for one person, exactly as the jobs build it (also used by the admin "Send a test message").
// user = their tbl_user row or null (then a neutral name and 1 booth are used).
export function templateFor(settings, key, lang, user = null, fallbackName = '', headerImage = 'https://tnedms.com/EDM.png') {
  const t = settings.templates[key];
  if (!t) throw new Error(`Unknown template ${key}.`);
  const booths = (Array.isArray(user?.booths) && user.booths.length) || Number(user?.booth_count) || 1;
  const name = firstName(user?.first_name || fallbackName);
  const params = key === 'payment' ? [name, String(booths), `${planFor(booths).price} + 18% GST`]
    : key === 'activated' ? [name, String(booths)]
    : [name];
  return { name: t.name, lang: lang === 'ta' ? t.ta : t.en, params, headerImage };
}

// ── hooks used by the bot and the website ─────────────────────────────────────

// A new account (bot or website): start its payment-reminder clock. Best effort, never throws.
export async function onRegistered(db, { mobile, name = '', lang = 'en', booth_count = 0, source = 'whatsapp', at = new Date() }) {
  try {
    const m = ten(mobile);
    if (m.length !== 10) return;
    const coll = db.collection(REMINDERS_COLL);
    if (await coll.findOne({ kind: 'payment', mobile: m })) return;
    await coll.insertOne({
      kind: 'payment', mobile: m, name: String(name || ''), lang: lang === 'ta' ? 'ta' : 'en', booth_count: Number(booth_count) || 0, source,
      registered_at: iso(at), count: 0, next_at: iso(new Date(at).getTime() + PAYMENT_GAPS_H[0] * H), last_sent_at: null,
      tries: 0, pay_later: [], done_at: null, done_reason: '', stopped_at: null,
    });
  } catch (e) {
    console.warn(`[reminders] ${new Date().toISOString()} start failed for ${last4(mobile)}: ${e.message}`);
  }
}

// The admin deleted this number's account: forget its payment-reminder clock, so a new registration starts a new one.
export async function forgetPaymentClock(db, mobile) {
  try {
    await db.collection(REMINDERS_COLL).deleteOne({ kind: 'payment', mobile: ten(mobile) });
  } catch (e) {
    console.warn(`[reminders] ${new Date().toISOString()} clock reset failed for ${last4(mobile)}: ${e.message}`);
  }
}

export async function isOptedOut(db, mobile) {
  return !!(await db.collection(OPTOUT_COLL).findOne({ mobile: ten(mobile) }));
}

export async function optOut(db, mobile, via = 'whatsapp') {
  const m = ten(mobile);
  const now = iso(Date.now());
  if (!(await isOptedOut(db, m))) await db.collection(OPTOUT_COLL).insertOne({ mobile: m, at: now, via });
  for (const kind of ['payment', 'incomplete']) {
    const r = await db.collection(REMINDERS_COLL).findOne({ kind, mobile: m });
    if (r && !r.stopped_at) await db.collection(REMINDERS_COLL).updateOne({ kind, mobile: m }, { $set: { stopped_at: now, stop_reason: 'replied STOP' } });
  }
}

// "Pay Later" answer: keep what they wrote and give them 48 h before the next reminder.
export async function payLater(db, mobile, text, at = new Date()) {
  const m = ten(mobile);
  const coll = db.collection(REMINDERS_COLL);
  const r = await coll.findOne({ kind: 'payment', mobile: m });
  const entry = { text: String(text || '').slice(0, 500), at: iso(at) };
  const resume = new Date(at).getTime() + 48 * H;
  await db.collection(REMINDER_LOG_COLL).insertOne({ kind: 'pay_later', mobile: m, text: entry.text, at: entry.at, mode: 'reply', ok: true });
  if (!r) return; // no reminder clock (registered before the feature): the answer is kept in the log above
  const next = r.next_at && new Date(r.next_at).getTime() > resume ? r.next_at : iso(resume);
  await coll.updateOne({ kind: 'payment', mobile: m }, { $set: { pay_later: [...(r.pay_later || []), entry], next_at: r.done_at ? r.next_at : next } });
}

// ── the job ───────────────────────────────────────────────────────────────────

async function log(db, row) {
  await db.collection(REMINDER_LOG_COLL).insertOne({ ...row, at: row.at || iso(Date.now()) });
}

async function deliver(sender, kind, mode, mobile, payload) {
  if (mode !== 'send') return { ok: true, dry: true };
  try {
    const res = payload.template
      ? await sender.sendTemplate(mobile, payload.template.name, payload.template.lang, payload.template.params, payload.template.headerImage)
      : await sender.sendText(mobile, payload.text);
    return { ok: true, message_id: res?.data?.messages?.[0]?.id || res?.messages?.[0]?.id || res?.data?.id || null };
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 300) };
  }
}

async function paymentTick(db, settings, sender, now) {
  const f = settings.features.payment_reminders;
  if (f.mode === 'off') return { checked: 0, sent: 0, dry: 0, failed: 0 };
  const since = f.since ? new Date(f.since).getTime() : Infinity;
  const coll = db.collection(REMINDERS_COLL);
  const docs = (await coll.find({ kind: 'payment' }).toArray())
    .filter((r) => !r.done_at && !r.stopped_at && r.next_at && new Date(r.next_at).getTime() <= now && new Date(r.registered_at).getTime() >= since);
  const out = { checked: docs.length, sent: 0, dry: 0, failed: 0 };
  for (const r of docs) {
    const user = await db.collection('tbl_user').findOne({ mobile_no: r.mobile });
    if (!user) { await coll.updateOne({ kind: 'payment', mobile: r.mobile }, { $set: { stopped_at: iso(now), stop_reason: 'no account' } }); continue; }
    if (user.paid_status === 'Yes') { await coll.updateOne({ kind: 'payment', mobile: r.mobile }, { $set: { done_at: iso(now), done_reason: 'paid' } }); continue; }
    if (await isOptedOut(db, r.mobile)) { await coll.updateOne({ kind: 'payment', mobile: r.mobile }, { $set: { stopped_at: iso(now), stop_reason: 'replied STOP' } }); continue; }
    if (await db.collection('tbl_utr_payments').findOne({ mobile_no: r.mobile, status: 'pending' })) continue; // proof waiting for approval
    const mode = modeFor(settings, 'payment_reminders', r.mobile);
    if (mode === 'off') continue;
    const n = (r.count || 0) + 1;
    const booths = (Array.isArray(user.booths) && user.booths.length) || Number(user.booth_count) || r.booth_count || 1;
    const t = settings.templates.payment;
    const headerImg = await resolveHeaderImg(db, 'payment_reminder_header');
    const tpl = { name: t.name, lang: r.lang === 'ta' ? t.ta : t.en, params: [firstName(user.first_name || r.name), String(booths), `${planFor(booths).price} + 18% GST`], headerImage: headerImg };
    const res = await deliver(sender, 'payment', mode, r.mobile, { template: tpl });
    await log(db, { kind: 'payment', mobile: r.mobile, step: n, of: PAYMENT_GAPS_H.length, template: tpl.name, lang: tpl.lang, mode, ...res, at: iso(now) });
    if (!res.ok) {
      out.failed++;
      const tries = (r.tries || 0) + 1;
      if (tries < MAX_TRIES) { await coll.updateOne({ kind: 'payment', mobile: r.mobile }, { $set: { tries, next_at: iso(now + RETRY_H * H), last_error: res.error } }); continue; }
      // gave up on this step: move on so one bad send does not block the rest
    }
    if (res.dry) out.dry++; else if (res.ok) out.sent++;
    const set = { count: n, last_sent_at: iso(now), tries: 0, last_error: res.ok ? '' : res.error };
    if (n >= PAYMENT_GAPS_H.length) Object.assign(set, { next_at: null, done_at: iso(now), done_reason: 'all reminders sent — call them' });
    else set.next_at = iso(now + PAYMENT_GAPS_H[n] * H);
    await coll.updateOne({ kind: 'payment', mobile: r.mobile }, { $set: set });
  }
  return out;
}

const NUDGE = {
  booth_numbers: ['You were one step away from finishing your EDMS registration. Reply with your booth numbers, separated by commas (e.g. 1, 5, 9), to finish now.',
    'உங்கள் EDMS பதிவு முடிய இன்னும் ஒரே படி உள்ளது. உங்கள் பூத் எண்களை கமா (,) மூலம் பிரித்து அனுப்பவும் (எ.கா. 1, 5, 9).'],
  other: ['You started registering with EDMS but did not finish. Send *Hi* to start again — it takes about a minute.',
    'நீங்கள் EDMS பதிவைத் தொடங்கினீர்கள், ஆனால் முடிக்கவில்லை. மீண்டும் தொடங்க *Hi* என அனுப்பவும் — ஒரு நிமிடம் மட்டுமே ஆகும்.'],
};

async function incompleteTick(db, settings, sender, now) {
  const f = settings.features.incomplete_reminders;
  if (f.mode === 'off') return { checked: 0, sent: 0, dry: 0, failed: 0 };
  const since = f.since ? new Date(f.since).getTime() : Infinity;
  const leads = (await db.collection('tbl_leads').find({}).toArray())
    .filter((l) => !l.registered_at && ['new', 'contacted'].includes(l.status || 'new') && new Date(l.first_seen).getTime() >= since);
  const coll = db.collection(REMINDERS_COLL);
  const states = new Map((await coll.find({ kind: 'incomplete' }).toArray()).map((s) => [s.mobile, s]));
  const out = { checked: leads.length, sent: 0, dry: 0, failed: 0 };
  for (const l of leads) {
    const m = ten(l.mobile);
    let st = states.get(m);
    if (st?.stopped_at || (st?.retry_at && new Date(st.retry_at).getTime() > now)) continue;
    const quietH = (now - new Date(l.last_seen).getTime()) / H;
    const wa = (l.sources || []).includes('whatsapp');
    const tcount = st?.templates || 0;
    let what = null;
    if (wa && quietH >= NUDGE_AFTER_H && quietH < 23.5 && st?.nudged_for !== l.last_seen) what = 'nudge';
    else if ((l.step_rank ?? 0) >= 1 && tcount === 0 && quietH >= INCOMPLETE_T1_AFTER_H) what = 'template';
    else if ((l.step_rank ?? 0) >= 1 && tcount === 1 && st?.last_template_at && now - new Date(st.last_template_at).getTime() >= INCOMPLETE_T2_AFTER_H * H) what = 'template';
    if (!what) continue;
    if (await isOptedOut(db, m)) { await upsertState(coll, m, st, { stopped_at: iso(now), stop_reason: 'replied STOP' }); continue; }
    const mode = modeFor(settings, 'incomplete_reminders', m);
    if (mode === 'off') continue;
    let payload; let lang = 'en';
    if (what === 'nudge') {
      const sess = await db.collection('tbl_wacto_sessions').findOne({ phone: `91${m}` });
      lang = sess?.lang === 'ta' ? 'ta' : sess?.lang === 'en' ? 'en' : 'both';
      const [en, ta] = NUDGE[l.step === 'booth_numbers' && sess?.awaiting_booth_numbers ? 'booth_numbers' : 'other'];
      payload = { text: lang === 'ta' ? ta : lang === 'en' ? en : `${en}\n\n${ta}` };
    } else {
      const sess = await db.collection('tbl_wacto_sessions').findOne({ phone: `91${m}` });
      lang = sess?.lang === 'ta' ? 'ta' : 'en';
      const t = settings.templates.incomplete;
      const headerImg = await resolveHeaderImg(db, 'incomplete_nudge_header');
      payload = { template: { name: t.name, lang: lang === 'ta' ? t.ta : t.en, params: [firstName(l.web_name || l.wa_name)], headerImage: headerImg } };
    }
    const res = await deliver(sender, 'incomplete', mode, m, payload);
    await log(db, { kind: 'incomplete', mobile: m, step: what === 'nudge' ? 'nudge' : tcount + 1, of: 2, template: payload.template?.name || '(free message)', lang, mode, ...res, at: iso(now) });
    if (!res.ok) { out.failed++; st = await upsertState(coll, m, st, { retry_at: iso(now + RETRY_H * H), last_error: res.error }); continue; }
    if (res.dry) out.dry++; else out.sent++;
    if (what === 'nudge') st = await upsertState(coll, m, st, { nudged_for: l.last_seen, nudge_at: iso(now), retry_at: null, last_error: '' });
    else st = await upsertState(coll, m, st, { templates: tcount + 1, last_template_at: iso(now), retry_at: null, last_error: '' });
    states.set(m, st);
  }
  return out;
}

async function upsertState(coll, mobile, st, set) {
  if (!st) {
    const row = { kind: 'incomplete', mobile, templates: 0, nudged_for: null, last_template_at: null, stopped_at: null, ...set };
    await coll.insertOne(row);
    return row;
  }
  await coll.updateOne({ kind: 'incomplete', mobile }, { $set: set });
  return { ...st, ...set };
}

// One pass of both jobs. `sender` = { sendTemplate(mobile, name, lang, params), sendText(mobile, text) }.
export async function runReminders(db, sender, now = Date.now()) {
  const settings = await getFeatureSettings(db, { fresh: true });
  const payment = await paymentTick(db, settings, sender, now);
  const incomplete = await incompleteTick(db, settings, sender, now);
  return { payment, incomplete };
}

// What the jobs will do next (admin page): upcoming payment reminders and incomplete-registration sends.
export async function upcoming(db, now = Date.now(), limit = 50) {
  const settings = await getFeatureSettings(db, { fresh: true });
  const rows = [];
  const pf = settings.features.payment_reminders;
  const pSince = pf.since ? new Date(pf.since).getTime() : Infinity;
  for (const r of await db.collection(REMINDERS_COLL).find({ kind: 'payment' }).toArray()) {
    if (r.done_at || r.stopped_at || !r.next_at || new Date(r.registered_at).getTime() < pSince) continue;
    rows.push({ kind: 'payment', mobile: r.mobile, name: r.name, step: (r.count || 0) + 1, of: PAYMENT_GAPS_H.length, due_at: r.next_at, mode: modeFor(settings, 'payment_reminders', r.mobile), pay_later: r.pay_later?.slice(-1)[0] || null });
  }
  return rows.sort((a, b) => String(a.due_at).localeCompare(b.due_at)).slice(0, limit);
}
