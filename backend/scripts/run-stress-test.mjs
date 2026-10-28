/**
 * TNEDMS Advanced Stress & Load Test Runner
 * Measures throughput (RPS), Latency (P50, P90, P95, P99), and System Stability.
 */
const BASE_URL = process.env.TEST_BASE_URL || 'https://tnedms.online';

function calculateStats(latencies) {
  if (!latencies.length) return { min: 0, max: 0, avg: 0, p50: 0, p90: 0, p95: 0, p99: 0 };
  const sorted = [...latencies].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const avg = Math.round(sum / sorted.length);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const p = (pct) => sorted[Math.floor((pct / 100) * sorted.length)] || max;
  return { min, max, avg, p50: p(50), p90: p(90), p95: p(95), p99: p(99) };
}

async function runWorkerPool(totalTasks, concurrency, taskFn) {
  let taskIndex = 0;
  const latencies = [];
  const statusCodes = {};
  let errors = 0;
  const startTime = Date.now();

  async function worker() {
    while (taskIndex < totalTasks) {
      const current = taskIndex++;
      const t0 = Date.now();
      try {
        const res = await taskFn(current);
        const elapsed = Date.now() - t0;
        latencies.push(elapsed);
        const code = res?.status || '200';
        statusCodes[code] = (statusCodes[code] || 0) + 1;
      } catch (err) {
        errors++;
        statusCodes['ERR'] = (statusCodes['ERR'] || 0) + 1;
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  const totalDurationMs = Date.now() - startTime;
  const rps = (totalTasks / (totalDurationMs / 1000)).toFixed(1);
  const stats = calculateStats(latencies);

  return { totalTasks, concurrency, totalDurationMs, rps, stats, statusCodes, errors };
}

async function getAdminToken() {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'UL5-q9SmiZLcSp9l' }),
  });
  const data = await res.json().catch(() => ({}));
  return data?.token || '';
}

async function getTelecallerToken() {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'abinaya', password: '123456' }),
  });
  const data = await res.json().catch(() => ({}));
  return data?.token || '';
}

function printReport(title, res) {
  console.log(`\n========================================================================`);
  console.log(`STRESS TEST: ${title}`);
  console.log(`========================================================================`);
  console.log(`• Concurrency (Simultaneous Users): ${res.concurrency}`);
  console.log(`• Total Requests Sent:             ${res.totalTasks}`);
  console.log(`• Total Duration:                  ${(res.totalDurationMs / 1000).toFixed(2)}s`);
  console.log(`• Throughput:                      \x1b[36m${res.rps} requests/second\x1b[0m`);
  console.log(`• HTTP Status Breakdown:           ${JSON.stringify(res.statusCodes)}`);
  console.log(`• Failures / Network Drops:        ${res.errors}`);
  console.log(`------------------------------------------------------------------------`);
  console.log(`• Latency Metrics:`);
  console.log(`   - Min:   ${res.stats.min}ms`);
  console.log(`   - Avg:   ${res.stats.avg}ms`);
  console.log(`   - P50 (Median): \x1b[32m${res.stats.p50}ms\x1b[0m`);
  console.log(`   - P90:          ${res.stats.p90}ms`);
  console.log(`   - P95:          \x1b[33m${res.stats.p95}ms\x1b[0m`);
  console.log(`   - P99:          ${res.stats.p99}ms`);
  console.log(`   - Max:          ${res.stats.max}ms`);
  console.log(`========================================================================`);
}

async function main() {
  console.log(`Initializing Live Stress Test against: ${BASE_URL}\n`);

  console.log('Authenticating Admin and Telecaller sessions for protected endpoints...');
  const adminToken = await getAdminToken();
  const telecallerToken = await getTelecallerToken();
  console.log(`• Admin Session:      ${adminToken ? '✓ Ready' : '✗ Failed'}`);
  console.log(`• Telecaller Session: ${telecallerToken ? '✓ Ready' : '✗ Failed'}`);

  // --------------------------------------------------------------------
  // Test 1: Public Read & Assembly Inquiries (High Concurrency)
  // --------------------------------------------------------------------
  console.log('\n[Stage 1/4] Running Public Read Stress Test (100 Concurrent Users, 500 Requests)...');
  const stage1 = await runWorkerPool(500, 100, async () => {
    return fetch(`${BASE_URL}/api/public/assemblies`);
  });
  printReport('Public Read & Assemblies API (100 Concurrent)', stage1);

  // --------------------------------------------------------------------
  // Test 2: Incomplete Lead Ingestion (Write Intensive)
  // --------------------------------------------------------------------
  console.log('\n[Stage 2/4] Running Lead Ingestion Stress Test (30 Concurrent Users, 150 Writes)...');
  const baseNum = 9840700000;
  const stage2 = await runWorkerPool(150, 30, async (idx) => {
    return fetch(`${BASE_URL}/api/public/lead`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: `Stress Lead ${idx}`,
        mobile: String(baseNum + idx),
        step: idx % 2 === 0 ? 'details' : 'role',
      }),
    });
  });
  printReport('Lead Ingestion & Upsertion (30 Concurrent)', stage2);

  // --------------------------------------------------------------------
  // Test 3: CRM Telecaller Workspace Queries (Database Query Heavy)
  // --------------------------------------------------------------------
  console.log('\n[Stage 3/4] Running CRM Workspace Load Test (50 Concurrent Telecaller Queries)...');
  const stage3 = await runWorkerPool(200, 50, async () => {
    return fetch(`${BASE_URL}/api/crm/conversations?limit=25`, {
      headers: { Authorization: `Bearer ${telecallerToken}` },
    });
  });
  printReport('CRM Telecaller Workspace Load (50 Concurrent)', stage3);

  // --------------------------------------------------------------------
  // Test 4: Mixed Campaign Peak Surge (Simulation of Busy Election Day)
  // --------------------------------------------------------------------
  console.log('\n[Stage 4/4] Running Mixed Real-World Traffic Surge (50 Concurrent, 300 Mixed Ops)...');
  const stage4 = await runWorkerPool(300, 50, async (idx) => {
    const mod = idx % 10;
    if (mod < 6) {
      // 60% public queries
      return fetch(`${BASE_URL}/api/public/assemblies`);
    } else if (mod < 8) {
      // 20% telecaller queue updates
      return fetch(`${BASE_URL}/api/crm/conversations?limit=10`, {
        headers: { Authorization: `Bearer ${telecallerToken}` },
      });
    } else if (mod < 9) {
      // 10% lead status update
      return fetch(`${BASE_URL}/api/crm/conversations/9840700001/notes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${telecallerToken}`,
        },
        body: JSON.stringify({ note: `Load test note ${idx}` }),
      });
    } else {
      // 10% admin viewing incomplete leads
      return fetch(`${BASE_URL}/api/leads?tab=open&pageSize=25`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
    }
  });
  printReport('Mixed Campaign Peak Traffic Surge (50 Concurrent)', stage4);

  console.log('\n========================================================================');
  console.log('ALL STRESS TEST STAGES COMPLETED SUCCESSFULLY!');
  console.log('========================================================================\n');
}

main().catch((err) => {
  console.error('Stress test runner failed:', err);
  process.exit(1);
});
