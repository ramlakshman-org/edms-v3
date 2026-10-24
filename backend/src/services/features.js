// WhatsApp feature switches (Ram, 2026-10-16). Every new WhatsApp feature goes live switched OFF and is turned on from
// the admin "WhatsApp features" page, one step at a time: off → test (only the test numbers) → all. The two reminder
// jobs also have "dry": they plan and record what they WOULD send and send nothing. One document in tbl_feature_flags,
// cached for 30 s. Only findOne / updateOne($set, upsert) are used, so the offline bot harness's fake DB runs this too.
export const FLAGS_COLL = 'tbl_feature_flags';
const DOC_ID = 'whatsapp';

export const FEATURES = {
  pay_buttons:          { label: 'Pay Now / Pay Later buttons', modes: ['off', 'test', 'all'] },
  stop_optout:          { label: 'Reply STOP to stop reminders', modes: ['off', 'test', 'all'] },
  website_login:        { label: 'Website login sent on WhatsApp', modes: ['off', 'test', 'all'] },
  payment_reminders:    { label: 'Payment reminders (5)', modes: ['off', 'dry', 'test', 'all'] },
  incomplete_reminders: { label: 'Complete-your-registration reminders', modes: ['off', 'dry', 'test', 'all'] },
};

// Template names and languages as they will be created in WACTO (editable on the admin page once Meta approves them)
export const DEFAULT_TEMPLATES = {
  payment:    { name: 'edms_payment_reminder',      en: 'en', ta: 'ta' },
  incomplete: { name: 'edms_complete_registration', en: 'en', ta: 'ta' },
  activated:  { name: 'edms_account_activated',     en: 'en', ta: 'ta' },
};
export const TEMPLATE_KEYS = Object.keys(DEFAULT_TEMPLATES);

const DEFAULTS = () => ({
  features: Object.fromEntries(Object.keys(FEATURES).map((k) => [k, { mode: 'off', since: null }])),
  test_numbers: [],
  templates: structuredClone(DEFAULT_TEMPLATES),
});

let cache = null;
let cacheAt = 0;
const TTL_MS = 30 * 1000;
const ten = (m) => String(m || '').replace(/\D/g, '').slice(-10);

export async function getFeatureSettings(db, { fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cacheAt < TTL_MS) return cache;
  let doc = null;
  try { doc = await db.collection(FLAGS_COLL).findOne({ _id: DOC_ID }); } catch { /* DB offline: everything stays off */ }
  const d = DEFAULTS();
  const s = {
    features: Object.fromEntries(Object.keys(FEATURES).map((k) => [k, { ...d.features[k], ...(doc?.features?.[k] || {}) }])),
    test_numbers: Array.isArray(doc?.test_numbers) ? doc.test_numbers.map(ten).filter((m) => m.length === 10) : [],
    templates: Object.fromEntries(TEMPLATE_KEYS.map((k) => [k, { ...d.templates[k], ...(doc?.templates?.[k] || {}) }])),
    updated_at: doc?.updated_at || null,
    updated_by: doc?.updated_by || '',
  };
  for (const [k, f] of Object.entries(s.features)) if (!FEATURES[k].modes.includes(f.mode)) f.mode = 'off';
  cache = s; cacheAt = Date.now();
  return s;
}

// What this feature does for this number right now: 'send' (really send), 'dry' (record only) or 'off'.
// "test" sends only to the test numbers; for every other number a reminder feature behaves as a dry run.
export function modeFor(settings, key, mobile) {
  const f = settings?.features?.[key];
  if (!f || f.mode === 'off') return 'off';
  if (f.mode === 'all') return 'send';
  if (f.mode === 'dry') return 'dry';
  const isTest = settings.test_numbers.includes(ten(mobile));
  if (isTest) return 'send';
  return FEATURES[key].modes.includes('dry') ? 'dry' : 'off';
}
export const isOnFor = (settings, key, mobile) => modeFor(settings, key, mobile) === 'send';

// Admin save. A reminder feature's `since` is set the first time it leaves "off": only registrations / contacts from
// that moment are reminded automatically (older ones are sent by hand from the admin), so switching on never floods.
export async function saveFeatureSettings(db, patch, by = 'admin') {
  const cur = await getFeatureSettings(db, { fresh: true });
  const next = structuredClone({ features: cur.features, test_numbers: cur.test_numbers, templates: cur.templates });
  const now = new Date().toISOString();
  for (const [k, v] of Object.entries(patch?.features || {})) {
    if (!FEATURES[k]) throw new Error(`Unknown feature ${k}.`);
    const mode = String(v?.mode || '');
    if (!FEATURES[k].modes.includes(mode)) throw new Error(`${FEATURES[k].label}: "${mode}" is not a valid setting.`);
    if (next.features[k].mode === 'off' && mode !== 'off' && !next.features[k].since) next.features[k].since = now;
    next.features[k].mode = mode;
  }
  if (Array.isArray(patch?.test_numbers)) {
    const nums = [...new Set(patch.test_numbers.map(ten))];
    if (nums.some((m) => !/^[6-9]\d{9}$/.test(m))) throw new Error('Test numbers must be 10-digit mobile numbers.');
    if (nums.length > 5) throw new Error('At most 5 test numbers.');
    next.test_numbers = nums;
  }
  for (const key of TEMPLATE_KEYS) {
    const t = patch?.templates?.[key];
    if (!t) continue;
    for (const f of ['name', 'en', 'ta']) {
      if (t[f] == null) continue;
      const v = String(t[f]).trim();
      if (!/^[a-z0-9_]{1,512}$/.test(f === 'name' ? v : v.replace(/-/g, '_').toLowerCase())) throw new Error(`Template ${f} "${v}" is not valid.`);
      next.templates[key][f] = v;
    }
  }
  await db.collection(FLAGS_COLL).updateOne({ _id: DOC_ID }, { $set: { ...next, updated_at: now, updated_by: by } }, { upsert: true });
  cache = null;
  return getFeatureSettings(db, { fresh: true });
}

export function clearFeatureCache() { cache = null; }

// The ready message a website visitor sends to the bot to get their login (handled in wactoWebhookController.js)
export const WEBSITE_LOGIN_TEXT = { en: 'Send my EDMS login', ta: 'எனது EDMS உள்நுழைவு' };
export const BOT_NUMBER = () => String(process.env.WACTO_CHANNEL || '917904759268').replace(/\D/g, '');
