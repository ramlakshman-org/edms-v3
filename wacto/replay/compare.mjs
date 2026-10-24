// Gate: English byte-identical, Tamil differs ONLY at the 5 approved strings, saved data identical.
// PINNED to the 2026-10-09 Tamil content change (commit 43380a0) — copy it for a new change.
// Usage: node compare.mjs out/before.json out/current.json   (dumps from content_check.mjs)
import { readFileSync } from 'node:fs';
const A = JSON.parse(readFileSync(process.argv[2], 'utf8'));   // unpatched
const P = JSON.parse(readFileSync(process.argv[3], 'utf8'));   // patched
let fails = 0;
const check = (ok, what) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };

const EXPECTED = [
  ['#2 welcome back',  'மீண்டும் நல்வரவு', 'மீண்டும் தங்களை வரவேற்கிறோம்'],
  ['#8 GST line',      '(அனைத்து விலைகளும் + 18% GST)', '(18% ஜிஎஸ்டி சேர்க்கப்படவில்லை)'],
  ['#10 social list',  'ஒலி குறுஞ்செய்தி)', 'ஒலி குறுஞ்செய்தி / வாய்ஸ் மெசேஜ்)'],
  ['#13 booth prompt', 'எந்தெந்த பூத் எண்களை நிர்வகிக்கிறீர்கள்', 'உங்களுடைய பூத் எண்களை உள்ளிடவும்'],
  ['#14 payment line', 'நிமிடங்களுக்குள் அணுகல் செயல்படுத்தப்படும்', 'நிமிடங்களுக்குள் கணக்கு செயல்படுத்தப்படும்'],
];

console.log('=== English (must be untouched)');
check(A.en.length === P.en.length && A.en.every((m, i) => JSON.stringify(m) === JSON.stringify(P.en[i])),
  `all ${P.en.length} English messages byte-identical`);

console.log('=== Tamil');
check(A.ta.length === P.ta.length, `same number of messages / bubbles (${A.ta.length} vs ${P.ta.length})`);
const diffs = A.ta.map((m, i) => [m, P.ta[i]]).filter(([a, p]) => a.text !== p.text || a.kind !== p.kind);
const matched = new Set();
for (const [a, p] of diffs) {
  const hit = EXPECTED.find(([, o, n]) => a.text.includes(o) && p.text.includes(n) && !p.text.includes(o));
  if (hit) matched.add(hit[0]);
  check(!!hit && a.kind === p.kind, `changed msg after tap "${p.tap}" = ${hit ? hit[0] : 'UNEXPECTED CHANGE'}`);
}
for (const [name] of EXPECTED) check(matched.has(name), `${name} observed in the chat`);
check(P.ta.filter((m) => m.text).every((m) => /[஀-௿]/.test(m.text)), 'every Tamil-run backend message is still Tamil');
check(P.ta.every((m) => m.kind !== 'image+caption' || m.text.length <= 1024),
  `captions within 1024 (${P.ta.filter((m) => m.kind === 'image+caption').map((m) => m.text.length).join(', ')})`);
check(P.ta.some((m) => m.tap === 'Sankarapuram' && m.text.includes('Sankarapuram') && m.text.includes('கமா (,)')),
  '#13 shows the picked assembly name + the comma instruction');

console.log('=== Saved data (logic untouched)');
const clean = (x) => JSON.stringify(x, (k, v) => (k === 'passcode' || k === 'created_at' ? undefined : v));
for (const k of ['ta_saved', 'en_saved']) check(clean(A[k]) === clean(P[k]), `${k} identical: ${clean(P[k].enquiry?.map(({ role, party, position, assembly_name, booths }) => ({ role, party, position, assembly_name, booths })))}`);

console.log(fails ? `\nRESULT: ${fails} FAILED` : '\nRESULT: ALL PASS');
process.exit(fails ? 1 : 0);
