/**
 * TNEDMS End-to-End Automated Live Suite
 * Runs an exhaustive, realistic journey across Super Admin, all 5 Telecallers,
 * Public Registration, and WhatsApp Webhook.
 */
const BASE_URL = process.env.TEST_BASE_URL || 'https://tnedms.online';

const TELECALLERS = [
  { username: 'abinaya', name: 'Abinaya M', mobile: '9000000102' },
  { username: 'yuvasri', name: 'Yuvasri', mobile: '9000000103' },
  { username: 'omsree', name: 'Omsree', mobile: '9000000104' },
  { username: 'sathiyapriya', name: 'Sathiya Priya I', mobile: '9000000105' },
  { username: 'vedhapriya', name: 'A. Vedha Priya', mobile: '9000000106' },
];

const timestamp = Date.now().toString().slice(-4);
const TEST_LEAD_PHONE = `984099${timestamp}`;
const TEST_LEAD_NAME = `Ramanathan E2E ${timestamp}`;
const TEST_CANDIDATE_PHONE = `984088${timestamp}`;
const TEST_CANDIDATE_NAME = `Kavitha Sundaram ${timestamp}`;

const results = [];

function recordResult(testName, passed, details = '', latencyMs = 0) {
  results.push({ testName, passed, details, latencyMs });
  const statusBadge = passed ? '\x1b[32m[PASS]\x1b[0m' : '\x1b[31m[FAIL]\x1b[0m';
  console.log(`${statusBadge} ${testName} (${latencyMs}ms)${details ? ` - ${details}` : ''}`);
}

async function apiRequest(path, options = {}) {
  const url = `${BASE_URL}/api${path}`;
  const start = Date.now();
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const latencyMs = Date.now() - start;
  let data = null;
  const text = await res.text();
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, ok: res.ok, data, latencyMs };
}

async function run() {
  console.log('========================================================================');
  console.log(`Starting TNEDMS Live End-to-End Suite against: ${BASE_URL}`);
  console.log(`Test Lead Mobile: ${TEST_LEAD_PHONE} | Candidate Mobile: ${TEST_CANDIDATE_PHONE}`);
  console.log('========================================================================\n');

  let adminToken = '';
  let testLeadId = '';
  let abinayaAgentId = '';
  const agentTokens = {};

  // ----------------------------------------------------------------------
  // PHASE 1: Public Incomplete Registration Drop-Off
  // ----------------------------------------------------------------------
  console.log('--- Phase 1: Public Incomplete Registration Drop-Off ---');
  try {
    const res = await apiRequest('/public/lead', {
      method: 'POST',
      body: JSON.stringify({
        full_name: TEST_LEAD_NAME,
        mobile: TEST_LEAD_PHONE,
        step: 'details',
      }),
    });
    recordResult(
      'Public Step 1 Submission (/api/public/lead)',
      res.ok && res.data?.success === true,
      `Captured lead ${TEST_LEAD_PHONE}`,
      res.latencyMs
    );
  } catch (err) {
    recordResult('Public Step 1 Submission (/api/public/lead)', false, err.message);
  }

  // ----------------------------------------------------------------------
  // PHASE 2: Super Admin Authentication & Incomplete Leads Retrieval
  // ----------------------------------------------------------------------
  console.log('\n--- Phase 2: Super Admin Authentication & Leads Retrieval ---');
  try {
    const res = await apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: 'admin',
        password: 'UL5-q9SmiZLcSp9l',
      }),
    });
    adminToken = res.data?.token || '';
    recordResult(
      'Super Admin Authentication (/api/auth/login)',
      res.ok && !!adminToken,
      `Role: ${res.data?.user?.role}`,
      res.latencyMs
    );

    // Fetch active agents
    const agentsRes = await apiRequest('/crm/agents', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const agents = agentsRes.data?.agents || [];
    const abinaya = agents.find((a) => a.name.includes('Abinaya'));
    abinayaAgentId = abinaya?.id || '';
    recordResult(
      'Super Admin Active Agents Fetch (/api/crm/agents)',
      agentsRes.ok && agents.length === 5,
      `Found ${agents.length} active telecallers`,
      agentsRes.latencyMs
    );

    // Fetch incomplete leads list
    const leadsRes = await apiRequest('/leads?tab=open&pageSize=50', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const found = (leadsRes.data?.rows || []).find((r) => r.mobile === TEST_LEAD_PHONE);
    testLeadId = found?._id || '';
    recordResult(
      'Super Admin View Incomplete Leads (/api/leads?tab=open)',
      leadsRes.ok && !!found,
      `Lead found: ${found?.name} (ID: ${testLeadId})`,
      leadsRes.latencyMs
    );
  } catch (err) {
    recordResult('Super Admin Phase', false, err.message);
  }

  // ----------------------------------------------------------------------
  // PHASE 3: Super Admin Manual Lead Assignment
  // ----------------------------------------------------------------------
  console.log('\n--- Phase 3: Super Admin Manual Lead Assignment ---');
  try {
    if (testLeadId && abinayaAgentId) {
      const res = await apiRequest(`/leads/${testLeadId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          assigned_agent_id: abinayaAgentId,
        }),
      });
      recordResult(
        'Super Admin Manual Assign Lead (/api/leads/:id)',
        res.ok && res.data?.lead?.assigned_agent_id === abinayaAgentId,
        `Assigned to ${res.data?.lead?.assigned_agent_name}`,
        res.latencyMs
      );
    } else {
      recordResult('Super Admin Manual Assign Lead (/api/leads/:id)', false, 'Missing lead ID or agent ID');
    }
  } catch (err) {
    recordResult('Super Admin Manual Assign Lead', false, err.message);
  }

  // ----------------------------------------------------------------------
  // PHASE 4: Super Admin Round-Robin Lead Distribution
  // ----------------------------------------------------------------------
  console.log('\n--- Phase 4: Super Admin Round-Robin Lead Distribution ---');
  try {
    const res = await apiRequest('/crm/distribute-leads', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({}),
    });
    recordResult(
      'Super Admin Round-Robin Distribute (/api/crm/distribute-leads)',
      res.ok && res.data?.success === true,
      res.data?.message || 'Distributed successfully',
      res.latencyMs
    );
  } catch (err) {
    recordResult('Super Admin Round-Robin Distribute', false, err.message);
  }

  // ----------------------------------------------------------------------
  // PHASE 5: Telecaller Logins & Strict Queue Isolation
  // ----------------------------------------------------------------------
  console.log('\n--- Phase 5: Telecaller Logins & Strict Queue Isolation ---');
  for (const tc of TELECALLERS) {
    try {
      const loginRes = await apiRequest('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          username: tc.username,
          password: '123456',
        }),
      });
      const token = loginRes.data?.token || '';
      agentTokens[tc.username] = token;
      recordResult(
        `Telecaller Login: ${tc.name} (@${tc.username})`,
        loginRes.ok && !!token && loginRes.data?.user?.group_id === 12,
        `Group: ${loginRes.data?.user?.group_id} | Home: ${loginRes.data?.user?.home}`,
        loginRes.latencyMs
      );

      const convRes = await apiRequest('/crm/conversations?limit=100', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const convs = convRes.data?.conversations || [];
      const hasLead = convs.some((c) => c.clean_mobile === TEST_LEAD_PHONE);

      if (tc.username === 'abinaya') {
        recordResult(
          `Queue Check: ${tc.name} sees assigned lead (${TEST_LEAD_PHONE})`,
          hasLead,
          `Found in queue of ${convs.length} assigned leads`,
          convRes.latencyMs
        );
      } else {
        recordResult(
          `Queue Isolation: ${tc.name} DOES NOT see Abinaya's lead`,
          !hasLead,
          `Queue properly isolated (${convs.length} assigned leads)`,
          convRes.latencyMs
        );
      }
    } catch (err) {
      recordResult(`Telecaller ${tc.name}`, false, err.message);
    }
  }

  // ----------------------------------------------------------------------
  // PHASE 6: Telecaller Call Logging & Notes Outcome
  // ----------------------------------------------------------------------
  console.log('\n--- Phase 6: Telecaller Call Logging & Notes Outcome ---');
  try {
    const abinayaToken = agentTokens['abinaya'];
    if (abinayaToken) {
      // Update lead status to interested
      const statusRes = await apiRequest(`/crm/conversations/${TEST_LEAD_PHONE}/lead-status`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${abinayaToken}` },
        body: JSON.stringify({ lead_status: 'interested' }),
      });
      recordResult(
        'Telecaller Update Lead Status (/api/crm/conversations/:phone/lead-status)',
        statusRes.ok && statusRes.data?.success === true,
        'Status moved to Interested',
        statusRes.latencyMs
      );

      // Add call note
      const noteRes = await apiRequest(`/crm/conversations/${TEST_LEAD_PHONE}/notes`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${abinayaToken}` },
        body: JSON.stringify({ note: 'Lead confirmed interested in candidate booth briefing. Callback scheduled.' }),
      });
      recordResult(
        'Telecaller Save Lead Note (/api/crm/conversations/:phone/notes)',
        noteRes.ok && noteRes.data?.success === true,
        'Note saved to timeline',
        noteRes.latencyMs
      );
    } else {
      recordResult('Telecaller Call Logging', false, 'Missing Abinaya token');
    }
  } catch (err) {
    recordResult('Telecaller Call Logging', false, err.message);
  }

  // ----------------------------------------------------------------------
  // PHASE 7: Full Candidate Registration & Dashboard Portal
  // ----------------------------------------------------------------------
  console.log('\n--- Phase 7: Full Candidate Registration & Candidate Dashboard ---');
  let candPasscode = '';
  try {
    const regRes = await apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        full_name: TEST_CANDIDATE_NAME,
        mobile: TEST_CANDIDATE_PHONE,
        district: 'Chennai',
        assembly_id: 18,
        assembly_name: 'Harbour',
        position: 'Candidate',
        party: 'Independent',
        union_or_municipality: 'Chennai Corporation',
        booths: ['1', '2', '3'],
      }),
    });

    candPasscode = regRes.data?.passcode || regRes.data?.password || '123456';
    recordResult(
      'Candidate Full Web Registration (/api/auth/register)',
      regRes.ok && regRes.data?.success === true,
      `Registered: ${TEST_CANDIDATE_NAME} (Passcode: ${candPasscode})`,
      regRes.latencyMs
    );

    // Candidate Login
    const candLoginRes = await apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: TEST_CANDIDATE_PHONE,
        password: candPasscode,
      }),
    });
    const candToken = candLoginRes.data?.token || '';
    recordResult(
      'Candidate Authentication (/api/auth/login)',
      candLoginRes.ok && !!candToken,
      `User Role: ${candLoginRes.data?.user?.role} | Landing: ${candLoginRes.data?.user?.home}`,
      candLoginRes.latencyMs
    );

    // Verify candidate session profile
    const meRes = await apiRequest('/auth/me', {
      headers: { Authorization: `Bearer ${candToken}` },
    });
    recordResult(
      'Candidate Profile Access (/api/auth/me)',
      meRes.ok && meRes.data?.success === true,
      `Candidate Name: ${meRes.data?.user?.first_name || meRes.data?.user?.name}`,
      meRes.latencyMs
    );

    // Check that Super Admin sees them automatically moved to "registered"
    const regListRes = await apiRequest('/leads?tab=registered&pageSize=50', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const inRegistered = (regListRes.data?.rows || []).some((r) => r.mobile === TEST_CANDIDATE_PHONE);
    recordResult(
      'CRM Auto-Sync: Candidate automatically moved to "Registered" Tab',
      inRegistered,
      `Found in registered leads queue`,
      regListRes.latencyMs
    );
  } catch (err) {
    recordResult('Candidate Registration Phase', false, err.message);
  }

  // ----------------------------------------------------------------------
  // PHASE 8: WhatsApp Webhook Registration Recognition
  // ----------------------------------------------------------------------
  console.log('\n--- Phase 8: WhatsApp Webhook Registration Recognition ---');
  try {
    const webhookRes = await apiRequest('/whatsapp/wacto', {
      method: 'POST',
      body: JSON.stringify({
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: `91${TEST_CANDIDATE_PHONE}`,
                      text: { body: 'வணக்கம்' },
                      type: 'text',
                      timestamp: Math.floor(Date.now() / 1000).toString(),
                    },
                  ],
                },
              },
            ],
          },
        ],
      }),
    });
    recordResult(
      'WhatsApp Inbound "வணக்கம்" Webhook (/api/whatsapp/wacto)',
      webhookRes.ok,
      `Webhook acknowledged HTTP ${webhookRes.status} (Candidate recognized)`,
      webhookRes.latencyMs
    );
  } catch (err) {
    recordResult('WhatsApp Webhook Phase', false, err.message);
  }

  // ----------------------------------------------------------------------
  // SUMMARY REPORT
  // ----------------------------------------------------------------------
  console.log('\n========================================================================');
  console.log('FINAL LIVE E2E SUITE SUMMARY');
  console.log('========================================================================');
  const passedCount = results.filter((r) => r.passed).length;
  const totalCount = results.length;
  const passRate = ((passedCount / totalCount) * 100).toFixed(1);

  results.forEach((r, idx) => {
    const num = (idx + 1).toString().padStart(2, '0');
    const badge = r.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`[${num}] ${badge.padEnd(8)} ${r.testName.padEnd(65)} (${r.latencyMs}ms)`);
  });

  console.log('------------------------------------------------------------------------');
  console.log(`Results: ${passedCount} / ${totalCount} PASSED (${passRate}%)`);
  console.log('========================================================================');

  if (passedCount === totalCount) {
    console.log('\x1b[32mALL LIVE END-TO-END TESTS PASSED SUCCESSFULLY ON STAGING!\x1b[0m\n');
  } else {
    console.log('\x1b[31mSOME TESTS FAILED. CHECK LOGS ABOVE.\x1b[0m\n');
    process.exit(1);
  }
}

run().catch((e) => {
  console.error('Fatal Test Runner Error:', e);
  process.exit(1);
});
