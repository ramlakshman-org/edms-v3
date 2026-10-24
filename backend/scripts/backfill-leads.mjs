// Incomplete registrations (Ram, 2026-10-15): day-one load. Everyone the WhatsApp bot already holds a session for, and
// whose number has no account, goes into tbl_leads with how far they got. Also creates the unique index on tbl_leads.mobile
// (one row per number). Existing lead rows are left alone. Prints counts only (no numbers, no names).
//   node scripts/backfill-leads.mjs            dry run
//   node scripts/backfill-leads.mjs --apply    write
// Undo: db.tbl_leads.deleteMany({ backfilled: true })
import 'dotenv/config';
import { MongoClient } from 'mongodb';
import { LEADS_COLL, LEAD_STEPS, stepOfSession } from '../src/services/leads.js';

const apply = process.argv.includes('--apply');
const client = new MongoClient(process.env.MONGO_APP_URL);
await client.connect();
const db = client.db(process.env.MONGO_APP_DB_NAME);
const ten = (m) => String(m || '').replace(/\D/g, '').slice(-10);
const sessions = await db.collection('tbl_wacto_sessions').find({}).toArray();
const registered = new Set((await db.collection('tbl_user').find({}, { projection: { mobile_no: 1 } }).toArray()).map((u) => String(u.mobile_no))); // any account
const have = new Set((await db.collection(LEADS_COLL).find({}, { projection: { mobile: 1 } }).toArray()).map((l) => l.mobile));
const rows = []; const by = {}; let skippedReg = 0, skippedHave = 0;
for (const s of sessions) {
  const m = ten(s.phone);
  if (m.length !== 10) continue;
  if (registered.has(m)) { skippedReg++; continue; }
  if (have.has(m) || rows.some((r) => r.mobile === m)) { skippedHave++; continue; }
  const step = stepOfSession(s);
  const at = new Date(s.updated_at || s.created_at || Date.now()).toISOString();
  by[LEAD_STEPS[step].label] = (by[LEAD_STEPS[step].label] || 0) + 1;
  rows.push({ mobile: m, wa_name: String(s.contact_name || ''), web_name: '', sources: ['whatsapp'], first_seen: at, last_seen: at, step, step_rank: LEAD_STEPS[step].rank, step_at: at,
    status: 'new', status_at: null, status_by: '', notes: [], history: [], registered_at: null, backfilled: true });
}
const idx = (await db.collection(LEADS_COLL).indexes().catch(() => [])).some((i) => i.name === 'uniq_lead_mobile');
console.log(`db ${process.env.MONGO_APP_DB_NAME} — ${apply ? 'APPLY' : 'dry run'}: bot sessions ${sessions.length}, already registered ${skippedReg}, already a lead ${skippedHave}, to add ${rows.length}; unique index ${idx ? 'there' : 'not there'}`);
console.log('to add, by furthest step:', JSON.stringify(by));
if (apply) {
  if (!idx) { await db.collection(LEADS_COLL).createIndex({ mobile: 1 }, { name: 'uniq_lead_mobile', unique: true }); console.log('created uniq_lead_mobile'); }
  if (rows.length) console.log('added', (await db.collection(LEADS_COLL).insertMany(rows)).insertedCount);
} else console.log('dry run — add --apply to write');
await client.close();
