import api from '../api/client.js';

// Registration checks shared by the Dashboard ("Needs attention" counts) and the
// Registrations "Show" filter, so a count always opens exactly the rows it counted.
// The API has no filters for these, so both pull the list (up to 10 × 200) and test
// it in the browser; when registrations grow past a few thousand this belongs in
// GET /registrations.

const REG_PAGE = 200;

export async function loadAllRegistrations(params = {}) {
  const get = (page) => api.get('/registrations', { params: { ...params, page, pageSize: REG_PAGE } }).then((r) => r.data);
  const first = await get(1);
  if (first?.success === false) throw new Error(first.message || 'the registrations list was refused');
  let rows = first.rows || [];
  const pages = Math.ceil((first.total || 0) / REG_PAGE);
  for (let p = 2; p <= Math.min(pages, 10); p++) rows = rows.concat((await get(p)).rows || []);
  const total = first.total ?? rows.length;
  return { rows, total, capped: rows.length < total };
}

// Page through a list the API serves at most `size` rows at a time, so counts are never silently cut
// at the first page. `total` (when the API sends one) ends the loop early; otherwise a short page does.
// Past `max` pages the result is marked `capped`, and the screens say "N+" instead of a false N.
export async function loadPaged(getPage, { size, max = 10 }) {
  let rows = [];
  for (let p = 1; p <= max; p++) {
    const { rows: got = [], total } = await getPage(p, size);
    rows = rows.concat(got);
    if (got.length < size || (total != null && rows.length >= total)) return Object.assign(rows, { capped: false });
  }
  return Object.assign(rows, { capped: true });
}
export const atLeast = (list, n = list?.length || 0) => (list?.capped ? `${n.toLocaleString('en-IN')}+` : n.toLocaleString('en-IN'));

export const hasBooths = (r) => (r.booth_count || r.booths?.length || 0) > 0;
export const openRequestCount = (r) => (Array.isArray(r.requests) ? r.requests : []).filter((q) => /pending|awaiting|processing/i.test(q.status || '')).length;
export const isTestReg = (r) => /test/i.test(r.full_name || '');
export const isPaid = (r) => r.paid_status === 'Yes';
export const isInvalidPaid = (r) => r.paid_status !== 'Yes' && r.paid_status !== 'No';
// A payment proof whose UTR starts with letters or a dummy run (1234…, 0000…, 1111…). One rule for the
// Payments checks and the Dashboard, so "test entry" means the same thing on both. No UTR is not a test.
export const isTestUtr = (u) => { const s = String(u || '').trim(); return /^[A-Za-z]/.test(s) || /^(1234|0000|1111)/.test(s); };

// "Payments received" is the Payments page's list (GET /payments/subscriptions). A registration is
// matched to it by mobile. The two should agree; when they don't, it's a data check, not a KPI.
export const cleanMobile = (m) => String(m || '').replace(/\D/g, '').slice(-10);
export const paidMobiles = (subs) => new Set((subs || []).map((s) => cleanMobile(s.mobile_no)).filter(Boolean));
export const markedPaidNoPayment = (r, ctx) => isPaid(r) && !!ctx?.paid && !ctx.paid.has(cleanMobile(r.mobile));
export const paymentNotMarked = (r, ctx) => !isPaid(r) && !!ctx?.paid && ctx.paid.has(cleanMobile(r.mobile));
// Booths assigned but no payment received (matched by mobile): the gap between the pipeline's two last steps.
export const boothsNotPaid = (r, ctx) => hasBooths(r) && !!ctx?.paid && !ctx.paid.has(cleanMobile(r.mobile));

// "Show" options on Registrations. `empty` is what the list says when nothing matches.
// Tests take (row, ctx); options with `needs: 'subs'` also need the payments-received list (ctx.paid).
export const SHOWS = [
  { id: 'no-booths', label: 'Without booths', test: (r) => !hasBooths(r), empty: 'Every candidate in this view has booths.' },
  { id: 'requests', label: 'Open broadcast request', test: (r) => openRequestCount(r) > 0, empty: 'No broadcast requests are waiting.' },
  { id: 'unpaid', label: 'Not marked paid', test: (r) => r.paid_status === 'No', empty: 'Every candidate in this view is marked paid.' },
  { id: 'paid', label: 'Marked paid', test: isPaid, empty: 'No candidate in this view is marked paid yet.' },
  { id: 'invalid-paid', label: 'Paid status not Yes or No', test: isInvalidPaid, empty: 'Every paid status is a clean Yes or No.' },
  { id: 'paid-no-payment', label: 'Marked paid, no payment received', needs: 'subs', test: markedPaidNoPayment, empty: 'Every candidate marked paid has a payment on record.' },
  { id: 'booths-not-paid', label: 'With booths, not paid', needs: 'subs', test: boothsNotPaid, empty: 'Every candidate with booths has a payment on record.' },
  { id: 'payment-not-marked', label: 'Payment received, not marked paid', needs: 'subs', test: paymentNotMarked, empty: 'Every received payment is marked on its registration.' },
  { id: 'test', label: 'Test registrations', test: isTestReg, empty: 'No test registrations left.' },
];
export const showById = (id) => SHOWS.find((s) => s.id === id);
