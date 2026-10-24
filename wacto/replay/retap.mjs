// Old-tap ("re-tap") scenarios: a user taps a button/list row from an EARLIER message.
// WhatsApp keeps old buttons tappable and WACTO answers them itself; the backend must ignore
// them (no saved data changes, no re-registration, no passcode reset) and say how to continue.
// Usage: node retap.mjs <src/controllers/x.js>   (run setup.mjs first). Synthetic data only.
import { pathToFileURL } from 'node:url';

const H = (globalThis.__H ||= { cols: {}, sent: [], failCaption: false });
const ctrl = await import(pathToFileURL(process.argv[2]).href);

const PHONE = '919000000002', MOBILE = '9000000002';
const TAMIL = /[஀-௿]/;

// A message is Tamil when Tamil letters outnumber Latin letters (approved English text may contain Tamil words in brackets)
const isTamil = (s = '') => (s.match(/[஀-௿]/g) || []).length > (s.match(/[A-Za-z]/g) || []).length;
const L = (t) => ({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'x', title: t } } });
const B = (t) => ({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'x', title: t } } });
const T = (t) => ({ type: 'text', text: { body: t } });

function reset() {
  Object.assign(H, { cols: { tbl_assembly_consitituency: [
    { assembly_name: 'Sankarapuram', assembly_no: 79 }, { assembly_name: 'Dindigul', assembly_no: 132 }] }, sent: [], failCaption: false });
}
async function tap(step) {
  const before = H.sent.length;
  await ctrl.handleWactoWebhook({ body: { entry: [{ changes: [{ value: {
    messages: [{ from: PHONE, ...step }], contacts: [{ profile: { name: 'Sim' } }] } }] }] } }, { sendStatus() {} });
  return H.sent.slice(before);
}
async function run(steps) { const out = []; for (const s of steps) out.push(...await tap(s)); return out; }
const ageSession = () => { for (const s of H.cols.tbl_wacto_sessions || []) s.updated_at = new Date(Date.now() - 31 * 60 * 1000); };
const enquiry = () => (H.cols.tbl_enquiry || [])[0] || {};
const users = () => H.cols.tbl_user || [];
const texts = (out) => out.map((o) => o.text || '').join('\n---\n');
const isNote = (out) => out.length === 1 && out[0].kind === 'text' && /can't go back or skip steps|படிகளைத் தவிர்க்கவோ முடியாது/.test(out[0].text);
const isRegisteredNote = (out) => out.length === 1 && /already registered|ஏற்கனவே EDMS கணக்கில் பதிவு/.test(out[0].text || '');
const completed = (out) => out.some((o) => /Registration Complete|பதிவு வெற்றிகரமாக/.test(o.text || ''));

const EN = { start: [T('hi'), L('English'), L('Register')], role: L('Campaign Team Member'), aff: B('Yes, have a party'),
  party: L('TVK'), body: L('Rural'), pos: L('DP Ward Member'), dist: L('Kallakurichi'), asm: L('Sankarapuram'), booths: T('3, 6, 9') };
const TA = { start: [T('hi'), L('தமிழ்'), L('பதிவு செய்ய')], role: L('பிரச்சாரக் குழு'), aff: B('ஆம், கட்சி உள்ளது'),
  party: L('TVK'), body: L('ஊரகப் பகுதி'), pos: L('மாவட்ட வார்டு உறுப்பினர்'), dist: L('Kallakurichi'), asm: L('Sankarapuram'), booths: T('3, 6, 9') };
const upTo = (F, last) => { const order = ['role', 'aff', 'party', 'body', 'pos', 'dist', 'asm', 'booths'];
  return [...F.start, ...order.slice(0, order.indexOf(last) + 1).map((k) => F[k])]; };
const WANT = { role: 'Campaign Team Member', party: 'TVK', body_type: 'Rural', position: 'District Panchayat Ward Member',
  district: 'Kallakurichi', assembly_name: 'Sankarapuram', booth_count: 3 };
const savedAsWanted = (want = WANT) => Object.entries(want).every(([k, v]) => enquiry()[k] === v);

let fails = 0;
const results = [];
async function scenario(name, fn) {
  reset();
  const checks = [];
  try { await fn((ok, what) => checks.push([!!ok, what])); } catch (e) { checks.push([false, `threw ${e.message}`]); }
  const bad = checks.filter(([ok]) => !ok);
  if (bad.length) fails++;
  console.log(`${bad.length ? 'FAIL' : 'PASS'}  ${name}`);
  for (const [ok, what] of checks) if (!ok) console.log(`        ✗ ${what}`);
  results.push([name, !bad.length]);
}

await scenario('1 EN: old party tap mid-registration is ignored (note only, party kept)', async (c) => {
  await run(upTo(EN, 'dist'));
  const out = await tap(L('DMK'));
  c(isNote(out), `one note naming the next step, got: ${JSON.stringify(texts(out)).slice(0, 120)}`);
  c(/Step 6 — Assembly/.test(texts(out)), 'note names "Step 6 — Assembly"');
  const done = await run([EN.asm, EN.booths]);
  c(completed(done), 'registration still completes from the latest message');
  c(savedAsWanted(), `saved = original answers (party TVK), got ${JSON.stringify(enquiry().party)}`);
});

await scenario('2 EN: old body-type tap after position does not wipe later answers', async (c) => {
  await run(upTo(EN, 'pos'));
  const out = await tap(L('Urban'));
  c(isNote(out), 'note only');
  const done = await run([EN.dist, EN.asm, EN.booths]);
  c(completed(done) && savedAsWanted(), `saved Rural / DP Ward Member, got ${enquiry().body_type} / ${enquiry().position}`);
});

await scenario('3 EN: old district tap after district is NOT saved as the assembly', async (c) => {
  await run(upTo(EN, 'dist'));
  const out = await tap(L('Cuddalore'));
  c(isNote(out), `note only (no booth prompt), got: ${JSON.stringify(texts(out)).slice(0, 120)}`);
  const ask = await tap(EN.asm);
  c(ask.length === 1 && /Sankarapuram/.test(ask[0].text || ''), 'real assembly tap then asks booths for Sankarapuram');
  await tap(EN.booths);
  c(enquiry().assembly_name === 'Sankarapuram', `assembly = Sankarapuram, got ${enquiry().assembly_name}`);
});

await scenario('4 EN: quick change on the same step (Rural then Urban) keeps the first answer', async (c) => {
  await run(upTo(EN, 'body'));
  const out = await tap(L('Urban'));
  c(isNote(out), 'note only');
  await run([EN.pos, EN.dist, EN.asm, EN.booths]);
  c(enquiry().body_type === 'Rural', `body_type Rural, got ${enquiry().body_type}`);
});

await scenario('5 EN: after registration, replaying the whole old chat changes nothing', async (c) => {
  await run(upTo(EN, 'booths'));
  const pass1 = users()[0]?.password_str, enq1 = JSON.stringify(enquiry());
  const outs = [];
  for (const s of [EN.role, EN.aff, EN.party, EN.body, EN.pos, EN.dist, EN.asm]) outs.push(await tap(s));
  const last = await tap(EN.booths);
  c(outs.every(isRegisteredNote), `every old registration tap gets the "already registered" note (${outs.filter(isRegisteredNote).length}/${outs.length})`);
  c(!completed(last), 'no second "Registration Complete"');
  c(users().length === 1 && users()[0].password_str === pass1, 'passcode NOT reset, still one user');
  c(JSON.stringify(enquiry()) === enq1, 'saved registration unchanged');
});

await scenario('6 TA: old party tap mid-registration -> Tamil note naming படி 6', async (c) => {
  await run(upTo(TA, 'dist'));
  const out = await tap(L('DMK'));
  c(isNote(out) && isTamil(out[0].text), 'one Tamil note');
  c(/படி 6/.test(texts(out)), 'note names படி 6');
  await run([TA.asm, TA.booths]);
  c(savedAsWanted(), `saved original answers, got party ${enquiry().party}`);
});

await scenario('7 TA: after registration, old Tamil role tap -> Tamil "already registered" note', async (c) => {
  await run(upTo(TA, 'booths'));
  const pass1 = users()[0]?.password_str;
  const out = await tap(TA.role);
  c(isRegisteredNote(out) && isTamil(out[0].text), 'Tamil already-registered note');
  c(users()[0].password_str === pass1, 'passcode unchanged');
});

await scenario('8 EN: Register restarts a registration and new answers are saved', async (c) => {
  await run(upTo(EN, 'party'));
  await run([L('Register'), L('Planning to Contest'), B('No, Independent'), L('Urban'), L('Municipality'), EN.dist, EN.asm, EN.booths]);
  c(enquiry().role === 'Planning to Contest' && enquiry().party === 'Independent' && enquiry().body_type === 'Urban'
    && enquiry().position === 'Municipality', `saved new answers, got ${enquiry().role}/${enquiry().party}/${enquiry().body_type}/${enquiry().position}`);
});

await scenario('9 EN: assembly with the same name as its district (Dindigul) is accepted', async (c) => {
  await run([...upTo(EN, 'pos'), L('Dindigul')]);
  const ask = await tap(L('Dindigul'));
  c(ask.length === 1 && /booth numbers/i.test(ask[0].text || ''), 'asks booth numbers');
  await tap(EN.booths);
  c(enquiry().district === 'Dindigul' && enquiry().assembly_name === 'Dindigul', `saved Dindigul/Dindigul, got ${enquiry().district}/${enquiry().assembly_name}`);
});

await scenario('10 EN: 31-min pause, then continue from the latest message -> completes', async (c) => {
  await run(upTo(EN, 'dist'));
  ageSession();
  const done = await run([EN.asm, EN.booths]);
  c(completed(done) && savedAsWanted(), `completed with all answers, got ${JSON.stringify({ ...enquiry(), passcode: undefined }).slice(0, 140)}`);
});

await scenario('11 EN: 31-min pause, then type booth numbers -> booths saved (not as the assembly)', async (c) => {
  await run(upTo(EN, 'asm'));
  ageSession();
  const done = await tap(EN.booths);
  c(completed(done), 'registration completes');
  c(enquiry().assembly_name === 'Sankarapuram' && JSON.stringify(enquiry().booths) === '[3,6,9]',
    `assembly Sankarapuram, booths [3,6,9], got ${enquiry().assembly_name} ${JSON.stringify(enquiry().booths)}`);
});

await scenario('12 EN: menu items stay repeatable (Support twice after registration)', async (c) => {
  await run(upTo(EN, 'booths'));
  const a = await tap(L('Support'));
  await tap(T('skip'));                       // leave the support flow without a ticket
  const b = await tap(L('Support'));
  c(a.length === 1 && b.length === 1 && /Type your query/.test(a[0].text) && /Type your query/.test(b[0].text), 'both Support taps answered');
});

await scenario('13 EN: old button while booth numbers are awaited -> note says type booths', async (c) => {
  await run(upTo(EN, 'asm'));
  const out = await tap(L('BJP'));
  c(isNote(out) && /booth numbers/i.test(texts(out)), 'note asks for booth numbers');
  const done = await tap(EN.booths);
  c(completed(done) && savedAsWanted(), 'then completes with the original answers');
});

await scenario('14 TA: Tamil -> Register -> tap old "English" = note in Tamil, language stays Tamil', async (c) => {
  await run(TA.start);
  const out = await tap(L('English'));
  c(isNote(out) && isTamil(out[0].text) && /படி 1/.test(out[0].text), `one Tamil note naming படி 1, got: ${JSON.stringify(texts(out)).slice(0, 100)}`);
  const done = await run([TA.role, TA.aff, TA.party, TA.body, TA.pos, TA.dist, TA.asm, TA.booths]);
  c(completed(done) && done.filter((o) => o.text).every((o) => isTamil(o.text)), 'registration completes, all replies still Tamil');
});

await scenario('15 Switching language = Register in the other menu (restart in English)', async (c) => {
  await run([...TA.start, TA.role]);
  await tap(L('English'));                    // locked; WACTO would show the English menu
  const done = await run([L('Register'), EN.role, EN.aff, EN.party, EN.body, EN.pos, EN.dist, EN.asm, EN.booths]);
  c(completed(done) && done.filter((o) => o.text).every((o) => !isTamil(o.text)), 'restarted and completed in English');
});

await scenario('16 Language tap after a 31-min pause is allowed (no note)', async (c) => {
  await run([...EN.start, EN.role]);
  ageSession();
  const out = await tap(L('தமிழ்'));
  c(out.length === 0, `no note, got ${out.length} message(s)`);
  const ask = await run([TA.aff, TA.party, TA.body, TA.pos, TA.dist, TA.asm]);
  c(ask.some((o) => isTamil(o.text || '')), 'continues in Tamil');
});

await scenario('17 Registered user: Register and My Credentials = ONE message (image + caption)', async (c) => {
  await run(upTo(EN, 'booths'));
  const a = await run([L('Register')]);
  const b = await run([L('My Credentials')]);
  c(a.length === 1 && a[0].kind === 'image+caption' && /Welcome back/.test(a[0].text), `welcome back = 1 image+caption, got ${a.map((o) => o.kind)}`);
  c(b.length === 1 && b[0].kind === 'image+caption' && /Username/.test(b[0].text), `My Credentials = 1 image+caption, got ${b.map((o) => o.kind)}`);
  H.failCaption = true;
  const f = await run([L('Register')]);
  c(f.length === 2 && f[0].kind === 'image' && f[1].kind === 'text', 'caption rejected -> image then text (fallback)');
});

await scenario('18 "Hi" starts over: Tamil registration open, then Hi -> English is allowed (no note)', async (c) => {
  await run([...TA.start, TA.role]);
  const hi = await tap(T('Hi'));
  const out = await tap(L('English'));
  c(hi.length === 0 && out.length === 0, `no backend messages for Hi / English, got ${hi.length + out.length}`);
  const done = await run([L('Register'), EN.role, EN.aff, EN.party, EN.body, EN.pos, EN.dist, EN.asm, EN.booths]);
  c(completed(done) && done.filter((o) => o.text).every((o) => !isTamil(o.text)), 'new registration completes in English');
  c(enquiry().role === 'Campaign Team Member' && enquiry().party === 'TVK', 'saved the new answers');
});

await scenario('19 Every restart word (Hey, Start, Menu, வணக்கம்) clears an open registration', async (c) => {
  for (const w of ['Hey', 'Start', 'Menu', 'வணக்கம்', 'hello']) {
    reset();
    await run([...TA.start, TA.role]);
    await tap(T(w));
    c((H.cols.tbl_wacto_sessions || []).length === 0, `"${w}" cleared the session`);
  }
});

const isNext = (out, re) => out.length === 1 && /Got it|சேமிக்கப்பட்டது/.test(out[0].text || '') && re.test(out[0].text);

await scenario('20 EN (live test case): Yes -> old "No, Independent" (warning) -> BJP gets "Got it, Next: Step 3"', async (c) => {
  await run([...EN.start, EN.role, EN.aff]);
  const warn = await tap(B('No, Independent'));
  c(isNote(warn), 'warning sent');
  const next = await tap(L('BJP'));
  c(isNext(next, /Step 3 — Local Body Type/), `one "Got it" naming Step 3, got: ${JSON.stringify(texts(next)).slice(0, 100)}`);
  const after = await tap(EN.body);
  c(after.length === 0, 'the step after that is normal again (no extra message)');
  await run([EN.pos, EN.dist, EN.asm, EN.booths]);
  c(enquiry().party === 'BJP' && enquiry().body_type === 'Rural', `saved BJP / Rural, got ${enquiry().party} / ${enquiry().body_type}`);
});

await scenario('21 TA: same case -> Tamil "சேமிக்கப்பட்டது", next படி 3', async (c) => {
  await run([...TA.start, TA.role, TA.aff]);
  await tap(B('இல்லை, சுயேச்சை'));
  const next = await tap(L('BJP'));
  c(isNext(next, /படி 3/) && isTamil(next[0].text), 'one Tamil "next step" message naming படி 3');
});

await scenario('22 After a warning, the assembly answer gets only the booth question (no extra "Got it")', async (c) => {
  await run(upTo(EN, 'dist'));
  await tap(L('Party Functionary'));          // old role tap -> warning
  const ask = await tap(EN.asm);
  c(ask.length === 1 && /booth numbers/i.test(ask[0].text), `only the booth question, got ${ask.length} message(s)`);
});

await scenario('23 No warning = no "Got it" anywhere in a normal registration', async (c) => {
  const out = await run(upTo(EN, 'booths'));
  c(!out.some((o) => /Got it/.test(o.text || '')), 'no "Got it" message');
});

await scenario('24 v8 paging buttons are ignored by the backend (no message, nothing saved)', async (c) => {
  await run(upTo(EN, 'pos'));
  const before = JSON.stringify(H.cols.tbl_wacto_sessions);
  const out = await run([L('More Districts (3/5)'), L('More in Salem →'), L('மேலும் மாவட்டங்கள் (4/5)'), L('மேலும்: Salem →'), L('More Districts')]);
  c(out.length === 0, `no backend messages, got ${out.length}`);
  c(JSON.stringify(H.cols.tbl_wacto_sessions) === before, 'session unchanged');
  const done = await run([L('Vellore'), L('Vellore'), EN.booths]);
  c(completed(done) && enquiry().district === 'Vellore', `page-4 district Vellore registers, got ${enquiry().district}`);
});

await scenario('25 v10: "Dindigul District" -> assembly "Dindigul" -> booths: saved Dindigul / Dindigul', async (c) => {
  await run([...upTo(EN, 'pos'), L('Dindigul District')]);
  const ask = await tap(L('Dindigul'));
  c(ask.length === 1 && /booth numbers/i.test(ask[0].text || ''), 'asks booth numbers for the assembly');
  await tap(EN.booths);
  c(enquiry().district === 'Dindigul' && enquiry().assembly_name === 'Dindigul', `saved Dindigul / Dindigul, got ${enquiry().district} / ${enquiry().assembly_name}`);
});

await scenario('26 v10 Tamil: "Vellore மாவட்டம்" -> assembly -> saved district "Vellore" (plain, as before)', async (c) => {
  await run([...upTo(TA, 'pos'), L('Vellore மாவட்டம்'), L('Vellore'), TA.booths]);
  c(enquiry().district === 'Vellore' && enquiry().assembly_name === 'Vellore', `saved Vellore / Vellore, got ${enquiry().district} / ${enquiry().assembly_name}`);
});

await scenario('27 v10: an OLD district tap after the district is chosen is never taken as the assembly', async (c) => {
  await run([...upTo(EN, 'pos'), L('Karur District')]);
  const out = await tap(L('Karur District'));
  c(isNote(out), 'warning, not accepted');
  c(!(H.cols.tbl_wacto_sessions || [])[0]?.assembly, 'assembly still empty');
  await run([L('Karur'), EN.booths]);
  c(enquiry().district === 'Karur' && enquiry().assembly_name === 'Karur', `then Karur / Karur, got ${enquiry().district} / ${enquiry().assembly_name}`);
});

console.log(fails ? `\nRESULT: ${fails} of ${results.length} scenarios FAILED` : `\nRESULT: ALL ${results.length} PASS`);
process.exit(fails ? 1 : 0);
