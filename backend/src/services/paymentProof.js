import * as cloudinary from './cloudinaryService.js';
import { getPaymentSettings, priceFor, inr, waMe, DEFAULT_PAYMENT_SETTINGS } from './paymentSettings.js';
import { botText } from './botContent.js';

// Payment proof = a UPI screenshot (and/or UTR) a candidate sends after paying
// the static QR. One queue for both channels (website upload, WhatsApp image to
// the bot), stored in tbl_utr_payments and verified on the admin Payments page.
export const PROOF_COLL = 'tbl_utr_payments';
const ATTACH_WINDOW_MS = 6 * 60 * 60 * 1000; // a 2nd screenshot within 6 h joins the same pending proof

export const extractUtr = (text) => (String(text || '').match(/\b\d{12}\b/) || [''])[0];

// ── Incoming WhatsApp media ──────────────────────────────────────────────────
// WACTO relays Meta Cloud API webhooks. An image message carries
// { image: { id, mime_type, sha256, caption } } and sometimes a direct link.
// Order tried: direct link in the payload → WACTO_MEDIA_URL template with the
// media id ("{id}" / "{channel}" placeholders, Bearer WACTO_API_KEY) → give up
// (the proof is still recorded with the media id so the admin can find it in
// the WACTO inbox).
export function mediaOf(msg) {
  const kind = msg?.type;
  if (!['image', 'document'].includes(kind)) return null;
  const obj = msg[kind] || {};
  const mime = obj.mime_type || obj.mimeType || (kind === 'image' ? 'image/jpeg' : '');
  if (kind === 'document' && !/image\/|pdf/.test(mime)) return null;
  return { kind, id: obj.id || obj.media_id || '', link: obj.link || obj.url || '', mime, caption: obj.caption || '', filename: obj.filename || '' };
}

export async function fetchIncomingMedia(media, fetchImpl = globalThis.fetch) {
  const headers = {};
  let url = media.link;
  if (!url && media.id && process.env.WACTO_MEDIA_URL) {
    url = process.env.WACTO_MEDIA_URL.replace('{id}', encodeURIComponent(media.id)).replace('{channel}', process.env.WACTO_CHANNEL || '');
    if (process.env.WACTO_API_KEY) headers.Authorization = `Bearer ${process.env.WACTO_API_KEY}`;
  }
  if (!url) return null;
  const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`media download failed: HTTP ${res.status}`);
  const ct = res.headers?.get?.('content-type') || '';
  // Some gateways answer the media id with JSON { url } instead of bytes.
  if (ct.includes('application/json')) {
    const j = await res.json();
    const real = j.url || j.link || j.data?.url;
    if (!real) throw new Error('media lookup returned no url');
    return fetchIncomingMedia({ ...media, link: real }, fetchImpl);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error('empty media body');
  return { buffer, mime: ct.split(';')[0] || media.mime };
}

export async function storeScreenshot(buffer, mime, mobile) {
  const ext = (String(mime || 'image/jpeg').split('/')[1] || 'jpg').split(';')[0];
  const up = await cloudinary.upload(buffer, `proof_${mobile}_${Date.now()}.${ext}`, mime.includes('pdf') ? 'auto' : 'image', 'payment-proofs');
  return { url: up.url, public_id: up.public_id };
}

// ── Queue ───────────────────────────────────────────────────────────────────
export const boothCountOf = (user) => (Array.isArray(user?.booths) && user.booths.length) || Number(user?.booth_count) || 1;

// Insert a pending proof, or attach to the candidate's recent pending one.
// Returns { outcome: 'created'|'attached'|'duplicate', doc }.
export async function recordProof(db, { user, mobile, source, utr = '', screenshot = null, wa_media_id = '', caption = '', contact_name = '', amount_claimed = null }) {
  const settings = await getPaymentSettings(db);
  const coll = db.collection(PROOF_COLL);
  const now = new Date().toISOString();
  const booth_count = boothCountOf(user);
  const price = priceFor(booth_count, settings);
  utr = String(utr || '').trim();

  if (utr) {
    const dup = await coll.findOne({ utr });
    if (dup && String(dup.mobile_no) !== String(mobile)) return { outcome: 'duplicate', doc: dup };
  }

  const shot = screenshot ? { url: screenshot.url, public_id: screenshot.public_id || '', wa_media_id, source, received_at: now } : (wa_media_id ? { url: '', public_id: '', wa_media_id, source, received_at: now } : null);

  const existing = await coll.findOne({ mobile_no: String(mobile), status: 'pending' });
  if (existing && Date.now() - new Date(existing.submitted_at || 0).getTime() < ATTACH_WINDOW_MS) {
    const screenshots = [...(existing.screenshots || []), ...(shot ? [shot] : [])];
    const set = { screenshots, updated_at: now };
    if (shot?.url && !existing.screenshot_url) set.screenshot_url = shot.url;
    if (utr && !existing.utr) set.utr = utr;
    if (caption && !existing.caption) set.caption = caption;
    await coll.updateOne({ _id: existing._id }, { $set: set });
    return { outcome: 'attached', doc: { ...existing, ...set } };
  }

  const doc = {
    utr,
    user_id: user?._id ? String(user._id) : null,
    user_name: [user?.first_name, user?.last_name].filter(Boolean).join(' ') || contact_name || 'Candidate',
    mobile_no: String(mobile),
    district_id: user?.district_id || '',
    category_name: user?.category_name || '',
    ward_id: user?.ward_id || '',
    candidate_type: user?.candidate_type || '',
    position: user?.position || '',
    assembly_id: user?.assembly_id || user?.assembly_no || '',
    booth_count,
    amount: amount_claimed != null ? Number(amount_claimed) : price.total,
    expected_amount: price.total,
    tier_label: price.label,
    source,                      // 'whatsapp' | 'website'
    screenshot_url: shot?.url || '',
    screenshots: shot ? [shot] : [],
    wa_media_id,
    caption,
    status: 'pending',
    submitted_at: now,
    updated_at: now,
  };
  const r = await coll.insertOne(doc);
  return { outcome: 'created', doc: { ...doc, _id: r.insertedId } };
}

// ── Bot copy (EN / TA) — wording comes from the bot content catalogue (admin-editable),
// channel-specific values from the payment settings.
function proofLine(settings, lang) {
  return settings.proof_mode === 'number'
    ? botText('pay_proof_number', lang, { wa_link: waMe(settings.proof_number) })
    : botText('pay_proof_chat', lang);
}

// Caption under the QR image (after registration and on "pay").
export function paymentMessage(settings = DEFAULT_PAYMENT_SETTINGS, lang = 'en', { assembly = '', boothCount = 1, title } = {}) {
  const p = priceFor(boothCount, settings);
  return botText('pay_qr', lang, {
    title: title || botText('pay_qr_title', lang),
    assembly_line: assembly ? botText('pay_qr_assembly_line', lang, { assembly }) : '',
    booths: boothCount, base: inr(p.base), gst_rate: p.gstRate, total: inr(p.total),
    upi_id: settings.upi_id, payee_name: settings.payee_name,
    proof_line: proofLine(settings, lang), minutes: settings.activation_minutes,
  });
}

export function proofReceivedMessage(settings, lang, { boothCount = 1, outcome = 'created', utr = '' } = {}) {
  const p = priceFor(boothCount, settings);
  return botText(outcome === 'attached' ? 'proof_received_more' : 'proof_received', lang, {
    booths: boothCount, total: inr(p.total), utr_line: utr ? `\nUTR: \`${utr}\`` : '',
    minutes: settings.activation_minutes, support_phone: settings.support_phone,
  });
}

export const proofUnknownUserMessage = (lang) => botText('proof_unknown', lang);
export const proofAlreadyPaidMessage = (lang) => botText('proof_already_paid', lang);

export function proofApprovedMessage(settings, lang, { name = '', boothCount = 1, amount = 0, mobile = '' } = {}) {
  return botText('proof_approved', lang, { name_prefix: name ? `${name}, ` : '', booths: boothCount, amount: inr(amount), mobile });
}

export function proofRejectedMessage(settings, lang, { reason = '' } = {}) {
  const reason_line = reason ? `\n\n${lang === 'ta' ? 'காரணம்' : 'Reason'}: ${reason}` : '';
  return botText('proof_rejected', lang, { reason_line, support_phone: settings.support_phone });
}
