// Flow v17: the Demo message has buttons "Register now" / "இப்போதே பதிவு செய்க", "Support" / "உதவி மையம்",
// "Main menu" / "முதன்மை மெனு". "Register now" must behave like "Register" in the backend (welcome-back for
// registered users, a stale half-finished registration is reset). Synthetic data only.
// Usage: node demo_buttons.mjs src/controllers/<current|before>.js   (run setup.mjs first)
import { pathToFileURL } from 'node:url';

const H = (globalThis.__H ||= { cols: {}, sent: [], failCaption: false });
const ctrl = await import(pathToFileURL(process.argv[2]).href);

const PH = '919000000005', MOB = '9000000005';
const isTamil = (s = '') => (s.match(/[஀-௿]/g) || []).length > (s.match(/[A-Za-z]/g) || []).length;
const L = (t) => ({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'x', title: t } } });
const B = (t) => ({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'x', title: t } } });
let fails = 0;
const check = (ok, what) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
async function tap(step) {
  const before = H.sent.length;
  await ctrl.handleWactoWebhook({ body: { entry: [{ changes: [{ value: { messages: [{ from: PH, ...step }], contacts: [{ profile: { name: 'Sim' } }] } }] }] } }, { sendStatus() {} });
  return H.sent.slice(before);
}
function reset(cols = {}) { Object.assign(H, { cols: { tbl_assembly_consitituency: [{ assembly_name: 'Sankarapuram', assembly_no: 79 }], ...cols }, sent: [], failCaption: false }); }
const REGISTERED = { tbl_user: [{ _id: 'u5', mobile_no: MOB, first_name: 'Sim', password_str: '123456' }] };

console.log('=== Demo buttons (flow v17) ===');
// 1 registered user taps "Register now" -> login details (same as Register)
reset(REGISTERED);
let out = await tap(B('Register now'));
check(out.length === 1 && /123456/.test(out[0].text || '') && !isTamil(out[0].text), '"Register now" (registered) -> English welcome-back with login');

// 2 Tamil equivalent
reset({ ...REGISTERED, tbl_wacto_sessions: [{ phone: PH, lang: 'ta' }] });
out = await tap(B('இப்போதே பதிவு செய்க'));
check(out.length === 1 && /123456/.test(out[0].text || '') && isTamil(out[0].text), '"இப்போதே பதிவு செய்க" (registered) -> Tamil welcome-back with login');

// 3 stale half-finished registration is reset, so Step 1 is accepted without a "can't go back" warning
reset({ tbl_wacto_sessions: [{ phone: PH, lang: 'en', reg_started: true, role: 'Party Functionary', party_affiliation: 'yes', updated_at: new Date(Date.now() - 2 * 3600 * 1000) }] });
await tap(B('Register now'));
out = await tap(L('Planning to Contest'));
const s = (H.cols.tbl_wacto_sessions || [])[0] || {};
check(out.length === 0 && s.role === 'Planning to Contest' && !s.party_affiliation, 'stale session reset: Step 1 accepted, no warning');

// 4 a brand-new user: "Register now" then the full registration completes
reset();
for (const t of [B('Register now'), L('Planning to Contest'), B('No, Independent'), L('Rural'), L('DP Ward Member'), L('Kallakurichi District'), L('Sankarapuram')]) await tap(t);
out = await tap({ type: 'text', text: { body: '3, 6, 9' } });
check((H.cols.tbl_user || []).length === 1 && (H.cols.tbl_enquiry || [])[0]?.booth_count === 3, 'new user: "Register now" -> registration saved (3 booths)');

// 5 "Register now" sets English; "Main menu" is ignored by the backend (WACTO answers it)
reset({ tbl_wacto_sessions: [{ phone: PH, lang: 'ta' }] });
await tap(B('Register now'));
check((H.cols.tbl_wacto_sessions || [])[0]?.lang === 'en', '"Register now" switches the session to English');
reset();
out = await tap(B('Main menu'));
const out2 = await tap(B('முதன்மை மெனு'));
check(out.length === 0 && out2.length === 0, '"Main menu" / "முதன்மை மெனு": backend stays silent');

// 6 "Support" from the Demo message keeps working exactly like the menu row (dual)
reset();
out = await tap(B('Support'));
check(out.length === 1 && /query/i.test(out[0].text), '"Support" -> backend asks for the query (dual, unchanged)');

console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
process.exit(fails ? 1 : 0);
