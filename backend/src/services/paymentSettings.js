import { getAppDb } from '../config/db.js';

// One payment setup for every channel (website purchase modal, WhatsApp bot,
// admin Payments page). Stored in app_settings as { key: 'payment', ... } and
// edited from the admin "Payment setup" page. Defaults below are the values
// that were hard-coded in 4 places before 2026-10-11.
const COLL = 'app_settings';
const KEY = 'payment';
const CACHE_MS = 60 * 1000;

export const DEFAULT_PAYMENT_SETTINGS = {
  upi_id: 'senthilsky2301@okaxis',
  payee_name: 'senthilkumar nagendren',
  qr_url: 'https://res.cloudinary.com/ajp3dslc/image/upload/v1791377127/payment-qr.jpg',
  qr_public_id: '',
  // Where the candidate sends the payment screenshot:
  //   'chat'   -> in the same WhatsApp chat (the bot records it)  ← default
  //   'number' -> to a separate WhatsApp number (manual check)
  proof_mode: 'chat',
  proof_number: '917092800426',
  // The bot's own WhatsApp number (shown on the website as "send it on WhatsApp").
  bot_number: '917904759268',
  support_phone: '+91 79047 59268',
  activation_minutes: 30,
  gst_rate: 18,
  // Booth-count tiers (base price before GST). Read-only in the admin for now:
  // the website, bot and Razorpay paths all compute from these same numbers.
  tiers: [
    { max_booths: 1, base: 2000, label: '1 booth' },
    { max_booths: 5, base: 5000, label: '2–5 booths' },
    { max_booths: 10, base: 10000, label: '6–10 booths' },
    { max_booths: 25, base: 25000, label: '11–25 booths' },
    { max_booths: 100, base: 50000, label: '26–100 booths' },
  ],
};

// Fields the admin may change (everything except tiers / gst, which stay in code).
export const EDITABLE_SETTING_KEYS = ['upi_id', 'payee_name', 'qr_url', 'qr_public_id', 'proof_mode', 'proof_number', 'bot_number', 'support_phone', 'activation_minutes'];

let cache = { at: 0, value: null };

export function clearPaymentSettingsCache() { cache = { at: 0, value: null }; }

// Merge stored overrides over the defaults. Never throws: with the DB offline
// the defaults (today's live values) are returned so the bot keeps answering.
export async function getPaymentSettings(db) {
  if (cache.value && Date.now() - cache.at < CACHE_MS) return cache.value;
  let stored = null;
  try {
    stored = await (db || getAppDb()).collection(COLL).findOne({ key: KEY });
  } catch { /* offline → defaults */ }
  const value = { ...DEFAULT_PAYMENT_SETTINGS };
  for (const k of EDITABLE_SETTING_KEYS) if (stored && stored[k] !== undefined && stored[k] !== null && stored[k] !== '') value[k] = stored[k];
  value.activation_minutes = Math.max(5, parseInt(value.activation_minutes, 10) || 30);
  value.proof_mode = value.proof_mode === 'number' ? 'number' : 'chat';
  value.updated_at = stored?.updated_at || null;
  value.updated_by = stored?.updated_by || null;
  cache = { at: Date.now(), value };
  return value;
}

export async function savePaymentSettings(db, patch, updatedBy = '') {
  const set = { key: KEY, updated_at: new Date().toISOString(), updated_by: updatedBy || '' };
  for (const k of EDITABLE_SETTING_KEYS) if (patch[k] !== undefined) set[k] = typeof patch[k] === 'string' ? patch[k].trim() : patch[k];
  if (set.upi_id !== undefined && !/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(set.upi_id)) throw new Error('UPI ID must look like name@bank.');
  if (set.proof_number !== undefined) set.proof_number = String(set.proof_number).replace(/\D/g, '');
  if (set.bot_number !== undefined) set.bot_number = String(set.bot_number).replace(/\D/g, '');
  if (set.proof_mode !== undefined && !['chat', 'number'].includes(set.proof_mode)) throw new Error('proof_mode must be chat or number.');
  await (db || getAppDb()).collection(COLL).updateOne({ key: KEY }, { $set: set }, { upsert: true });
  clearPaymentSettingsCache();
  return getPaymentSettings(db);
}

// Tier price for a booth count. Same numbers as calculateWardPricing.
export function priceFor(boothCount, settings = DEFAULT_PAYMENT_SETTINGS) {
  const n = Math.max(1, parseInt(boothCount, 10) || 1);
  const tiers = settings.tiers || DEFAULT_PAYMENT_SETTINGS.tiers;
  const tier = tiers.find((t) => n <= t.max_booths) || tiers[tiers.length - 1];
  const rate = Number(settings.gst_rate ?? 18);
  const gst = Math.round(tier.base * rate / 100);
  return { boothCount: n, base: tier.base, gst, total: tier.base + gst, label: tier.label, gstRate: rate };
}

export const inr = (n) => Number(n || 0).toLocaleString('en-IN');

// wa.me link for a stored number (digits only, 91 prefix added for 10-digit numbers).
export const waMe = (num) => { const d = String(num || '').replace(/\D/g, ''); return `wa.me/${d.length === 10 ? `91${d}` : d}`; };
