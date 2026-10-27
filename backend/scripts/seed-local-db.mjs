import { MongoClient, ObjectId } from 'mongodb';
import bcrypt from 'bcryptjs';

const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017';
const APP_DB_NAME = 'election_app_local';
const VOTER_DB_NAME = 'edm_voter_db';

const DISTRICTS = [
  'Ariyalur', 'Chengalpattu', 'Chennai', 'Coimbatore', 'Cuddalore', 'Dharmapuri',
  'Dindigul', 'Erode', 'Kallakurichi', 'Kanyakumari', 'Karur', 'Krishnagiri',
  'Madurai', 'Mayiladuthurai', 'Nagapattinam', 'Namakkal', 'Nilgiris', 'Perambalur',
  'Pudukkottai', 'Ramanathapuram', 'Ranipet', 'Salem', 'Sivaganga', 'Tenkasi',
  'Thanjavur', 'Theni', 'Thoothukudi', 'Tiruchirappalli', 'Tirunelveli', 'Tirupathur',
  'Tiruppur', 'Tiruvallur', 'Tiruvannamalai', 'Tiruvarur', 'Vellore', 'Viluppuram',
  'Virudhunagar'
];

const ASSEMBLY_NAMES = [
  'Gummidipoondi', 'Ponneri', 'Tiruttani', 'Thiruvallur', 'Poonamallee', 'Avadi',
  'Maduravoyal', 'Ambattur', 'Madavaram', 'Thiruvottiyur', 'Dr. Radhakrishnan Nagar',
  'Perambur', 'Kolathur', 'Villivakkam', 'Thiru-Vi-Ka-Nagar', 'Egmore', 'Royapuram',
  'Harbour', 'Chepauk-Thiruvallikeni', 'Thousand Lights', 'Anna Nagar', 'Virugambakkam',
  'Saidapet', 'T. Nagar', 'Mylapore', 'Velachery', 'Shozhinganallur', 'Alandur',
  'Sriperumbudur', 'Tambaram', 'Pallavaram', 'Chengalpattu', 'Salem (North)', 'Salem (South)',
  'Salem (West)', 'Coimbatore (North)', 'Coimbatore (South)', 'Singanallur', 'Madurai Central',
  'Madurai North', 'Madurai South', 'Madurai West', 'Tirunelveli', 'Palayamkottai'
];

async function seed() {
  console.log(`[seed] Connecting to local MongoDB at ${MONGO_URL}...`);
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  console.log('[seed] Connected successfully.');

  const appDb = client.db(APP_DB_NAME);
  const voterDb = client.db(VOTER_DB_NAME);

  // 1. Seed tbl_assembly_consitituency (234 assemblies)
  console.log('[seed] Seeding 234 assemblies in tbl_assembly_consitituency...');
  await appDb.collection('tbl_assembly_consitituency').deleteMany({});
  const assemblies = [];
  for (let i = 1; i <= 234; i++) {
    const dIdx = (i - 1) % DISTRICTS.length;
    const name = ASSEMBLY_NAMES[i - 1] || `Assembly ${i}`;
    const total = 220000 + ((i * 7919) % 50000);
    const male = Math.floor(total * 0.49);
    const female = Math.floor(total * 0.505);
    const other = total - male - female;
    assemblies.push({
      assembly_no: i,
      assembly_name: name,
      district: DISTRICTS[dIdx],
      total_voters: total,
      male_voters: male,
      female_voters: female,
      third_gender_voters: other,
      other_voters: other,
      booth_count: 180 + (i % 60),
    });
  }
  await appDb.collection('tbl_assembly_consitituency').insertMany(assemblies);

  // 2. Seed tbl_user (Admin, Telecallers, Candidates)
  console.log('[seed] Seeding users in tbl_user...');
  await appDb.collection('tbl_user').deleteMany({});
  
  const adminPasswordHash = await bcrypt.hash('admin123', 10);
  const legacyPasswordHash = await bcrypt.hash('UL5-q9SmiZLcSp9l', 10);
  const userPasswordHash = await bcrypt.hash('123456', 10);

  const priyaId = new ObjectId('6a673255d4c4eb6238a75f31');
  const arunId = new ObjectId('6a673255d4c4eb6238a75f32');
  const kavithaId = new ObjectId('6a673255d4c4eb6238a75f33');

  const users = [
    // Super Admins
    {
      _id: new ObjectId(),
      id: 1,
      user_name: 'admin',
      mobile_no: 'admin',
      email: 'admin@edms.online',
      password: adminPasswordHash,
      password_str: 'admin123',
      group_id: 1,
      user_group_id: 1,
      status: 1,
      is_active: 1,
      first_name: 'Super',
      last_name: 'Admin',
      name: 'Super Admin',
      created_at: new Date('2026-01-01T00:00:00Z'),
    },
    {
      _id: new ObjectId(),
      id: 2,
      user_name: 'admin_legacy',
      mobile_no: 'admin_legacy',
      password: legacyPasswordHash,
      password_str: 'UL5-q9SmiZLcSp9l',
      group_id: 1,
      user_group_id: 1,
      status: 1,
      is_active: 1,
      first_name: 'Admin',
      last_name: 'Droplet',
      name: 'Admin Droplet',
      created_at: new Date('2026-01-01T00:00:00Z'),
    },
    // Telecallers (group_id = 12)
    {
      _id: priyaId,
      id: 101,
      user_name: 'priya.crm',
      mobile_no: '9000000101',
      email: 'priya@edms.online',
      password: userPasswordHash,
      password_str: '123456',
      group_id: 12,
      user_group_id: 12,
      status: 1,
      is_active: 1,
      first_name: 'Priya',
      last_name: 'Murugan',
      name: 'Priya Murugan',
      telecmi_id: '9001',
      telecmi_password: 'pass_priya_crm',
      created_at: new Date('2026-09-01T00:00:00Z'),
    },
    {
      _id: arunId,
      id: 102,
      user_name: 'arun.crm',
      mobile_no: '9000000102',
      email: 'arun@edms.online',
      password: userPasswordHash,
      password_str: '123456',
      group_id: 12,
      user_group_id: 12,
      status: 1,
      is_active: 1,
      first_name: 'Arun',
      last_name: 'Kumar',
      name: 'Arun Kumar',
      telecmi_id: '9002',
      telecmi_password: 'pass_arun_crm',
      created_at: new Date('2026-09-01T00:00:00Z'),
    },
    {
      _id: kavithaId,
      id: 103,
      user_name: 'kavitha.crm',
      mobile_no: '9000000103',
      email: 'kavitha@edms.online',
      password: userPasswordHash,
      password_str: '123456',
      group_id: 12,
      user_group_id: 12,
      status: 1,
      is_active: 1,
      first_name: 'Kavitha',
      last_name: 'Rajan',
      name: 'Kavitha Rajan',
      telecmi_id: '9003',
      telecmi_password: 'pass_kavitha_crm',
      created_at: new Date('2026-09-01T00:00:00Z'),
    },
    // Candidate accounts (group_id = 11, 6)
    {
      _id: new ObjectId(),
      id: 201,
      user_name: 'selvi.candidate',
      mobile_no: '9000000012',
      password: userPasswordHash,
      password_str: '123456',
      group_id: 11,
      user_group_id: 11,
      status: 1,
      is_active: 1,
      first_name: 'Selvi',
      last_name: 'Karthik',
      name: 'Selvi Karthik',
      paid_status: 'Yes',
      district: 'Salem',
      assembly_id: '33',
      booths: [3, 7, 11, 18, 24],
      position: 'Town Panchayat Councillor',
      created_at: new Date('2026-08-15T00:00:00Z'),
    },
    {
      _id: new ObjectId(),
      id: 202,
      user_name: 'murugan.candidate',
      mobile_no: '9000000011',
      password: userPasswordHash,
      password_str: '123456',
      group_id: 6,
      user_group_id: 6,
      status: 1,
      is_active: 1,
      first_name: 'Murugan',
      last_name: 'Palanisamy',
      name: 'Murugan Palanisamy',
      paid_status: 'No',
      district: 'Salem',
      assembly_id: '33',
      booths: [12, 15, 20],
      position: 'Village Panchayat President',
      created_at: new Date('2026-08-16T00:00:00Z'),
    }
  ];
  await appDb.collection('tbl_user').insertMany(users);

  // 3. Seed tbl_crm_settings
  console.log('[seed] Seeding CRM settings in tbl_crm_settings...');
  await appDb.collection('tbl_crm_settings').deleteMany({});
  await appDb.collection('tbl_crm_settings').insertMany([
    {
      _id: 'crm_settings',
      key: 'crm_settings',
      claim_unassigned: true,
      round_robin: { enabled: true, last_agent_id: String(priyaId) },
      telecmi_rr: { last_agent_id: String(arunId) },
      updated_at: new Date(),
    },
    {
      _id: 'round_robin',
      last_agent_id: String(priyaId),
    },
    {
      _id: 'telecmi_rr',
      last_agent_id: String(arunId),
    }
  ]);

  // 4. Seed tbl_enquiry (Registrations / Candidate leads)
  console.log('[seed] Seeding 50 enquiries in tbl_enquiry...');
  await appDb.collection('tbl_enquiry').deleteMany({});
  const enquiries = [];
  const rolesList = ['Village Panchayat President', 'Town Panchayat', 'Municipality', 'Corporation', 'Panchayat Union Ward Member'];
  for (let i = 1; i <= 50; i++) {
    const mob = `984000${String(1000 + i).slice(-4)}`;
    const dist = DISTRICTS[i % DISTRICTS.length];
    const asmNo = (i % 44) + 1;
    enquiries.push({
      _id: new ObjectId(),
      id: i,
      full_name: `Candidate ${i} (${dist})`,
      mobile: mob,
      district: dist,
      position: rolesList[i % rolesList.length],
      assembly_id: String(asmNo),
      assembly_name: ASSEMBLY_NAMES[asmNo - 1] || `Assembly ${asmNo}`,
      booths: [1 + (i % 15), 2 + (i % 15), 3 + (i % 15)],
      booth_count: 3,
      passcode: `${100000 + i}`,
      paid_status: i % 4 === 0 ? 'Yes' : 'No',
      source: i % 2 === 0 ? 'whatsapp_bot' : 'web',
      created_at: new Date(Date.now() - i * 3600 * 1000 * 8).toISOString(),
    });
  }
  await appDb.collection('tbl_enquiry').insertMany(enquiries);

  // 5. Seed tbl_crm_conversation and tbl_crm_message (Shared Inbox & CRM Leads)
  console.log('[seed] Seeding conversations & messages...');
  await appDb.collection('tbl_crm_conversation').deleteMany({});
  await appDb.collection('tbl_crm_message').deleteMany({});

  const sampleLeads = [
    {
      mobile: '9840001001',
      name: 'Karthik Raman',
      status: 'interested',
      agent: { id: String(priyaId), name: 'Priya Murugan' },
      district: 'Chennai',
      assembly: 'Mylapore',
      position: 'Corporation Councillor',
      notes: 'Very interested in booth 14-18 analytics. Requested demo call tomorrow.',
      history: [
        { status: 'contacted', at: new Date(Date.now() - 864e5 * 2).toISOString(), by: 'Priya Murugan', notes: 'First WhatsApp contact.' },
        { status: 'first_call_complete', at: new Date(Date.now() - 864e5).toISOString(), by: 'Priya Murugan', notes: 'Spoke for 4 mins.', recording: 'sample_rec_01.mp3' },
        { status: 'interested', at: new Date(Date.now() - 3600e3 * 4).toISOString(), by: 'Priya Murugan', notes: 'Wants pro package.' }
      ],
      messages: [
        { direction: 'incoming', body: 'Vanakkam, I saw your election voter management portal demo.', at: 864e5 * 2 },
        { direction: 'outgoing', body: 'Vanakkam Karthik sir! Welcome to EDMS Civic Ops. Which assembly are you contesting in?', at: 864e5 * 2 - 300000 },
        { direction: 'incoming', body: 'Chennai Mylapore AC. Can we get voter list segmented by booth?', at: 864e5 * 2 - 600000 },
        { type: 'call', direction: 'outgoing', body: 'Outgoing call answered (245s)', metadata: { recording: 'sample_rec_01.mp3', answeredsec: 245 }, at: 864e5 },
        { direction: 'incoming', body: 'Thanks for explaining. Please share the payment QR code.', at: 3600e3 * 3 },
      ]
    },
    {
      mobile: '9840001002',
      name: 'S. Meena Devi',
      status: 'contacted',
      agent: { id: String(arunId), name: 'Arun Kumar' },
      district: 'Salem',
      assembly: 'Salem (North)',
      position: 'Town Panchayat',
      notes: 'Asked to call back on Wednesday afternoon after local party meeting.',
      history: [
        { status: 'contacted', at: new Date(Date.now() - 864e5 * 3).toISOString(), by: 'Arun Kumar', notes: 'Intro message sent.' },
        { status: 'call_back', at: new Date(Date.now() - 864e5).toISOString(), by: 'Arun Kumar', notes: 'Busy right now.' }
      ],
      messages: [
        { direction: 'incoming', body: 'Hello, need details for Salem North booths 7, 8, 9.', at: 864e5 * 3 },
        { direction: 'outgoing', body: 'Hello Meena maam, Arun here from EDMS. When is a good time to call you?', at: 864e5 * 3 - 200000 },
        { type: 'call', direction: 'outgoing', body: 'Outgoing call answered (38s)', metadata: { answeredsec: 38 }, at: 864e5 },
        { direction: 'incoming', body: 'In meeting now, please call back on Wednesday afternoon.', at: 864e5 - 50000 },
      ]
    },
    {
      mobile: '9840001003',
      name: 'Murugan Velu',
      status: 'first_call_complete',
      agent: { id: String(priyaId), name: 'Priya Murugan' },
      district: 'Madurai',
      assembly: 'Madurai Central',
      position: 'Village Panchayat President',
      notes: 'First call complete. Sent sample PDF booth report.',
      history: [
        { status: 'contacted', at: new Date(Date.now() - 864e5 * 4).toISOString(), by: 'Priya Murugan', notes: 'Lead initiated via bot.' },
        { status: 'first_call_complete', at: new Date(Date.now() - 864e5 * 2).toISOString(), by: 'Priya Murugan', notes: 'Detailed walk-through.', recording: 'sample_rec_02.mp3' }
      ],
      messages: [
        { direction: 'incoming', body: 'Start registration', at: 864e5 * 4 },
        { direction: 'outgoing', body: 'Welcome to EDMS! Let us know how we can assist your campaign.', at: 864e5 * 4 - 60000 },
        { type: 'call', direction: 'outgoing', body: 'Voice call answered (182s)', metadata: { recording: 'sample_rec_02.mp3', answeredsec: 182 }, at: 864e5 * 2 },
      ]
    },
    {
      mobile: '9840001004',
      name: 'Deepa Rajendran',
      status: 'switch_off',
      agent: { id: String(kavithaId), name: 'Kavitha Rajan' },
      district: 'Coimbatore',
      assembly: 'Coimbatore (South)',
      position: 'Municipality',
      notes: 'Phone switched off on 2 attempts.',
      history: [
        { status: 'contacted', at: new Date(Date.now() - 864e5 * 5).toISOString(), by: 'Kavitha Rajan', notes: 'Initial bot lead.' },
        { status: 'switch_off', at: new Date(Date.now() - 864e5 * 2).toISOString(), by: 'Kavitha Rajan', notes: 'Switched off.' },
        { status: 'switch_off', at: new Date(Date.now() - 3600e3 * 6).toISOString(), by: 'Kavitha Rajan', notes: 'Still unreachable.' }
      ],
      messages: [
        { direction: 'incoming', body: 'I want election candidate login', at: 864e5 * 5 },
        { type: 'call', direction: 'outgoing', body: 'Call not connected (missed)', metadata: { answeredsec: 0 }, at: 864e5 * 2 },
        { type: 'call', direction: 'outgoing', body: 'Call not connected (missed)', metadata: { answeredsec: 0 }, at: 3600e3 * 6 },
      ]
    },
    {
      mobile: '9840001005',
      name: 'Senthilkumar N',
      status: 'interested',
      agent: { id: String(arunId), name: 'Arun Kumar' },
      district: 'Tiruchirappalli',
      assembly: 'Thiruverumbur',
      position: 'Panchayat Union Ward Member',
      notes: 'Ready to pay. Requested UPI ID.',
      history: [
        { status: 'contacted', at: new Date(Date.now() - 864e5 * 3).toISOString(), by: 'Arun Kumar', notes: 'Lead claimed.' },
        { status: 'first_call_complete', at: new Date(Date.now() - 864e5 * 2).toISOString(), by: 'Arun Kumar', notes: 'Walked through portal.' },
        { status: 'interested', at: new Date(Date.now() - 864e5).toISOString(), by: 'Arun Kumar', notes: 'Confirmed payment readiness.' }
      ],
      messages: [
        { direction: 'incoming', body: 'Can we send voice broadcasts to our voters?', at: 864e5 * 3 },
        { direction: 'outgoing', body: 'Yes sir, voice IVR broadcast and WhatsApp reports are both available.', at: 864e5 * 3 - 100000 },
        { type: 'call', direction: 'outgoing', body: 'Outgoing call answered (310s)', metadata: { answeredsec: 310 }, at: 864e5 * 2 },
        { direction: 'incoming', body: 'Great, sending payment via UPI now.', at: 864e5 },
      ]
    },
    {
      mobile: '9840001006',
      name: 'Anitha Soundar',
      status: 'none',
      agent: null, // UNASSIGNED!
      district: 'Dindigul',
      assembly: 'Dindigul',
      position: 'Village Panchayat President',
      notes: '',
      history: [],
      messages: [
        { direction: 'incoming', body: 'Hi, I registered on the portal. Please assign a coordinator.', at: 3600e3 * 2 }
      ]
    },
    {
      mobile: '9840001007',
      name: 'Ganesh Moorthy',
      status: 'not_answered',
      agent: null, // UNASSIGNED!
      district: 'Tirunelveli',
      assembly: 'Palayamkottai',
      position: 'Municipality Councillor',
      notes: 'Unassigned lead from website form.',
      history: [],
      messages: [
        { direction: 'incoming', body: 'Need demo of mobile app for booth workers.', at: 3600e3 * 5 }
      ]
    },
    {
      mobile: '9840001008',
      name: 'Rajesh Kannan',
      status: 'call_back',
      agent: { id: String(priyaId), name: 'Priya Murugan' },
      district: 'Thanjavur',
      assembly: 'Thanjavur',
      position: 'Corporation',
      notes: 'Call back at 6 PM.',
      history: [
        { status: 'contacted', at: new Date(Date.now() - 864e5).toISOString(), by: 'Priya Murugan', notes: 'Inquired about voter list.' },
        { status: 'call_back', at: new Date(Date.now() - 3600e3 * 2).toISOString(), by: 'Priya Murugan', notes: 'Will discuss with election agent.' }
      ],
      messages: [
        { direction: 'incoming', body: 'What is the price for 5 booths?', at: 864e5 },
        { direction: 'outgoing', body: 'It is Rs 5,000 + GST for up to 5 booths complete voter slip + CRM access.', at: 864e5 - 200000 },
        { direction: 'incoming', body: 'Please call me at 6 PM today.', at: 3600e3 * 2 }
      ]
    }
  ];

  for (const item of sampleLeads) {
    const lastMsg = item.messages[item.messages.length - 1];
    const convDoc = {
      _id: new ObjectId(),
      clean_mobile: item.mobile,
      contact_name: item.name,
      district: item.district,
      assembly: item.assembly,
      position: item.position,
      lead_status: item.status,
      assigned_agent_id: item.agent ? item.agent.id : null,
      assigned_agent_name: item.agent ? item.agent.name : '-',
      last_handled_by: item.agent ? item.agent.name : null,
      taken: false,
      unread_count: item.agent ? 0 : 1,
      last_message: lastMsg ? (lastMsg.type === 'call' ? 'Voice call' : lastMsg.body) : '',
      last_message_at: new Date(Date.now() - (lastMsg?.at || 0)),
      last_inbound_at: new Date(Date.now() - 3600e3 * 2).toISOString(),
      window_active: true,
      window_hours: 24,
      window_expires_at: new Date(Date.now() + 22 * 3600e3).toISOString(),
      window_source: 'direct',
      agent_notes: item.notes,
      status_history: item.history,
      created_at: new Date(Date.now() - 864e5 * 5),
      updated_at: new Date(),
    };
    await appDb.collection('tbl_crm_conversation').insertOne(convDoc);

    for (let mIdx = 0; mIdx < item.messages.length; mIdx++) {
      const msg = item.messages[mIdx];
      await appDb.collection('tbl_crm_message').insertOne({
        _id: new ObjectId(),
        clean_mobile: item.mobile,
        direction: msg.direction || 'incoming',
        type: msg.type || 'text',
        body: msg.body || '',
        metadata: msg.metadata || {},
        created_at: new Date(Date.now() - (msg.at || 0)).toISOString(),
      });
    }
  }

  // 6. Seed Payment Settings
  console.log('[seed] Seeding payment settings...');
  await appDb.collection('tbl_payment_settings').deleteMany({});
  await appDb.collection('tbl_payment_settings').insertOne({
    key: 'payment_settings',
    upi_id: 'senthilsky2301@okaxis',
    payee_name: 'Senthilkumar Nagendren',
    qr_url: 'https://res.cloudinary.com/ajp3dslc/image/upload/v1791377127/payment-qr.jpg',
    proof_mode: 'chat',
    proof_number: '917092800426',
    bot_number: '917904759268',
    support_phone: '+91 79047 59268',
    activation_minutes: 30,
    gst_rate: 18,
    tiers: [
      { max_booths: 1, base: 2000, label: '1 booth' },
      { max_booths: 5, base: 5000, label: '2–5 booths' },
      { max_booths: 10, base: 10000, label: '6–10 booths' },
      { max_booths: 25, base: 25000, label: '11–25 booths' },
      { max_booths: 100, base: 50000, label: '26–100 booths' }
    ],
    updated_at: new Date(),
  });

  // 7. Seed sample voters in edm_voter_db (ass_1 and ass_33)
  console.log('[seed] Seeding sample voters in edm_voter_db (ass_1, ass_33)...');
  await voterDb.collection('ass_1').deleteMany({});
  await voterDb.collection('ass_33').deleteMany({});
  
  const sampleVoters = [];
  const tamilNames = ['முருகன்', 'கார்த்திக்', 'ராஜேஷ்', 'செந்தில்', 'சரவணன்', 'செல்வி', 'கவிதா', 'பிரியா', 'தீபா', 'மீனா'];
  const englishNames = ['Murugan K', 'Karthik S', 'Rajesh P', 'Senthil N', 'Saravanan M', 'Selvi R', 'Kavitha A', 'Priya T', 'Deepa V', 'Meena G'];
  
  for (let i = 1; i <= 100; i++) {
    sampleVoters.push({
      ID: i,
      EPIC_NO: `TAU${1000000 + i}`,
      ASSEMBLY_NO: 1,
      ASSEMBLY_NAME: 'Gummidipoondi',
      PART_NO: 1 + Math.floor(i / 20),
      SLNO: i,
      SECTION_NO: 1,
      SECTION_NAME: 'Gandhi Street',
      VOTER_NAME_EN: englishNames[i % 10],
      VOTER_NAME: tamilNames[i % 10],
      RELATION_TYPE: 'F',
      RELATION_NAME_EN: 'Perumal',
      AGE: 20 + (i % 55),
      GENDER: i % 2 === 0 ? 'Female' : 'Male',
      MOBILE_NUMBER: `98400${String(10000 + i).slice(-5)}`,
      HOUSE_NO: `${1 + (i % 40)}`,
      POLLING_STATION_EN: 'Panchayat Union Primary School',
      DISTRICT: 'Tiruvallur',
    });
  }
  await voterDb.collection('ass_1').insertMany(sampleVoters);
  await voterDb.collection('ass_33').insertMany(sampleVoters.map(v => ({ ...v, ASSEMBLY_NO: 33, ASSEMBLY_NAME: 'Salem (North)', DISTRICT: 'Salem' })));

  await voterDb.collection('ass_1').createIndex({ PART_NO: 1, SECTION_NO: 1 });
  await voterDb.collection('ass_1').createIndex({ EPIC_NO: 1 });
  await voterDb.collection('ass_33').createIndex({ PART_NO: 1, SECTION_NO: 1 });
  await voterDb.collection('ass_33').createIndex({ EPIC_NO: 1 });

  console.log('[seed] Local databases populated successfully!');
  await client.close();
}

seed().catch((err) => {
  console.error('[seed error]:', err);
  process.exit(1);
});
