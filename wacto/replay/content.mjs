// Admin-edited bot content: an override stored in app_flow_messages / app_flow_images must change
// what the bot sends; removing it must restore the default. Usage: node content.mjs src/controllers/current.js
import { pathToFileURL } from 'node:url';

const H = (globalThis.__H ||= { cols: {}, sent: [], failCaption: false });
const ctrl = await import(pathToFileURL(process.argv[2]).href);
const content = await import(pathToFileURL(process.argv[2].replace(/controllers[\\/].*$/, 'services/botContent.js')).href);
const { BOT_TEXTS } = await import(pathToFileURL(process.argv[2].replace(/controllers[\\/].*$/, 'constants/botContent.js')).href);

const PH = '919000000004', MOB = '9000000004';
const L = (t) => ({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'x', title: t } } });
const res = { sendStatus() {} };
let fails = 0;
const check = (ok, what) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
async function send(step) {
  const before = H.sent.length;
  await ctrl.handleWactoWebhook({ body: { entry: [{ changes: [{ value: { messages: [{ from: PH, ...step }], contacts: [{ profile: { name: 'Sim' } }] } }] }] } }, res);
  return H.sent.slice(before);
}
function reset(extra = {}) {
  Object.assign(H, { cols: { tbl_user: [{ _id: 'u4', mobile_no: MOB, first_name: 'Sim', password_str: '123456', paid_status: 'No' }], tbl_assembly_consitituency: [], tbl_wacto_sessions: [{ phone: PH, lang: 'en' }], ...extra }, sent: [] });
  content.clearBotContentCache();
}

console.log('=== admin-editable bot content ===');
check(Object.keys(BOT_TEXTS).length >= 38 && Object.values(BOT_TEXTS).every((t) => t.en && t.ta && t.group && t.name), `catalogue has ${Object.keys(BOT_TEXTS).length} texts, each with EN, TA, group, name`);

// defaults
reset();
let out = await send(L('Support'));
check(out.length === 1 && out[0].text === BOT_TEXTS.menu_support_intro.en, 'Support follow-up = default English text');

// text override (EN) with a {var}
reset({ app_flow_messages: [{ key: 'bot_menu_support_intro_en', text: 'Custom support line for {mobile}' }] });
out = await send(L('Support'));
check(out.length === 1 && out[0].text === 'Custom support line for {mobile}', 'EN override is sent as stored (unknown {var} left as is)');

// override with a known var → filled
reset({ app_flow_messages: [{ key: 'bot_menu_no_account_en', text: 'No account for {mobile} — custom' }], tbl_user: [] });
out = await send(L('My Credentials'));
check(out.length === 1 && out[0].text === `No account for ${MOB} — custom`, '{mobile} filled in an overridden text');

// Tamil override only affects Tamil
reset({ app_flow_messages: [{ key: 'bot_menu_support_intro_ta', text: 'தனிப்பயன் உதவி' }] });
out = await send(L('Support'));
check(out[0].text === BOT_TEXTS.menu_support_intro.en, 'TA override leaves English untouched');
reset({ app_flow_messages: [{ key: 'bot_menu_support_intro_ta', text: 'தனிப்பயன் உதவி' }], tbl_wacto_sessions: [{ phone: PH, lang: 'ta' }] });
out = await send(L('உதவி மையம்'));
check(out[0].text === 'தனிப்பயன் உதவி', 'TA override used for a Tamil session');

// empty override is ignored → default
reset({ app_flow_messages: [{ key: 'bot_menu_support_intro_en', text: '   ' }] });
out = await send(L('Support'));
check(out[0].text === BOT_TEXTS.menu_support_intro.en, 'blank override falls back to the default');

// image override
reset({ app_flow_images: [{ key: 'bot_img_credentials', url: 'https://cdn.test/custom-credentials.jpg' }] });
out = await send(L('My Credentials'));
check(out.length === 1 && out[0].kind === 'image+caption' && out[0].url === 'https://cdn.test/custom-credentials.jpg' && /123456/.test(out[0].text), 'credentials image replaced by the uploaded one, caption unchanged');
reset();
out = await send(L('My Credentials'));
check(out[0].url.includes('edms-credentials.jpg'), 'without an upload the default image is sent');

// DB offline → defaults, bot keeps answering
reset();
const realCol = H.cols; H.cols = new Proxy({}, { get() { throw new Error('APP_DB_OFFLINE'); } });
try { await content.loadBotContent({ collection() { throw new Error('APP_DB_OFFLINE'); } }, true); check(true, 'content load survives a DB error'); } catch { check(false, 'content load survives a DB error'); }
H.cols = realCol;
check(content.botText('menu_support_intro', 'en') === BOT_TEXTS.menu_support_intro.en, 'defaults served while the DB is offline');

console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
process.exit(fails ? 1 : 0);
