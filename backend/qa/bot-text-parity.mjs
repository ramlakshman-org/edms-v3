// Switch rehearsal (EDMS-2, 2026-10-14): the live bot handler has its English/Tamil texts inline; the branch reads the
// same texts from constants/botContent.js (admin-editable). This renders both with the same sample values and
// compares them character by character, so the switch cannot quietly change what the bot says.
// Usage: node qa/bot-text-parity.mjs <path to the LIVE wactoWebhookController.js>
import fs from 'fs';
import { BOT_TEXTS, BOT_IMAGES } from '../src/constants/botContent.js';
import { botText, botImage } from '../src/services/botContent.js';

const livePath = process.argv[2];
if (!livePath) { console.error('usage: node qa/bot-text-parity.mjs <live wactoWebhookController.js>'); process.exit(2); }
const live = fs.readFileSync(livePath, 'utf8').replace(/\r/g, '');

// sample values for every variable either side uses
const S = { mobile: '9800003061', passcode: '482915', name: 'Selvi', fullName: 'Selvi', assembly: 'Oddanchatram', step: 'Assembly', en: 'Assembly', ta: 'Assembly', service: 'SMS', plan: '1 Booth Plan', price: '₹2,000' };
const ctx = {
  ...S, user: { password_str: S.passcode, first_name: S.name }, existing: { password_str: S.passcode, first_name: S.name },
  session: { assembly: S.assembly, booth_count: 3, social_service: S.service, purchase_plan: S.plan, purchase_price: S.price, lang: 'en' },
  plan: { name: S.plan, price: S.price }, planTA: S.plan,
};

// every msg(session, `EN`, `TA`) call in the live file, in order, with its line number
const calls = [];
const re = /msg\(session,\s*\n?\s*(`(?:\\`|[^`])*`|'(?:\\'|[^'])*')\s*,\s*\n?\s*(`(?:\\`|[^`])*`|'(?:\\'|[^'])*')\s*\n?\s*\)/g;
for (let m; (m = re.exec(live));) calls.push({ line: live.slice(0, m.index).split('\n').length, en: m[1], ta: m[2] });
const render = (lit) => {
  const body = lit.startsWith('`') ? lit : '`' + lit.slice(1, -1).replace(/`/g, '\\`') + '`';
  return new Function('ctx', `with (ctx) { return ${body}; }`)(ctx);
};

// pairing by place in the handler (from the diff of 2026-10-14); null = replaced on purpose by the payment work
const PAIRS = [
  ['reg_step_locked', { step: S.step }], ['reg_next_step', { step: S.step }], ['reg_already_registered', {}],
  ['menu_credentials', { mobile: S.mobile, passcode: S.passcode }], ['menu_no_account', { mobile: S.mobile }],
  ['menu_support_intro', {}], ['menu_purchase_plans', {}], ['menu_social_intro', {}],
  ['reg_complete', { name: S.name, mobile: S.mobile, passcode: S.passcode }],
  [null, 'payment message after registration → now the admin Payment setup message with the QR'],
  ['reg_failed', {}], ['support_ask_name', {}], ['support_done', {}], ['purchase_invalid', {}],
  ['purchase_booth_ask', { plan: S.plan, price: S.price }],
  [null, 'purchase interest message → now the QR + amount + register-first steps'],
  ['social_invalid', {}], ['social_name_ask', { service: S.service }], ['social_message_ask', {}], ['social_area_ask', {}],
  ['social_done', { service: S.service }],
  ['reg_booth_invalid', { assembly: S.assembly }], ['reg_welcome_back', { name: S.name, mobile: S.mobile, passcode: S.passcode }],
  ['reg_booth_ask', { assembly: S.assembly }],
];

const norm = (s) => String(s).replace(/\s+$/gm, '').trim();
let same = 0, differ = 0, replaced = 0;
const report = [];
console.log(`live msg() calls found: ${calls.length}; pairs expected: ${PAIRS.length}`);
calls.forEach((c, i) => {
  const [key, vars] = PAIRS[i] || ['?', {}];
  if (key === null) { replaced++; report.push(`line ${c.line}: replaced on purpose — ${vars}`); return; }
  if (!BOT_TEXTS[key]) { differ++; report.push(`line ${c.line}: no branch key ${key}`); return; }
  for (const lang of ['en', 'ta']) {
    ctx.session.lang = lang;
    let liveText; try { liveText = norm(render(c[lang])); } catch (e) { differ++; report.push(`line ${c.line} ${key}.${lang}: live text did not render (${e.message})`); continue; }
    const branchText = norm(botText(key, lang, vars));
    if (liveText === branchText) same++;
    else {
      differ++;
      let k = 0; while (k < liveText.length && liveText[k] === branchText[k]) k++;
      report.push(`line ${c.line} ${key}.${lang}: DIFFERS at char ${k}\n    live:   …${JSON.stringify(liveText.slice(Math.max(0, k - 30), k + 60))}\n    branch: …${JSON.stringify(branchText.slice(Math.max(0, k - 30), k + 60))}`);
    }
  }
});

// images: live IMG constants vs branch defaults
const imgBlock = (live.match(/const IMG = \{([\s\S]*?)\n\};/) || [])[1] || '';
const IMG = Object.fromEntries([...imgBlock.matchAll(/(\w+):\s*'([^']+)'/g)].map((m) => [m[1], m[2]]));
const IMG_KEYS = { demo: 'demo', benefits: 'benefits', support: 'support', social: 'social', registrationComplete: 'registration_complete', brand: 'brand', plans: 'plans', faq: 'faq', credentials: 'credentials' };
let imgSame = 0; const imgDiff = [];
for (const [liveKey, branchKey] of Object.entries(IMG_KEYS)) {
  const liveCode = live.replace(/const IMG = \{[\s\S]*?\n\};/, '');
  if (!IMG[liveKey] || !new RegExp(`IMG\\.${liveKey}\\b`).test(liveCode)) continue; // defined but never sent on live
  const b = botImage(branchKey) || BOT_IMAGES[branchKey]?.url;
  if (b === IMG[liveKey]) imgSame++; else imgDiff.push(`${liveKey}: live ${IMG[liveKey]} | branch ${b || '(none)'}`);
}

console.log(report.join('\n'));
console.log(`\ntexts: ${same} identical (EN+TA counted separately), ${differ} different, ${replaced} replaced on purpose`);
console.log(`images: ${imgSame} identical${imgDiff.length ? `, ${imgDiff.length} different:\n  ${imgDiff.join('\n  ')}` : ''}`);
process.exit(differ || imgDiff.length ? 1 : 0);
