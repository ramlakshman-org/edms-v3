// Ram, 2026-10-14: one candidate account per mobile number, enforced by the database as well as the register code.
// Creates the unique index uniq_candidate_mobile on tbl_user.mobile_no for candidate logins (user_group_id 11, the only
// accounts the public form creates). Booth/assembly logins (groups 3, 4) store generated usernames in mobile_no and are
// left out. Refuses to run if duplicates already exist. Prints counts only (no numbers).
//   node scripts/ensure-unique-candidate-mobile.mjs            dry run
//   node scripts/ensure-unique-candidate-mobile.mjs --apply    create the index
// Undo: db.tbl_user.dropIndex('uniq_candidate_mobile')
import 'dotenv/config';
import { MongoClient } from 'mongodb';

const apply = process.argv.includes('--apply');
const NAME = 'uniq_candidate_mobile';
const client = new MongoClient(process.env.MONGO_APP_URL);
await client.connect();
const U = client.db(process.env.MONGO_APP_DB_NAME).collection('tbl_user');
const asString = await U.countDocuments({ user_group_id: '11' });
const dups = await U.aggregate([{ $match: { user_group_id: 11 } }, { $group: { _id: '$mobile_no', n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]).toArray();
const have = (await U.indexes()).some((i) => i.name === NAME);
console.log(`db ${process.env.MONGO_APP_DB_NAME} — ${apply ? 'APPLY' : 'dry run'}: candidate logins ${await U.countDocuments({ user_group_id: 11 })}, stored with the group as text ${asString}, duplicate numbers ${dups.length}, index ${have ? 'already there' : 'not there'}`);
if (dups.length) { console.log('STOP: duplicates exist — resolve them first'); process.exitCode = 1; }
else if (apply && !have) { await U.createIndex({ mobile_no: 1 }, { name: NAME, unique: true, partialFilterExpression: { user_group_id: 11 } }); console.log(`created ${NAME}`); }
else if (!apply) console.log('dry run — add --apply to create the index');
await client.close();
