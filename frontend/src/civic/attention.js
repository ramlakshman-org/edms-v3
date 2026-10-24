import { useEffect, useSyncExternalStore } from 'react';
import api from '../api/client.js';
import { loadAllRegistrations, loadPaged, hasBooths, openRequestCount, isTestReg, isInvalidPaid, isTestUtr, paidMobiles, markedPaidNoPayment, paymentNotMarked, boothsNotPaid } from './needs.js';

// "Needs attention" for the Super Admin: one store shared by the top-bar bell (every page)
// and the Dashboard strip, so both always show the same items. Payments to verify,
// payments received and registrations load once, refresh every 5 minutes while an admin
// page is open, and fail on their own: a failed source becomes an item of its own, never
// an "all clear".

const REFRESH_MS = 5 * 60 * 1000;
const DAY = 86400000;

const why = (e) => {
  if (!e?.response) return e?.message && !/network/i.test(e.message) ? e.message : 'no connection to the server';
  const st = e.response.status;
  if (st === 401 || st === 403) return 'session expired, log in again';
  if (st >= 500) return `server error ${st}`;
  return e.response.data?.message || `error ${st}`;
};

// Lists come back whole (paged), or marked `capped` when they run past 10 pages.
const SOURCES = {
  regs: loadAllRegistrations,
  utrs: () => loadPaged((page, limit) => api.get('/payments/pending-utrs', { params: { status: 'pending', page, limit } }).then((r) => {
    if (r.data?.success === false) throw new Error(r.data.message || 'the payments list was refused');
    return { rows: r.data?.rows || [], total: r.data?.total };
  }), { size: 200 }),
  // the one meaning of "paid" in the admin: the Payments page's received list (no total; a short page ends it)
  subs: () => loadPaged((page, limit) => api.get('/payments/subscriptions', { params: { page, limit } }).then((r) => {
    if (r.data?.success === false) throw new Error(r.data.message || 'the payments-received list was refused');
    return { rows: r.data?.subscriptions || [] };
  }), { size: 100 }),
};

let state = { data: {}, errs: {}, busy: {}, at: null };
const subs = new Set();
const set = (fn) => { state = { ...state, ...fn(state) }; subs.forEach((f) => f()); };
const subscribe = (f) => { subs.add(f); return () => subs.delete(f); };

export function loadSource(key) {
  set((s) => ({ busy: { ...s.busy, [key]: true } }));
  return SOURCES[key]()
    .then((v) => set((s) => { const errs = { ...s.errs }; delete errs[key]; return { data: { ...s.data, [key]: v }, errs }; }))
    .catch((e) => set((s) => { const data = { ...s.data }; delete data[key]; return { data, errs: { ...s.errs, [key]: why(e) } }; }))
    .finally(() => set((s) => ({ busy: { ...s.busy, [key]: false } })));
}

let inflight = null;
export function refreshAttention() {
  if (!inflight) inflight = Promise.all(Object.keys(SOURCES).map(loadSource)).then(() => set(() => ({ at: new Date() }))).finally(() => { inflight = null; });
  return inflight;
}

// `enabled` = the viewer is the Super Admin (other roles can't list registrations or payments).
export function useAttention(enabled = true) {
  const snap = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    if (!enabled) return undefined;
    if (!state.at || Date.now() - state.at.getTime() > REFRESH_MS) refreshAttention();
    const t = setInterval(refreshAttention, REFRESH_MS);
    return () => clearInterval(t);
  }, [enabled]);
  return snap;
}

const plural = (n, one, many) => (n === 1 ? one : many);
const ago = (iso) => { if (!iso) return ''; const d = Math.floor((Date.now() - new Date(iso).getTime()) / DAY); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`; };
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '');
const oldestOf = (rows) => rows.reduce((o, u) => (!o || u.submitted_at < o ? u.submitted_at : o), null);
const oldestShort = (iso) => { const d = Math.floor((Date.now() - new Date(iso).getTime()) / DAY); return d >= 2 ? `oldest ${d} days` : d === 1 ? 'oldest yesterday' : 'oldest today'; };

// Two groups: `waiting` = people waiting on Ram (and sources that failed, since until they load he
// can't know); `cleanup` = data hygiene that can wait. The bell badge counts only `waiting`.
// `short` is the chip wording and `text` the full sentence; both read after the count ("3 payments to
// verify"), so neither starts with a capital. Error items have no count and read on their own.
// `lead` marks the one item that matters most right now: the first real item waiting on Ram.
export function attentionItems({ data, errs }) {
  const items = [];
  if (errs.utrs) items.push({ key: 'utrs-error', group: 'waiting', tone: 'bad', retry: 'utrs', short: "payments couldn't load", text: `Payments couldn't load (${errs.utrs}). There may be payments waiting.` });
  if (errs.regs) items.push({ key: 'regs-error', group: 'waiting', tone: 'bad', retry: 'regs', short: "registrations couldn't load", text: `Registrations couldn't load (${errs.regs}). Booth, request and data checks are paused.` });
  if (errs.subs) items.push({ key: 'subs-error', group: 'cleanup', tone: 'bad', retry: 'subs', short: "payments received couldn't load", text: `Payments received couldn't load (${errs.subs}). The paid-status check is paused.` });

  // Real proofs wait on Ram; proofs that are plainly test entries are clean-up, so they never pose as urgent work.
  const pending = (data.utrs || []).filter((u) => u.status === 'pending');
  const real = pending.filter((u) => !isTestUtr(u.utr));
  const testProofs = pending.length - real.length;
  if (real.length) {
    const oldest = oldestOf(real);
    const detail = [oldestShort(oldest), testProofs ? `+${testProofs} test` : null].filter(Boolean).join(' · ');
    items.push({ key: 'payments', group: 'waiting', tone: 'warn', detail, n: real.length, more: data.utrs.capped, to: '/payments', short: `${plural(real.length, 'payment', 'payments')} to verify`, text: `${plural(real.length, 'payment', 'payments')} to verify · oldest ${ago(oldest)} (${fmtDate(oldest)})${testProofs ? ` · plus ${testProofs} that ${testProofs === 1 ? 'looks' : 'look'} like test entries` : ''}` });
  } else if (testProofs) {
    const oldest = oldestOf(pending);
    items.push({ key: 'payment-tests', group: 'cleanup', tone: 'info', n: testProofs, more: data.utrs.capped, to: '/payments?show=test', short: `test payment ${plural(testProofs, 'proof', 'proofs')} to reject`, text: `test payment ${plural(testProofs, 'proof', 'proofs')} to reject · the UTR looks made up · oldest ${ago(oldest)} (${fmtDate(oldest)})` });
  }
  const rows = data.regs?.rows;
  if (rows) {
    const noBooths = rows.filter((r) => !hasBooths(r)).length;
    const requests = rows.filter((r) => openRequestCount(r) > 0).length;
    const oddPaid = rows.filter(isInvalidPaid).length;
    const tests = rows.filter(isTestReg).length;
    // Booths given, no payment received (Ram, round 5): money waiting, right after any real payments to verify.
    // Needs the payments-received list; on live it undercounts payments until the server lists every
    // candidate type, so this number is high there until that fix.
    if (data.subs) {
      const unpaid = rows.filter((r) => boothsNotPaid(r, { paid: paidMobiles(data.subs) })).length;
      if (unpaid) items.push({ key: 'booths-unpaid', group: 'waiting', tone: 'warn', n: unpaid, detail: 'no payment received yet', to: '/registrations?show=booths-not-paid', short: `${plural(unpaid, 'candidate', 'candidates')} with booths, not paid`, text: `${plural(unpaid, 'candidate', 'candidates')} with booths assigned but no payment received yet` });
    }
    if (noBooths) items.push({ key: 'no-booths', group: 'waiting', tone: 'warn', n: noBooths, detail: "can't see their voters yet", to: '/registrations?show=no-booths', short: `${plural(noBooths, 'candidate', 'candidates')} without booths`, text: `registered ${plural(noBooths, 'candidate', 'candidates')} without booths · they can't see their voters yet` });
    if (requests) items.push({ key: 'requests', group: 'waiting', tone: 'info', n: requests, to: '/registrations?show=requests', short: `${plural(requests, 'broadcast request', 'broadcast requests')}`, text: `${plural(requests, 'candidate', 'candidates')} with a broadcast request waiting (SMS, voice or WhatsApp)` });
    if (oddPaid) items.push({ key: 'invalid-paid', group: 'cleanup', tone: 'bad', n: oddPaid, to: '/registrations?show=invalid-paid', short: `paid ${plural(oddPaid, 'status', 'statuses')} not Yes or No`, text: `${plural(oddPaid, 'registration', 'registrations')} with a paid status that isn't Yes or No` });
    if (data.subs) {
      // Registrations say "paid" and the Payments page lists what was received; they must agree
      const ctx = { paid: paidMobiles(data.subs) };
      const noPayment = rows.filter((r) => markedPaidNoPayment(r, ctx)).length;
      const notMarked = rows.filter((r) => paymentNotMarked(r, ctx)).length;
      if (noPayment) items.push({ key: 'paid-no-payment', group: 'cleanup', tone: 'bad', n: noPayment, to: '/registrations?show=paid-no-payment', short: 'marked paid, no payment', text: `${plural(noPayment, 'registration', 'registrations')} marked paid with no payment on record` });
      if (notMarked) items.push({ key: 'payment-not-marked', group: 'cleanup', tone: 'bad', n: notMarked, to: '/registrations?show=payment-not-marked', short: `${plural(notMarked, 'payment', 'payments')} not marked paid`, text: `${plural(notMarked, 'payment', 'payments')} received but the registration isn't marked paid` });
    }
    if (tests) items.push({ key: 'test', group: 'cleanup', tone: 'info', n: tests, to: '/registrations?show=test', short: `test ${plural(tests, 'registration', 'registrations')}`, text: `test ${plural(tests, 'registration', 'registrations')} in the data` });
  }
  const lead = items.find((i) => i.group === 'waiting' && !i.retry);
  if (lead) lead.lead = true;
  return items;
}

export const waitingItems = (items) => items.filter((i) => i.group === 'waiting');
export const cleanupItems = (items) => items.filter((i) => i.group === 'cleanup');
// How many people/records a list of items covers (the sum of their counts), not how many kinds.
export const countOf = (items) => items.reduce((s, i) => s + (Number(i.n) || 0), 0);

// "All clear" only when every list really loaded and nothing is waiting.
export const allClear = ({ data, errs }, items) => ['regs', 'utrs', 'subs'].every((k) => data[k] !== undefined && !errs[k]) && items.length === 0;
