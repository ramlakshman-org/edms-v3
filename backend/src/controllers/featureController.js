// WhatsApp features admin (Ram, 2026-10-16) — the switches in services/features.js and what the reminder jobs did / will do.
//   GET  /whatsapp-features         Super Admin: switches, test numbers, template names, upcoming + recent reminders
//   PUT  /whatsapp-features         Super Admin: change switches / test numbers / template names
//   GET  /public/whatsapp-login     public: whether the website tells everyone "your login comes on WhatsApp"
//   POST /whatsapp-features/test-send   Super Admin: send one template NOW — only ever to a saved test number
//   GET  /whatsapp-features/templates   Super Admin: every template on the WACTO account with its Meta status (read only)
import { getAppDb } from '../config/db.js';
import { FEATURES, TEMPLATE_KEYS, getFeatureSettings, saveFeatureSettings } from '../services/features.js';
import { REMINDERS_COLL, REMINDER_LOG_COLL, OPTOUT_COLL, upcoming, templateFor } from '../services/reminders.js';
import { sendWactoTemplate, listWactoTemplates } from '../services/wactoService.js';

export async function get(req, res) {
  try {
    const db = getAppDb();
    const settings = await getFeatureSettings(db, { fresh: true });
    const log = await db.collection(REMINDER_LOG_COLL).find({}).sort({ at: -1 }).limit(100).toArray();
    const counts = {
      payment_active: await db.collection(REMINDERS_COLL).countDocuments({ kind: 'payment', done_at: null, stopped_at: null }),
      payment_done: await db.collection(REMINDERS_COLL).countDocuments({ kind: 'payment', done_at: { $ne: null } }),
      opted_out: await db.collection(OPTOUT_COLL).countDocuments({}),
    };
    res.json({ success: true, features: FEATURES, settings, counts, upcoming: await upcoming(db), log });
  } catch (e) {
    if (e.message === 'APP_DB_OFFLINE') return res.status(503).json({ success: false, message: 'App database unavailable.' });
    res.status(500).json({ success: false, message: e.message });
  }
}

export async function update(req, res) {
  try {
    const settings = await saveFeatureSettings(getAppDb(), req.body || {}, req.user?.name || req.user?.username || 'admin');
    res.json({ success: true, settings });
  } catch (e) {
    if (e.message === 'APP_DB_OFFLINE') return res.status(503).json({ success: false, message: 'App database unavailable.' });
    res.status(422).json({ success: false, message: e.message });
  }
}

// The message is filled in from that number's own account when it has one (name, booths, amount), else "there" / 1 booth.
// `send` is injectable for tests.
export async function testSend(req, res, send = sendWactoTemplate) {
  try {
    const db = getAppDb();
    const { template, lang = 'en', mobile } = req.body || {};
    const m = String(mobile || '').replace(/\D/g, '').slice(-10);
    const settings = await getFeatureSettings(db, { fresh: true });
    if (!TEMPLATE_KEYS.includes(template)) return res.status(422).json({ success: false, message: 'Choose a template.' });
    if (!['en', 'ta'].includes(lang)) return res.status(422).json({ success: false, message: 'Choose English or Tamil.' });
    if (!settings.test_numbers.includes(m)) return res.status(403).json({ success: false, message: 'Test messages go only to a saved test number. Add the number under Test numbers and save first.' });
    const user = await db.collection('tbl_user').findOne({ mobile_no: m });
    // no account yet (an incomplete registration): use the name they gave — WhatsApp or website — like the reminder job
    const lead = user ? null : await db.collection('tbl_leads').findOne({ mobile: m });
    const tpl = templateFor(settings, template, lang, user, lead?.web_name || lead?.wa_name || 'there');
    const at = new Date().toISOString();
    try {
      const r = await send({ mobile: m, templateName: tpl.name, language: tpl.lang, bodyParams: tpl.params });
      await db.collection(REMINDER_LOG_COLL).insertOne({ kind: 'test', mobile: m, step: template, template: tpl.name, lang: tpl.lang, mode: 'send', ok: true, message_id: r?.data?.messages?.[0]?.id || r?.messages?.[0]?.id || null, at, by: req.user?.name || 'admin' });
      res.json({ success: true, message: `Sent "${tpl.name}" (${tpl.lang}) to ******${m.slice(-4)}.`, params: tpl.params });
    } catch (e) {
      const error = String(e.message || e).slice(0, 300);
      await db.collection(REMINDER_LOG_COLL).insertOne({ kind: 'test', mobile: m, step: template, template: tpl.name, lang: tpl.lang, mode: 'send', ok: false, error, at, by: req.user?.name || 'admin' });
      res.status(502).json({ success: false, message: `Not sent: ${error}`, params: tpl.params });
    }
  } catch (e) {
    if (e.message === 'APP_DB_OFFLINE') return res.status(503).json({ success: false, message: 'App database unavailable.' });
    res.status(500).json({ success: false, message: e.message });
  }
}

export async function templates(req, res, list = listWactoTemplates) {
  try {
    res.json({ success: true, templates: await list() });
  } catch (e) {
    res.status(502).json({ success: false, message: String(e.message || e).slice(0, 300), templates: [] });
  }
}

export async function publicWebsiteLogin(req, res) {
  try {
    const s = await getFeatureSettings(getAppDb());
    res.json({ success: true, all: s.features.website_login.mode === 'all' });
  } catch {
    res.json({ success: true, all: false });
  }
}
