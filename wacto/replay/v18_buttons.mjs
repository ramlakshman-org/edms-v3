// Flow v18: every menu option ends with 3 buttons (2 related screens + Main menu) and My Credentials gets a
// WACTO "next" message. All titles are existing menu labels, so the backend must answer each tap exactly as it
// does from the menu: WACTO-only screens -> backend silent; Support / Purchase Plan / Social Media -> backend
// follow-up (dual); My Credentials -> login (registered) or "no account" (new). Synthetic data only.
// Usage: node v18_buttons.mjs src/controllers/<current|before>.js   (run setup.mjs first)
import { pathToFileURL } from 'node:url';

process.env.WACTO_FOLLOWUP_DELAY_MS = '0';
const H = (globalThis.__H ||= { cols: {}, sent: [], failCaption: false });
const ctrl = await import(pathToFileURL(process.argv[2]).href);

const PH = '919000000006', MOB = '9000000006';
const B = (t) => ({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'x', title: t } } });
const L = (t) => ({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'x', title: t } } });
let fails = 0;
const check = (ok, what) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
async function tap(step) {
  const before = H.sent.length;
  await ctrl.handleWactoWebhook({ body: { entry: [{ changes: [{ value: { messages: [{ from: PH, ...step }], contacts: [{ profile: { name: 'Sim' } }] } }] }] } }, { sendStatus() {} });
  return H.sent.slice(before);
}
const REGISTERED = { tbl_user: [{ _id: 'u6', mobile_no: MOB, first_name: 'Sim', password_str: '654321' }] };
function reset(cols = {}) { Object.assign(H, { cols: { tbl_assembly_consitituency: [{ assembly_name: 'Sankarapuram', assembly_no: 79 }], ...cols }, sent: [], failCaption: false }); }

const SILENT = ['Demo', 'Benefits', 'FAQ', 'Website', 'Main menu', 'மாதிரி விளக்கம்', 'பயன்பாடுகள்', 'கேள்வி பதில்கள்', 'இணையதளம்', 'முதன்மை மெனு'];
const DUAL = ['Support', 'Purchase Plan', 'Social Media', 'உதவி மையம்', 'திட்டத்தை வாங்க', 'சமூக வலைத்தள சேவை'];

console.log('=== v18 buttons ===');
for (const who of ['new', 'registered']) {
  for (const t of SILENT) { reset(who === 'registered' ? REGISTERED : {}); const out = await tap(B(t)); check(out.length === 0, `${who}: "${t}" button -> backend silent (WACTO screen only)`); }
  for (const t of DUAL) { reset(who === 'registered' ? REGISTERED : {}); const out = await tap(B(t)); check(out.length >= 1, `${who}: "${t}" button -> backend follow-up (${out.length} msg)`); }
}
for (const t of ['My Credentials', 'எனது கணக்கு விவரங்கள்']) {
  reset(REGISTERED); let out = await tap(L(t));
  check(out.length >= 1 && out.some((m) => /654321/.test(m.text || m.caption || '')), `registered: "${t}" -> login details sent by backend`);
  reset({}); out = await tap(L(t));
  check(out.length >= 1 && !out.some((m) => /654321/.test(m.text || m.caption || '')), `new user: "${t}" -> "no account" message, no passcode`);
}
console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
process.exit(fails ? 1 : 0);
