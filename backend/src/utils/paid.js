// What counts as "paid". The records are not uniform: most say 'Yes'/'No', one real candidate has the
// number 1 (2026-10-14), older code wrote 'yes'/true in places. Every check in the backend goes through here
// so a candidate is never locked out by the spelling of a flag. Use PAID_VALUES in Mongo queries.
export const PAID_VALUES = ['Yes', 'yes', 'YES', 'Y', 'y', '1', 1, true, 'true', 'TRUE', 'Paid', 'paid'];
export const isPaid = (v) => /^(yes|y|1|true|paid)$/i.test(String(v ?? '').trim());
export const paidFlag = (v) => (isPaid(v) ? 'Yes' : 'No');
