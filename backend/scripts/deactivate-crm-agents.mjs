// Ram, 2026-10-14: the CRM is removed (chats are handled in WACTO), so the CRM agent logins (user_group_id 12) are
// switched off. Deactivated, not deleted: is_active 0 makes the login answer "Your account is deactivated." and the
// records stay for the history. Prints counts and record-id tails only (no names, no numbers).
//   node scripts/deactivate-crm-agents.mjs            dry run
//   node scripts/deactivate-crm-agents.mjs --apply    write
import 'dotenv/config';
import { MongoClient } from 'mongodb';

const apply = process.argv.includes('--apply');
const client = new MongoClient(process.env.MONGO_APP_URL);
await client.connect();
const U = client.db(process.env.MONGO_APP_DB_NAME).collection('tbl_user');
const q = { user_group_id: { $in: [12, '12'] } };
const all = await U.find(q, { projection: { _id: 1, is_active: 1 } }).toArray();
const active = all.filter((u) => Number(u.is_active ?? 1) === 1);
console.log(`db ${process.env.MONGO_APP_DB_NAME} — ${apply ? 'APPLY' : 'dry run'}: ${all.length} CRM agent login(s), ${active.length} active${active.length ? ` (records …${active.map((u) => String(u._id).slice(-6)).join(', …')})` : ''}`);
if (apply && active.length) {
  const r = await U.updateMany({ _id: { $in: active.map((u) => u._id) } }, { $set: { is_active: 0, deactivated_at: new Date().toISOString(), deactivated_reason: 'CRM removed 2026-10-14 (chats in WACTO)' } });
  console.log(`deactivated ${r.modifiedCount}`);
} else if (!apply) console.log('dry run — add --apply to write');
await client.close();
