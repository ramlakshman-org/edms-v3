// Purchase Plan → plan number → booth count must end with the payment QR image whose caption has the
// UPI ID and the total for the TYPED booth count (owner 2026-10-12). Numbers without an account also get
// the WhatsApp + website registration steps; registered numbers don't. Text booth counts are re-asked.
// Synthetic data only. Usage: node purchase_qr.mjs src/controllers/<current|before>.js (run setup.mjs first)
import { pathToFileURL } from 'node:url';

process.env.WACTO_FOLLOWUP_DELAY_MS = '0';
const H = (globalThis.__H ||= { cols: {}, sent: [], failCaption: false });
const ctrl = await import(pathToFileURL(process.argv[2]).href);

const PH = '919000000007', MOB = '9000000007';
const B = (t) => ({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'x', title: t } } });
const T = (t) => ({ type: 'text', text: { body: t } });
let fails = 0;
const check = (ok, what) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
async function step(msg) {
  const before = H.sent.length;
  await ctrl.handleWactoWebhook({ body: { entry: [{ changes: [{ value: { messages: [{ from: PH, ...msg }], contacts: [{ profile: { name: 'Sim' } }] } }] }] } }, { sendStatus() {} });
  return H.sent.slice(before);
}
const REGISTERED = { tbl_user: [{ _id: 'u7', mobile_no: MOB, first_name: 'Sim', password_str: '777777' }] };
function reset(cols = {}) { Object.assign(H, { cols: { ...cols }, sent: [], failCaption: false }); }
const qrOf = (out) => out.find((m) => m.kind === 'image+caption' || m.kind === 'image');
const captionOf = (out) => out.map((m) => m.text || '').join('\n');

async function purchase(menuLabel, plan, booths) {
  await step(B(menuLabel));
  await step(T(plan));
  return step(T(booths));
}

console.log('=== Purchase Plan ends with the payment QR ===');
reset();
let out = await purchase('Purchase Plan', '5', '50');
let cap = captionOf(out);
check(!!qrOf(out), 'new user EN: QR image sent');
check(/UPI ID/.test(cap) && /59,000/.test(cap), 'new user EN: caption has UPI ID and total ₹59,000 for 50 booths');
check(/tnedms\.com\/register/.test(cap) && /Main menu/.test(cap), 'new user EN: WhatsApp + website registration steps included');

reset(REGISTERED);
out = await purchase('Purchase Plan', '5', '50');
cap = captionOf(out);
check(!!qrOf(out) && /59,000/.test(cap), 'registered EN: QR + ₹59,000');
check(!/tnedms\.com\/register/.test(cap), 'registered EN: no register-first steps');

reset();
out = await purchase('திட்டத்தை வாங்க', '1', '3');
cap = captionOf(out);
check(!!qrOf(out) && /5,900/.test(cap), 'new user TA: picked 1-booth plan but typed 3 → priced for 3 booths (₹5,900)');
check(/பதிவு செய்ய/.test(cap) && /tnedms\.com\/register/.test(cap), 'new user TA: Tamil registration steps included');

reset();
await step(B('Purchase Plan')); await step(T('2'));
out = await step(T('many'));
check(!qrOf(out) && out.length === 1 && /booths/i.test(out[0].text || ''), 'text instead of a number → booth question asked again, no QR');
out = await step(T('12'));
check(!!qrOf(out) && /29,500/.test(captionOf(out)), '...then 12 → QR with ₹29,500 (11–25 booths)');

console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
process.exit(fails ? 1 : 0);
