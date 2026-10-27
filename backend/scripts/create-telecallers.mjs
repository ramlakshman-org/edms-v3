import bcrypt from 'bcryptjs';
import { connectDbs, getAppDb, closeDbs } from '../src/config/db.js';
import { ROLES } from '../src/constants/roles.js';

const TELECALLERS = [
  {
    name: 'Abinaya M',
    first_name: 'Abinaya',
    last_name: 'M',
    username: 'abinaya',
    mobile: '9000000102',
    passcode: '123456',
    telecmi_id: '9002',
  },
  {
    name: 'Yuvasri',
    first_name: 'Yuvasri',
    last_name: '',
    username: 'yuvasri',
    mobile: '9000000103',
    passcode: '123456',
    telecmi_id: '9003',
  },
  {
    name: 'Omsree',
    first_name: 'Omsree',
    last_name: '',
    username: 'omsree',
    mobile: '9000000104',
    passcode: '123456',
    telecmi_id: '9004',
  },
  {
    name: 'Sathiya Priya I',
    first_name: 'Sathiya Priya',
    last_name: 'I',
    username: 'sathiyapriya',
    mobile: '9000000105',
    passcode: '123456',
    telecmi_id: '9005',
  },
  {
    name: 'A. Vedha Priya',
    first_name: 'Vedha Priya',
    last_name: 'A',
    username: 'vedhapriya',
    mobile: '9000000106',
    passcode: '123456',
    telecmi_id: '9006',
  },
];

async function run() {
  await connectDbs();
  const db = getAppDb();
  console.log('Connected to App DB.');

  const topUser = await db.collection('tbl_user').find({}).sort({ id: -1 }).limit(1).next();
  let nextId = topUser?.id ? Number(topUser.id) + 1 : 25000;

  for (const t of TELECALLERS) {
    const hash = await bcrypt.hash(t.passcode, 10);
    const existing = await db.collection('tbl_user').findOne({
      $or: [{ user_name: t.username }, { mobile_no: t.mobile }],
    });

    if (existing) {
      await db.collection('tbl_user').updateOne(
        { _id: existing._id },
        {
          $set: {
            first_name: t.first_name,
            last_name: t.last_name,
            name: t.name,
            user_name: t.username,
            mobile_no: t.mobile,
            password: hash,
            password_str: t.passcode,
            user_group_id: ROLES.CRM_AGENT,
            group_id: ROLES.CRM_AGENT,
            is_active: 1,
            status: 1,
            telecmi_id: t.telecmi_id,
            updated_at: new Date().toISOString(),
          },
        }
      );
      console.log(`[UPDATED] ${t.name} -> Username: ${t.username} | Mobile: ${t.mobile} | Passcode: ${t.passcode}`);
    } else {
      const doc = {
        id: nextId++,
        uuid: `crm_agent_${Date.now()}_${t.username}`,
        user_group_id: ROLES.CRM_AGENT,
        group_id: ROLES.CRM_AGENT,
        first_name: t.first_name,
        last_name: t.last_name,
        name: t.name,
        user_name: t.username,
        mobile_no: t.mobile,
        email: `${t.username}@edm.local`,
        password: hash,
        password_str: t.passcode,
        telecmi_id: t.telecmi_id,
        is_active: 1,
        status: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await db.collection('tbl_user').insertOne(doc);
      console.log(`[CREATED] ${t.name} -> Username: ${t.username} | Mobile: ${t.mobile} | Passcode: ${t.passcode}`);
    }
  }

  await closeDbs();
  console.log('Finished creating telecaller logins.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
