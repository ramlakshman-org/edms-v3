// Every option of the live flow must still be accepted at its own step (EN + TA): each role,
// party-affiliation button, party, body type, position, district and assembly row of the flow
// JSON is tapped at the point where the flow offers it, and must move the registration forward.
// Usage: node allrows.mjs <src/controllers/x.js> <flow.json>   (run setup.mjs first)
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const H = (globalThis.__H ||= { cols: {}, sent: [], failCaption: false });
const ctrl = await import(pathToFileURL(process.argv[2]).href);
const flow = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const node = (name) => flow.nodes.find((n) => n.name === name);
const titles = (n) => n.data.interactiveType === 'button'
  ? n.data.action.buttons.map((b) => b.reply.title)
  : n.data.action.sections.flatMap((s) => s.rows.map((r) => r.title));
const PAGING = /^(More |மேலும்)/;

const PHONE = '919000000003';
const L = (t) => ({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'x', title: t } } });
const B = (t) => ({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'x', title: t } } });
const reset = () => Object.assign(H, { cols: {}, sent: [], failCaption: false });
const tap = async (s) => ctrl.handleWactoWebhook({ body: { entry: [{ changes: [{ value: {
  messages: [{ from: PHONE, ...s }], contacts: [{ profile: { name: 'Sim' } }] } }] }] } }, { sendStatus() {} });
const session = () => (H.cols.tbl_wacto_sessions || [])[0] || {};
const lockedNote = () => H.sent.some((o) => /can't go back or skip steps|படிகளைத் தவிர்க்கவோ முடியாது/.test(o.text || ''));

const P = { en: { pre: 'Registration: ', lang: 'English', reg: 'Register', role: 'Campaign Team Member', yes: 'Yes, have a party',
                  rural: 'Rural', urban: 'Urban', pos: 'DP Ward Member', asm: 'Assembly: ' },
            ta: { pre: 'TA Registration: ', lang: 'தமிழ்', reg: 'பதிவு செய்ய', role: 'பிரச்சாரக் குழு', yes: 'ஆம், கட்சி உள்ளது',
                  rural: 'ஊரகப் பகுதி', urban: 'நகர்ப்புறப் பகுதி', pos: 'மாவட்ட வார்டு உறுப்பினர்', asm: 'TA Assembly: ' } };

let tried = 0; const bad = [];
async function check(lang, label, prefix, row, field, want = (v) => v != null) {
  reset();
  for (const s of prefix) await tap(s);
  H.sent.length = 0;
  await tap(row);
  tried++;
  const v = session()[field];
  const ok = field === 'assembly'
    ? H.sent.some((o) => /booth/i.test(o.text || '') || /பூத்/.test(o.text || '')) && !lockedNote()
    : want(v) && !lockedNote();
  if (!ok) bad.push(`${lang} ${label}: "${row.interactive[row.interactive.type].title}" -> ${field}=${JSON.stringify(v)}${lockedNote() ? ' (LOCKED)' : ''}`);
}

for (const lang of ['en', 'ta']) {
  const p = P[lang];
  const start = [L(p.lang), L(p.reg)];
  for (const t of titles(node(p.pre + 'Role'))) await check(lang, 'role', start, L(t), 'role');
  for (const t of titles(node(p.pre + 'Party Affiliation'))) await check(lang, 'affiliation', [...start, L(p.role)], B(t), 'party_affiliation');
  for (const pg of ['Party Page 1', 'Party Page 2'])
    for (const t of titles(node(p.pre + pg)).filter((t) => !PAGING.test(t)))
      await check(lang, 'party', [...start, L(p.role), B(p.yes)], L(t), 'party');
  for (const t of titles(node(p.pre + 'Body Type'))) await check(lang, 'body type', [...start, L(p.role), B(p.yes), L('TVK')], L(t), 'body_type');
  for (const [pg, body] of [['Rural Position', p.rural], ['Urban Position', p.urban]])
    for (const t of titles(node(p.pre + pg))) await check(lang, 'position', [...start, L(p.role), B(p.yes), L('TVK'), L(body)], L(t), 'position');
  const toDistrict = [...start, L(p.role), B(p.yes), L('TVK'), L(p.rural), L(p.pos)];
  for (let i = 1; i <= 5; i++)
    for (const t of titles(node(`${p.pre}District Page ${i}`)).filter((t) => !PAGING.test(t)))
      await check(lang, 'district', toDistrict, L(t), 'district');
  for (const n of flow.nodes.filter((n) => n.name.startsWith(p.asm))) {
    const district = n.name.slice(p.asm.length).replace(/ p\d+$/, '');
    // tap the district exactly as this flow shows it ("Salem" in v9, "Salem District" / "Salem மாவட்டம்" in v10)
    const distRow = [1, 2, 3, 4, 5].flatMap((i) => titles(node(`${p.pre}District Page ${i}`))).find((t) => t === district || t.startsWith(district + ' '));
    for (const t of titles(n).filter((t) => !PAGING.test(t))) await check(lang, `assembly (${district})`, [...toDistrict, L(distRow)], L(t), 'assembly');
  }
}
console.log(`tapped ${tried} options of the live flow`);
bad.slice(0, 25).forEach((b) => console.log('  ✗', b));
console.log(bad.length ? `RESULT: ${bad.length} option(s) NOT accepted` : 'RESULT: every option accepted at its step');
process.exit(bad.length ? 1 : 0);
