import { getAppDb, isAppDbOnline } from '../config/db.js';
import { sendSms, sendVoice, sendWhatsAppText, smsConfigured, whatsappConfigured } from '../services/gateways.js';

// Best-effort audit log to tbl_sms_report (mirrors original). Never blocks the send.
async function logReport(doc) {
  if (!isAppDbOnline()) return;
  try { await getAppDb().collection('tbl_sms_report').insertOne({ ...doc, created_at: new Date().toISOString() }); } catch { /* ignore */ }
}

// ---- SMS (Obligr) — mirrors SmsController@sendTextsms ----
export async function sendSmsText(req, res) {
  const { message, mobiles, senderId, assembly_id, booth_id } = req.body || {};
  if (!message || !mobiles) return res.status(400).json({ success: false, message: 'message and mobiles are required.' });
  if (!smsConfigured()) {
    return res.status(501).json({ success: false, message: 'SMS gateway not configured. Set OBLIGR_TOKEN (and optional OBLIGR_SENDER_ID) in .env.' });
  }
  try {
    const out = await sendSms({ message, mobiles, senderId });
    const count = String(mobiles).split(',').filter(Boolean).length;
    await logReport({ message, message_type: 'Text', sender_id: senderId, assembly_id, booth_id, total_number: count });
    res.json({ success: out.ok, result: out.result });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
}

// ---- Voice (Obligr) — mirrors SmsController@sendAudioSms ----
export async function sendVoiceCall(req, res) {
  const { callerId, audioUrl, mobiles, assembly_id, booth_id } = req.body || {};
  if (!callerId || !audioUrl || !mobiles) return res.status(400).json({ success: false, message: 'callerId, audioUrl and mobiles are required.' });
  if (!smsConfigured()) {
    return res.status(501).json({ success: false, message: 'Voice gateway not configured. Set OBLIGR_TOKEN in .env.' });
  }
  try {
    const out = await sendVoice({ callerId, audioUrl, mobiles });
    const count = String(mobiles).split(',').filter(Boolean).length;
    await logReport({ message_type: 'Audio', caller_id: callerId, audio_file_name: audioUrl, assembly_id, booth_id, total_number: count });
    res.json({ success: out.ok, result: out.result });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
}

// ---- WhatsApp (Meta Graph) — mirrors WhatsAppService::sendText ----
export async function sendWhatsapp(req, res) {
  const { to, text } = req.body || {};
  if (!to || !text) return res.status(400).json({ success: false, message: 'to and text are required.' });
  if (!whatsappConfigured()) {
    return res.status(501).json({ success: false, message: 'WhatsApp not configured. Set META_ACCESS_TOKEN and META_PHONE_NUMBER_ID in .env.' });
  }
  try {
    const out = await sendWhatsAppText({ to, text });
    await logReport({ message: text, message_type: 'WhatsApp', to });
    res.json({ success: out.ok, result: out.result });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
}

// ---- Message history (tbl_sms_report) ----
export async function reports(req, res) {
  try {
    const db = getAppDb();
    const q = {};
    if (req.query.type) q.message_type = req.query.type;
    const rows = await db.collection('tbl_sms_report').find(q).sort({ created_at: -1 }).limit(500).toArray();
    res.json({ success: true, rows });
  } catch (e) {
    if (e.message === 'APP_DB_OFFLINE') return res.status(503).json({ success: false, message: 'App database unavailable.' });
    res.status(500).json({ success: false, message: e.message });
  }
}

// Gateway configuration status (for the UI to show what's enabled).
export function status(req, res) {
  res.json({ success: true, sms: smsConfigured(), voice: smsConfigured(), whatsapp: whatsappConfigured() });
}
