import { getAppDb } from '../config/db.js';
import { BOT_TEXTS, BOT_IMAGES } from '../constants/botContent.js';

// Texts and images the WACTO bot sends. Defaults live in constants/botContent.js;
// the admin "Bot Messages & Media" page stores overrides in
//   app_flow_messages { key: 'bot_<key>_<en|ta>', text }
//   app_flow_images   { key: 'bot_img_<key>', url, public_id }
// loadBotContent() refreshes a 60 s cache at the start of each webhook; botText()
// and botImage() are then synchronous so the controller stays simple.
const MSG_COLL = 'app_flow_messages';
const IMG_COLL = 'app_flow_images';
const CACHE_MS = 60 * 1000;

let cache = { at: 0, texts: {}, images: {} };

export function clearBotContentCache() { cache = { at: 0, texts: {}, images: {} }; }

export async function loadBotContent(db, force = false) {
  if (!force && Date.now() - cache.at < CACHE_MS) return cache;
  const texts = {}; const images = {};
  try {
    const d = db || getAppDb();
    for (const doc of await d.collection(MSG_COLL).find({ key: /^bot_/ }).toArray()) if (doc.key && typeof doc.text === 'string' && doc.text.trim()) texts[doc.key] = doc.text;
    for (const doc of await d.collection(IMG_COLL).find({ key: /^bot_img_/ }).toArray()) if (doc.key && doc.url) images[doc.key] = doc.url;
  } catch { /* DB offline → defaults (today's wording) */ }
  cache = { at: Date.now(), texts, images };
  return cache;
}

// Fill {var} placeholders; unknown ones are left as they are.
export const renderTemplate = (tpl, vars = {}) => String(tpl ?? '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])));

export function botText(key, lang = 'en', vars = {}) {
  const def = BOT_TEXTS[key];
  if (!def) { console.warn(`[botContent] unknown text key ${key}`); return ''; }
  const l = lang === 'ta' ? 'ta' : 'en';
  const tpl = cache.texts[`bot_${key}_${l}`] ?? def[l] ?? def.en;
  return renderTemplate(tpl, vars);
}

export function botImage(key) {
  return cache.images[`bot_img_${key}`] || BOT_IMAGES[key]?.url || '';
}

// For the admin page: every text with its default, current value and metadata.
export function botCatalog() {
  const texts = Object.entries(BOT_TEXTS).map(([key, d]) => ({
    key, group: d.group, name: d.name, when: d.when, vars: d.vars || [], image: d.image || null,
    max: d.image ? 1024 : 4096,
    default_en: d.en, default_ta: d.ta,
    en: cache.texts[`bot_${key}_en`] ?? d.en, ta: cache.texts[`bot_${key}_ta`] ?? d.ta,
    custom_en: cache.texts[`bot_${key}_en`] !== undefined, custom_ta: cache.texts[`bot_${key}_ta`] !== undefined,
  }));
  const images = Object.entries(BOT_IMAGES).map(([key, d]) => ({
    key, asset_key: `bot_img_${key}`, name: d.name, when: d.when, default_url: d.url,
    url: cache.images[`bot_img_${key}`] || d.url, custom: !!cache.images[`bot_img_${key}`],
  }));
  return { texts, images };
}
