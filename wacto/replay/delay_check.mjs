// Support / Purchase Plan / Social Media follow-ups wait (default 2000 ms) so WACTO's image arrives first.
// Checks: the follow-up is sent only after the wait, the step is saved BEFORE the wait (a fast reply works),
// and the webhook is acknowledged at once. Usage: node delay_check.mjs <src/controllers/x.js>  (run setup.mjs first)
import { pathToFileURL } from 'node:url';
delete process.env.WACTO_FOLLOWUP_DELAY_MS;              // test the production default
const H = (globalThis.__H ||= { cols: {}, sent: [], failCaption: false });
const ctrl = await import(pathToFileURL(process.argv[2]).href);
const L = (t) => ({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'x', title: t } } });
let fails = 0;
const check = (ok, what) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };

for (const [label, flow] of [['Support', 'support_issue'], ['Purchase Plan', 'purchase_select'], ['Social Media', 'social_service'], ['உதவி மையம்', 'support_issue']]) {
  Object.assign(H, { cols: {}, sent: [], failCaption: false });
  let acked = null;
  const t0 = Date.now();
  const p = ctrl.handleWactoWebhook({ body: { entry: [{ changes: [{ value: {
    messages: [{ from: '919000000004', ...L(label) }], contacts: [{ profile: { name: 'Sim' } }] } }] }] } },
    { sendStatus() { acked = Date.now() - t0; } });
  await new Promise((r) => setTimeout(r, 300));
  const savedEarly = (H.cols.tbl_wacto_sessions || [])[0]?.flow;
  const sentEarly = H.sent.length;
  await p;
  const took = Date.now() - t0;
  check(acked !== null && acked < 100, `${label}: webhook acknowledged at once (${acked} ms)`);
  check(savedEarly === flow && sentEarly === 0, `${label}: step saved before the wait, nothing sent yet at 300 ms`);
  check(H.sent.length === 1 && took >= 1900, `${label}: follow-up sent after the wait (${took} ms)`);
}
console.log(fails ? `\nRESULT: ${fails} FAILED` : '\nRESULT: ALL PASS');
process.exit(fails ? 1 : 0);
