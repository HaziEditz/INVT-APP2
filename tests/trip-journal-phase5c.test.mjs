import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isProvisionalBookingId,
  isValidBookingId,
  localJobIdFromClientTripId,
} from '../lib/bookingId.ts';

test('Phase 5c bookingId: local: provisional ids are valid but provisional', () => {
  const id = localJobIdFromClientTripId('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
  assert.equal(id, 'local:a1b2c3d4-e5f6-7890-abcd-ef1234567890');
  assert.equal(isValidBookingId(id), true);
  assert.equal(isProvisionalBookingId(id), true);
  assert.equal(isProvisionalBookingId('86926061661'), false);
  assert.equal(isValidBookingId('86926061661'), true);
  assert.equal(isProvisionalBookingId('hail_123'), true);
});

test('Phase 5c bookingId: empty / junk rejected', () => {
  assert.equal(isValidBookingId(''), false);
  assert.equal(isValidBookingId('abc'), false);
  assert.equal(isValidBookingId('local:'), true);
});
