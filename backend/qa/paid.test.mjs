// node --test backend/qa/paid.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { isPaid, paidFlag, PAID_VALUES } from '../src/utils/paid.js';

test('every spelling of paid counts as paid', () => {
  for (const v of ['Yes', 'yes', 'YES', 'y', '1', 1, true, 'true', 'Paid', ' yes ']) assert.equal(isPaid(v), true, String(v));
});
test('everything else is unpaid', () => {
  for (const v of ['No', 'no', '0', 0, false, '', null, undefined, '-', 'pending', 'Yesterday']) assert.equal(isPaid(v), false, String(v));
});
test('paidFlag normalises to Yes/No', () => {
  assert.equal(paidFlag(1), 'Yes'); assert.equal(paidFlag('No'), 'No'); assert.equal(paidFlag(undefined), 'No');
});
test('PAID_VALUES (for Mongo $in) agrees with isPaid', () => {
  for (const v of PAID_VALUES) assert.equal(isPaid(v), true, String(v));
});
