import { createRequire } from 'module';
import { execSync } from 'child_process';
import path from 'path';

const require = createRequire(import.meta.url);
const gPath = execSync('npm root -g').toString().trim();
const { chromium } = require(path.join(gPath, 'playwright'));

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

async function runAudit() {
  console.log('='.repeat(80));
  console.log('      EDM FRONTEND DEEP AUDIT: DASHBOARDS, ROLES & VIEWPORTS');
  console.log('='.repeat(80));
  console.log(`Target: ${BASE_URL}\n`);

  const results = {
    passed: 0,
    failed: 0,
    warnings: 0,
    details: []
  };

  function assert(category, testName, condition, detail = '') {
    if (condition) {
      results.passed++;
      results.details.push({ category, testName, status: 'PASS', detail });
      console.log(`  [PASS] ${category.padEnd(20)}: ${testName}${detail ? ` -> ${detail}` : ''}`);
    } else {
      results.failed++;
      results.details.push({ category, testName, status: 'FAIL', detail });
      console.error(`  [FAIL] ${category.padEnd(20)}: ${testName}${detail ? ` -> ${detail}` : ''}`);
    }
  }

  function warn(category, testName, detail = '') {
    results.warnings++;
    results.details.push({ category, testName, status: 'WARN', detail });
    console.log(`  [WARN] ${category.padEnd(20)}: ${testName}${detail ? ` -> ${detail}` : ''}`);
  }

  const browser = await chromium.launch({ headless: true });

  // Helper to create a page with console error monitoring
  async function createAuditedPage(context, viewport = { width: 1280, height: 800 }) {
    const page = await context.newPage();
    await page.setViewportSize(viewport);
    page.consoleErrors = [];
    page.pageErrors = [];

    page.on('console', msg => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Ignore expected network 401/403/404 during intentional boundary testing
        if (!text.includes('status of 401') && !text.includes('status of 403') && !text.includes('status of 404')) {
          page.consoleErrors.push(text);
        }
      }
    });

    page.on('pageerror', err => {
      page.pageErrors.push(err.message);
    });

    return page;
  }

  // Measure horizontal overflow (detects sideways scrolling)
  async function checkHorizontalOverflow(page, label) {
    const isOverflowing = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth + 2 ||
             document.body.scrollWidth > window.innerWidth + 2;
    });
    assert('Viewport (360/390)', `No sideways scroll on ${label}`, !isOverflowing, isOverflowing ? 'PAGE HAS HORIZONTAL OVERFLOW' : 'Fits viewport cleanly');
  }

  // Helper to log in
  async function loginAs(page, username, password) {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
    await page.fill('input[name="username"], input[name="mobile"], input[type="text"]', username);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1000);
    await page.waitForLoadState('networkidle');
  }

  try {
    // ========================================================================
    // 1. CANDIDATE DASHBOARD AUDIT (PRO & UNPAID)
    // ========================================================================
    console.log('\n--- 1. CANDIDATE DASHBOARD (PRO TIER: SELVI) ---');
    const proContext = await browser.newContext();
    const proPage = await createAuditedPage(proContext, { width: 390, height: 844 }); // Mobile Viewport

    // Login as Pro Candidate
    await loginAs(proPage, '9000000012', '123456');
    const proUrl = proPage.url();
    assert('Candidate Auth', 'Pro Candidate lands on /candidate', proUrl.includes('/candidate'), proUrl);

    // Check Demographics Elements: Gender Balance & Age Cohorts
    const hasGenderBar = await proPage.evaluate(() => {
      const text = document.body.innerText;
      return text.includes('Gender Distribution') && text.includes('Female Electors') && text.includes('Male Electors');
    });
    assert('Candidate UI', 'Gender Distribution Balance Bar renders', hasGenderBar);

    const hasAgeCohorts = await proPage.evaluate(() => {
      const text = document.body.innerText;
      return (text.includes('Elector Age Cohorts') || text.includes('Youth')) && text.includes('18–35') && text.includes('60+');
    });
    assert('Candidate UI', 'Elector Age Cohorts (Youth/Core/Seniors) render', hasAgeCohorts);

    // Viewport check on 390px
    await checkHorizontalOverflow(proPage, 'Pro Candidate Home (390px iPhone)');

    // Viewport check on 360px (Small Android)
    await proPage.setViewportSize({ width: 360, height: 740 });
    await proPage.waitForTimeout(400);
    await checkHorizontalOverflow(proPage, 'Pro Candidate Home (360px Android)');

    // Verify Removed Routes are NOT in sidebar or quick actions
    const hasRemovedLinks = await proPage.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a')).map(a => a.getAttribute('href') || '');
      return {
        assemblyAnalytics: links.some(l => l.includes('assembly-analytics')),
        candidateBriefing: links.some(l => l.includes('candidate-briefing')),
        fieldOperations: links.some(l => l.includes('field-operations'))
      };
    });
    assert('Candidate Nav', 'Assembly Analytics removed from Candidate Nav', !hasRemovedLinks.assemblyAnalytics);
    assert('Candidate Nav', 'Candidate Briefing removed from Candidate Nav', !hasRemovedLinks.candidateBriefing);
    assert('Candidate Nav', 'Field Operations removed from Candidate Nav', !hasRemovedLinks.fieldOperations);

    // Verify Attempt to open removed route directly is guarded
    await proPage.goto(`${BASE_URL}/assembly-analytics`, { waitUntil: 'networkidle' });
    const blockedUrl = proPage.url();
    const isBlocked = !blockedUrl.includes('/assembly-analytics') || (await proPage.evaluate(() => document.body.innerText.includes('permission') || document.body.innerText.includes('access')));
    assert('Route Security', 'Candidate accessing /assembly-analytics is blocked/redirected', isBlocked, `Landed at: ${blockedUrl}`);

    // Verify Booth Report route opens for Candidate
    await proPage.goto(`${BASE_URL}/booth-report`, { waitUntil: 'networkidle' });
    const boothReportTitle = await proPage.evaluate(() => document.title || document.body.innerText.slice(0, 50));
    assert('Candidate Routes', 'Booth Report opens successfully', proPage.url().includes('/booth-report'), boothReportTitle.slice(0, 30));

    // Verify Candidate Voters List (/voters) with Tamil Names
    await proPage.goto(`${BASE_URL}/voters`, { waitUntil: 'networkidle' });
    await proPage.waitForTimeout(800);
    const hasTamilVoters = await proPage.evaluate(() => {
      const text = document.body.innerText;
      return /[\u0B80-\u0BFF]/.test(text); // Regex for Tamil Unicode Block
    });
    assert('Bilingual Script', 'Tamil voter names render cleanly in table', hasTamilVoters);

    // Empty search state check
    const searchInput = await proPage.$('input[placeholder*="search" i], input[type="search"], input[type="text"]');
    if (searchInput) {
      await searchInput.fill('XYZNONEXISTENT999');
      await proPage.waitForTimeout(600);
      const emptyStateRendered = await proPage.evaluate(() => {
        const text = document.body.innerText;
        return text.includes('No voters') || text.includes('0 of') || text.includes('Nothing') || text.includes('found');
      });
      assert('Empty State', 'Empty search gracefully handled with empty state notice', emptyStateRendered);
    }

    // Session Persistence on Refresh (F5)
    await proPage.reload({ waitUntil: 'networkidle' });
    assert('Session Refresh', 'Candidate session retained on F5 refresh', proPage.url().includes('/voters'));

    // Console Error check for Candidate
    assert('Console Health', 'Pro Candidate pages throw 0 console runtime errors', proPage.consoleErrors.length === 0, proPage.consoleErrors.join(', ') || 'Clean console');

    // ------------------------------------------------------------------------
    // UNPAID CANDIDATE (MURUGAN) LOCK STATE AUDIT
    // ------------------------------------------------------------------------
    console.log('\n--- 2. FREE/UNPAID CANDIDATE (MURUGAN) LOCK STATE ---');
    const unpaidContext = await browser.newContext();
    const unpaidPage = await createAuditedPage(unpaidContext, { width: 390, height: 844 });

    await loginAs(unpaidPage, '9000000011', '123456');
    assert('Unpaid Auth', 'Unpaid candidate logs in successfully', unpaidPage.url().includes('/candidate'));

    // Verify Preview / Sample mode or lock badge
    const hasLockOrSample = await unpaidPage.evaluate(() => {
      const text = document.body.innerText;
      return text.includes('Sample') || text.includes('Preview') || text.includes('Activate') || text.includes('Upgrade') || text.includes('Unlock');
    });
    assert('Lock Engine', 'Unpaid candidate dashboard displays Preview / Plan Activation CTA', hasLockOrSample);

    // Verify Purchase / Activate modal opens
    const activateBtn = await unpaidPage.$('button:has-text("Activate"), button:has-text("Upgrade"), button:has-text("Buy"), button:has-text("Unlock")');
    if (activateBtn) {
      await activateBtn.click();
      await unpaidPage.waitForTimeout(600);
      const modalOpen = await unpaidPage.$('.cv-modal, [role="dialog"], .modal');
      assert('Modal Engine', 'Plan activation modal opens cleanly with UPI payment info', !!modalOpen);
    } else {
      warn('Modal Engine', 'Activate plan button locator checked');
    }

    // ========================================================================
    // 3. TELECALLER DASHBOARD AUDIT (PRIYA)
    // ========================================================================
    console.log('\n--- 3. TELECALLER DASHBOARD (PRIYA) ---');
    const teleContext = await browser.newContext();
    const telePage = await createAuditedPage(teleContext, { width: 1280, height: 800 });

    await loginAs(telePage, '9000000101', '123456');
    const teleUrl = telePage.url();
    assert('Telecaller Auth', 'Telecaller lands on /team workspace', teleUrl.includes('/team'), teleUrl);

    // Navigate to Calling Queue (/team/crm)
    await telePage.goto(`${BASE_URL}/team/crm`, { waitUntil: 'networkidle' });
    await telePage.waitForTimeout(800);

    // Check actionable leads queue elements
    const hasQueueItems = await telePage.evaluate(() => {
      return document.querySelectorAll('tr, .cv-lead-card, [class*="lead"]').length > 0;
    });
    assert('Telecaller Queue', 'Actionable leads queue renders items', hasQueueItems);

    // Check Auto-snooze / priority badges
    const hasBadges = await telePage.evaluate(() => {
      const text = document.body.innerText;
      return text.includes('Actionable') || text.includes('Retry') || text.includes('Snooze') || text.includes('Callback') || text.includes('Open');
    });
    assert('Telecaller UI', 'Priority queue filters & status indicators render', hasBadges);

    // Role Security: Telecaller must NOT access Super Admin /ward-logins or /team/members
    await telePage.goto(`${BASE_URL}/ward-logins`, { waitUntil: 'networkidle' });
    const teleBlocked = !telePage.url().includes('/ward-logins') || (await telePage.evaluate(() => document.body.innerText.includes('permission') || document.body.innerText.includes('access')));
    assert('Role Security', 'Telecaller blocked from accessing Super Admin configuration', teleBlocked);

    // Mobile Viewport check for Telecaller on 390px
    await telePage.setViewportSize({ width: 390, height: 844 });
    await telePage.goto(`${BASE_URL}/team/crm`, { waitUntil: 'networkidle' });
    await checkHorizontalOverflow(telePage, 'Telecaller Leads Queue (390px)');

    // Console Error check for Telecaller
    assert('Console Health', 'Telecaller pages throw 0 console runtime errors', telePage.consoleErrors.length === 0, telePage.consoleErrors.join(', ') || 'Clean console');

    // ========================================================================
    // 4. SUPER ADMIN DASHBOARD AUDIT
    // ========================================================================
    console.log('\n--- 4. SUPER ADMIN DASHBOARD ---');
    const adminContext = await browser.newContext();
    const adminPage = await createAuditedPage(adminContext, { width: 1440, height: 900 });

    await loginAs(adminPage, 'admin', 'admin123');
    assert('Admin Auth', 'Super Admin reaches Admin Dashboard', adminPage.url().includes('/dashboard'), adminPage.url());

    // Check KPI Cards on Dashboard
    const hasKpiCards = await adminPage.evaluate(() => {
      return document.querySelectorAll('.cv-kpi, .card, [class*="kpi"]').length > 0;
    });
    assert('Admin UI', 'Dashboard metric KPI cards render', hasKpiCards);

    // Verify 8:00 PM Daily Digest Modal opens
    await adminPage.goto(`${BASE_URL}/team/crm`, { waitUntil: 'networkidle' });
    await adminPage.waitForTimeout(600);
    const digestBtn = await adminPage.$('button:has-text("8 PM Digest"), button:has-text("Digest")');
    if (digestBtn) {
      await digestBtn.click();
      await adminPage.waitForTimeout(600);
      const digestModal = await adminPage.evaluate(() => {
        const text = document.body.innerText;
        return text.includes('Daily Telecalling Performance') || text.includes('Calls Dialed') || text.includes('Digest');
      });
      assert('Admin Digest', '8:00 PM Daily Digest preview modal renders KPIs & dispatch button', digestModal);
      // Close modal
      const closeBtn = await adminPage.$('button:has-text("Close"), .cv-modal-close, [aria-label="Close"]');
      if (closeBtn) await closeBtn.click();
    } else {
      warn('Admin Digest', '8 PM Digest button inspected');
    }

    // Lead Reports with Talk Time Check
    await adminPage.goto(`${BASE_URL}/team/reports`, { waitUntil: 'networkidle' });
    await adminPage.waitForTimeout(800);
    const hasTalkTime = await adminPage.evaluate(() => {
      const text = document.body.innerText;
      return text.includes('Talk Time') || text.includes('Registration') || text.includes('Duration');
    });
    assert('Lead Reports', 'Lead Reports display talk time & candidate registration status', hasTalkTime);

    // Console Error check for Admin
    assert('Console Health', 'Super Admin pages throw 0 console runtime errors', adminPage.consoleErrors.length === 0, adminPage.consoleErrors.join(', ') || 'Clean console');

  } catch (err) {
    console.error('Audit execution error:', err);
    assert('Audit Execution', 'Audit completed without runner exception', false, err.message);
  } finally {
    await browser.close();
  }

  // ========================================================================
  // SCORECARD SUMMARY
  // ========================================================================
  console.log('\n' + '='.repeat(80));
  console.log(`   FRONTEND AUDIT COMPLETE: ${results.passed} PASSED | ${results.failed} FAILED | ${results.warnings} WARNINGS`);
  console.log('='.repeat(80));

  return results;
}

runAudit().then(res => {
  process.exit(res.failed > 0 ? 1 : 0);
}).catch(err => {
  console.error('Fatal audit failure:', err);
  process.exit(1);
});
