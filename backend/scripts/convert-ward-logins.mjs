// One-off: convert the old "ward login" accounts (user_group_id 6) into booth-plan
// candidate accounts (user_group_id 11). Decided 2026-10-11: ward (street-level) data
// is not available yet, so customers buy booth plans only; ward number and local body
// stay on the profile as information.
//
//   node scripts/convert-ward-logins.mjs            # dry run: lists what would change
//   node scripts/convert-ward-logins.mjs --apply    # writes the change
//
// Run from backend/ with the .env loaded (MONGO_APP_URL, MONGO_APP_DB_NAME).
// Needs Ram's go before running on the server. Nothing is deleted; booths, paid
// status, passcodes and ward_id are kept.
import 'dotenv/config';
import { MongoClient } from 'mongodb';

const APPLY = process.argv.includes('--apply');
const { MONGO_APP_URL, MONGO_APP_DB_NAME } = process.env;
if (!MONGO_APP_URL || !MONGO_APP_DB_NAME) { console.error('MONGO_APP_URL / MONGO_APP_DB_NAME missing'); process.exit(1); }

const client = new MongoClient(MONGO_APP_URL, { serverSelectionTimeoutMS: 8000 });
await client.connect();
const db = client.db(MONGO_APP_DB_NAME);
const users = db.collection('tbl_user');

const wards = await users.find({ user_group_id: 6 }).project({ first_name: 1, mobile_no: 1, ward_id: 1, booths: 1, paid_status: 1, is_user_login: 1, district_id: 1, category_name: 1 }).toArray();
console.log(`${wards.length} ward login(s) (group 6)${APPLY ? ' — applying' : ' — dry run, add --apply to write'}`);
for (const w of wards) {
  const booths = Array.isArray(w.booths) ? w.booths.length : 0;
  console.log(`  ${String(w._id)}  ${w.first_name || '-'}  ${w.mobile_no || '-'}  ward ${w.ward_id ?? '-'}  ${w.district_id || ''}/${w.category_name || ''}  booths ${booths}  paid ${w.paid_status || 'No'}${w.is_user_login ? '  (sub-login)' : ''}`);
}

if (APPLY && wards.length) {
  const now = new Date().toISOString();
  const r = await users.updateMany(
    { user_group_id: 6 },
    { $set: { user_group_id: 11, converted_from_ward: true, converted_at: now, updated_at: now } },
  );
  console.log(`updated ${r.modifiedCount} account(s) to group 11 (booth-plan candidate)`);
}
await client.close();
