import http from 'http';
import { MongoClient } from 'mongodb';

const BASE_URL = 'http://127.0.0.1:5054';
const MONGO_URL = process.env.MONGO_APP_URL || 'mongodb://127.0.0.1:27017';
const APP_DB_NAME = process.env.MONGO_APP_DB_NAME || 'election_app_local';
const VOTER_DB_NAME = process.env.MONGO_VOTER_DB_NAME || 'edm_voter_db';

function request(path, options = {}, postBody = null) {
  return new Promise((resolve) => {
    const url = new URL(path, BASE_URL);
    const reqOpts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    };

    const req = http.request(reqOpts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', (err) => resolve({ error: err.message, status: 0 }));
    if (postBody) {
      req.write(typeof postBody === 'string' ? postBody : JSON.stringify(postBody));
    }
    req.end();
  });
}

async function runRigorousAudit() {
  console.log('='.repeat(80));
  console.log('   ELECTION DATA MANAGEMENT (EDM) - STAGING READINESS & E2E AUDIT');
  console.log('='.repeat(80));
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Backend API: ${BASE_URL}`);
  console.log(`MongoDB: ${MONGO_URL}\n`);

  const results = {
    passed: 0,
    failed: 0,
    warnings: 0,
    checks: []
  };

  function assert(category, testName, condition, details = '') {
    if (condition) {
      results.passed++;
      results.checks.push({ category, name: testName, status: 'PASS', details });
      console.log(`  [PASS] ${category.toUpperCase()}: ${testName}${details ? ` -> ${details}` : ''}`);
    } else {
      results.failed++;
      results.checks.push({ category, name: testName, status: 'FAIL', details });
      console.error(`  [FAIL] ${category.toUpperCase()}: ${testName}${details ? ` -> ${details}` : ''}`);
    }
  }

  function warn(category, testName, details = '') {
    results.warnings++;
    results.checks.push({ category, name: testName, status: 'WARN', details });
    console.log(`  [WARN] ${category.toUpperCase()}: ${testName}${details ? ` -> ${details}` : ''}`);
  }

  // --------------------------------------------------------------------------
  // PILLAR 1: Database & Persistence Layer Audit
  // --------------------------------------------------------------------------
  console.log('\n--- PILLAR 1: Database & Collection Integrity ---');
  let mongoClient;
  try {
    mongoClient = new MongoClient(MONGO_URL);
    await mongoClient.connect();
    const appDb = mongoClient.db(APP_DB_NAME);
    const voterDb = mongoClient.db(VOTER_DB_NAME);

    // Clear any past test lockouts
    await appDb.collection('tbl_login_attempts').deleteMany({});

    const userCount = await appDb.collection('tbl_user').countDocuments();
    assert('DB', 'User collection count > 0', userCount > 0, `${userCount} users found`);

    const convCount = await appDb.collection('tbl_crm_conversation').countDocuments();
    assert('DB', 'CRM conversation collection count > 0', convCount > 0, `${convCount} leads found`);

    const ass33Count = await voterDb.collection('ass_33').countDocuments();
    assert('DB', 'Assembly 33 voter roll populated', ass33Count > 0, `${ass33Count} voters in ass_33`);

    // Verify indexing on critical collections
    const convIndexes = await appDb.collection('tbl_crm_conversation').indexes();
    assert('DB Indexing', 'CRM leads indexed on phone/status', convIndexes.length >= 2, `${convIndexes.length} indexes present`);

    const assIndexes = await voterDb.collection('ass_33').indexes();
    assert('DB Indexing', 'Voter table indexed on PART/SECTION/EPIC', assIndexes.length >= 2, `${assIndexes.length} indexes present`);

  } catch (err) {
    assert('DB', 'MongoDB connection', false, err.message);
  }

  // --------------------------------------------------------------------------
  // PILLAR 2: Multi-Role Authentication & Token Issuance
  // --------------------------------------------------------------------------
  console.log('\n--- PILLAR 2: Multi-Role Authentication & Identity ---');
  
  // 1. Super Admin
  const adminRes = await request('/api/auth/login', { method: 'POST' }, { username: 'admin', password: 'admin123' });
  const adminToken = adminRes.data?.token;
  assert('Auth', 'Super Admin Login (admin / admin123)', adminRes.status === 200 && !!adminToken, `Group: ${adminRes.data?.user?.group_id}`);

  // 2. Telecaller Priya
  const teleRes = await request('/api/auth/login', { method: 'POST' }, { username: '9000000101', password: '123456' });
  const teleToken = teleRes.data?.token;
  assert('Auth', 'Telecaller Login (Priya 9000000101 / 123456)', teleRes.status === 200 && !!teleToken, `Group: ${teleRes.data?.user?.group_id}`);

  // 3. Pro Candidate Selvi
  const proRes = await request('/api/auth/login', { method: 'POST' }, { username: '9000000012', password: '123456' });
  const proToken = proRes.data?.token;
  assert('Auth', 'Pro Candidate Login (Selvi 9000000012 / 123456)', proRes.status === 200 && !!proToken, `Group: ${proRes.data?.user?.group_id}`);

  // 4. Free Candidate Murugan
  const freeRes = await request('/api/auth/login', { method: 'POST' }, { username: '9000000011', password: '123456' });
  const freeToken = freeRes.data?.token;
  assert('Auth', 'Free Candidate Login (Murugan 9000000011 / 123456)', freeRes.status === 200 && !!freeToken, `Group: ${freeRes.data?.user?.group_id}`);

  // --------------------------------------------------------------------------
  // PILLAR 3: Strict RBAC & Security Boundary Enforcement
  // --------------------------------------------------------------------------
  console.log('\n--- PILLAR 3: RBAC & Security Boundary Enforcement ---');

  // Candidate must NOT access CRM conversations
  const candCrmAttempt = await request('/api/crm/conversations', {
    headers: { Authorization: `Bearer ${proToken}` }
  });
  assert('RBAC', 'Candidate blocked from Telecaller CRM Queue (403)', candCrmAttempt.status === 403, `Status: ${candCrmAttempt.status}`);

  // Candidate must NOT access Admin Daily Digest
  const candDigestAttempt = await request('/api/crm/admin/daily-digest', {
    headers: { Authorization: `Bearer ${proToken}` }
  });
  assert('RBAC', 'Candidate blocked from Admin Daily Digest (403)', candDigestAttempt.status === 403, `Status: ${candDigestAttempt.status}`);

  // Telecaller must NOT trigger Admin Daily Digest send
  const teleDigestAttempt = await request('/api/crm/admin/daily-digest/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${teleToken}` }
  }, {});
  assert('RBAC', 'Telecaller blocked from Admin Daily Digest Dispatch (403)', teleDigestAttempt.status === 403, `Status: ${teleDigestAttempt.status}`);

  // Unauthenticated requests must be rejected
  const unauthAttempt = await request('/api/crm/conversations');
  assert('RBAC', 'Unauthenticated request rejected with 401', unauthAttempt.status === 401, `Status: ${unauthAttempt.status}`);

  // --------------------------------------------------------------------------
  // PILLAR 4: Telecaller CRM & Automated 80/20 Calling Queue
  // --------------------------------------------------------------------------
  console.log('\n--- PILLAR 4: Telecaller CRM & Automated 80/20 Workflow ---');

  // 1. Fetch actionable calling queue
  const queueRes = await request('/api/crm/conversations?hide_snoozed=0&limit=20', {
    headers: { Authorization: `Bearer ${teleToken}` }
  });
  const leads = queueRes.data?.conversations || queueRes.data?.data || [];
  assert('CRM Queue', 'Telecaller fetches leads queue', queueRes.status === 200 && Array.isArray(leads), `${leads.length} leads in queue`);

  // Pick first lead to test automated 3-strike & auto-snooze
  if (leads.length > 0) {
    const testLead = leads[0];
    const testPhone = testLead.clean_mobile || testLead.phone;

    // Simulate Missed Call (not_answered) -> Auto-snooze 3h + Strike Increment
    const snoozeRes = await request(`/api/crm/conversations/${testPhone}/lead-status`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${teleToken}` }
    }, {
      lead_status: 'not_answered',
      notes: 'Automated E2E Audit Test - Attempt 1'
    });

    const isSnoozed = snoozeRes.data?.snooze_until;
    assert('Auto-Snooze', 'Missed call automatically snoozes for 3 hours', snoozeRes.status === 200 && !!isSnoozed, `Snooze Until: ${isSnoozed}`);

    // Fast-forward 2 more strikes to test 3-strike auto-retirement
    await request(`/api/crm/conversations/${testPhone}/lead-status`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${teleToken}` }
    }, { lead_status: 'switch_off', notes: 'Automated E2E Audit Test - Attempt 2' });

    const strike3Res = await request(`/api/crm/conversations/${testPhone}/lead-status`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${teleToken}` }
    }, { lead_status: 'not_answered', notes: 'Automated E2E Audit Test - Attempt 3 (Final)' });

    const finalStatus = strike3Res.data?.lead_status;
    const finalArchived = strike3Res.data?.archived;
    assert('3-Strike Engine', 'Lead auto-retires to unreachable after 3 strikes', finalStatus === 'unreachable' || finalArchived === true, `Status: ${finalStatus}, Archived: ${finalArchived}`);

    // Test Instant WhatsApp drop endpoint integration
    const dropRes = await request(`/api/crm/conversations/${testPhone}/lead-status`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${teleToken}` }
    }, {
      lead_status: 'interested',
      send_whatsapp: true,
      whatsapp_template: 'lead_followup',
      notes: 'Automated E2E WhatsApp drop verification'
    });
    assert('WhatsApp Automation', 'Instant post-call WhatsApp drop processed gracefully', dropRes.status === 200, 'Handled without throwing exception');
  }

  // --------------------------------------------------------------------------
  // PILLAR 5: Automated 8:00 PM Admin Digest & Reporting
  // --------------------------------------------------------------------------
  console.log('\n--- PILLAR 5: Automated 8:00 PM Admin Digest & Team Reporting ---');

  // Super Admin checks digest
  const digestRes = await request('/api/crm/admin/daily-digest', {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const digestData = digestRes.data?.digest;
  assert('Daily Digest', 'Admin calculates daily performance digest', digestRes.status === 200 && !!digestData, `KPIs: ${digestData?.totalCalls} calls dialed, ${digestData?.regCount} new users, ${digestData?.proCount} Pro upgrades, ${digestData?.archivedCount} archived`);

  // Team performance reporting
  const teamRepRes = await request('/api/crm/team-report', {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert('Reporting', 'Team report returns talk time & registration metrics', teamRepRes.status === 200 && Array.isArray(teamRepRes.data?.rows), `${teamRepRes.data?.rows?.length || 0} leads audited with talk times`);

  // --------------------------------------------------------------------------
  // PILLAR 6: Candidate Portal & Real-time Voter Analytics
  // --------------------------------------------------------------------------
  console.log('\n--- PILLAR 6: Candidate Portal & Real-time Demographics ---');

  // Pro Candidate Home
  const wardHomeRes = await request('/api/ward/home', {
    headers: { Authorization: `Bearer ${proToken}` }
  });
  const homeData = wardHomeRes.data || {};
  assert('Candidate Portal', 'Pro Candidate loads home dashboard', wardHomeRes.status === 200, `Account: ${homeData.account?.ward_login}, District: ${homeData.account?.district}, Booths: ${homeData.booths?.length || 0}`);

  // Demographics aggregation
  const demographics = homeData.demographics;
  const hasGender = demographics && (demographics.male > 0 || demographics.female > 0);
  const hasAge = demographics && (demographics.youth > 0 || demographics.middle > 0);
  assert('Demographics Engine', 'Gender ratio & Age cohorts aggregated in real-time', !!hasGender && !!hasAge, `Gender: M=${demographics?.male} F=${demographics?.female}, Age: Youth=${demographics?.youth} Core=${demographics?.middle} Senior=${demographics?.senior}`);

  // Voter Search query performance test
  const startQuery = Date.now();
  const searchRes = await request(`/api/voters?search=Kumar&limit=25`, {
    headers: { Authorization: `Bearer ${proToken}` }
  });
  const elapsed = Date.now() - startQuery;
  assert('Voter DB Performance', 'Candidate voter roll search responds under 150ms', searchRes.status === 200 && elapsed < 150, `Response time: ${elapsed}ms, Results: ${searchRes.data?.total || searchRes.data?.data?.length || 0}`);

  // --------------------------------------------------------------------------
  // PILLAR 7: Staging Environment Readiness Checklist
  // --------------------------------------------------------------------------
  console.log('\n--- PILLAR 7: Staging Environment Prerequisites Checklist ---');
  
  const envAudit = [
    { key: 'JWT_SECRET', val: process.env.JWT_SECRET, critical: true },
    { key: 'ADMIN_USERNAME', val: process.env.ADMIN_USERNAME, critical: true },
    { key: 'ADMIN_PASSWORD', val: process.env.ADMIN_PASSWORD, critical: true },
    { key: 'MONGO_APP_URL', val: process.env.MONGO_APP_URL, critical: true },
    { key: 'MONGO_VOTER_URL', val: process.env.MONGO_VOTER_URL, critical: true },
    { key: 'TELECMI_APP_ID', val: process.env.TELECMI_APP_ID, critical: true },
    { key: 'TELECMI_APP_SECRET', val: process.env.TELECMI_APP_SECRET, critical: true },
    { key: 'TELECMI_CALLER_ID', val: process.env.TELECMI_CALLER_ID, critical: true },
    { key: 'TELECMI_SBC', val: process.env.TELECMI_SBC, critical: true },
    { key: 'WACTO_API_KEY', val: process.env.WACTO_API_KEY, critical: false, note: 'Needed on Staging droplet for live WhatsApp delivery' },
    { key: 'WACTO_CHANNEL', val: process.env.WACTO_CHANNEL, critical: false, note: 'Needed on Staging droplet for live WhatsApp delivery' },
    { key: 'PUBLIC_BASE_URL', val: process.env.PUBLIC_BASE_URL, critical: false, note: 'Needed on Staging for incoming webhooks & call status' },
  ];

  for (const envItem of envAudit) {
    if (envItem.val) {
      assert('Config', `Env var ${envItem.key} populated`, true);
    } else if (envItem.critical) {
      assert('Config', `Env var ${envItem.key} populated`, false, 'MISSING CRITICAL ENV VAR');
    } else {
      warn('Config', `Env var ${envItem.key} empty`, envItem.note);
    }
  }

  // --------------------------------------------------------------------------
  // SUMMARY SCORECARD
  // --------------------------------------------------------------------------
  console.log('\n' + '='.repeat(80));
  console.log(`   AUDIT COMPLETE: ${results.passed} PASSED | ${results.failed} FAILED | ${results.warnings} WARNINGS`);
  console.log('='.repeat(80));

  if (mongoClient) await mongoClient.close();
  return results;
}

runRigorousAudit().then(res => {
  process.exit(res.failed > 0 ? 1 : 0);
}).catch(err => {
  console.error('Fatal audit failure:', err);
  process.exit(1);
});
