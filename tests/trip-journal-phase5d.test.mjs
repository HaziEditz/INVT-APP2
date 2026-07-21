import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dispatchJournalKey,
  isProvisionalBookingId,
  isValidBookingId,
} from '../lib/bookingId.ts';
import { choosePendingSyncBanner } from '../lib/pendingSyncBannerChoice.ts';

test('Phase 5d dispatch journal key is stable per numeric job', () => {
  assert.equal(dispatchJournalKey('86926061661'), 'job:86926061661');
  assert.equal(dispatchJournalKey(86926061661), 'job:86926061661');
});

test('Phase 5d numeric dispatch ids are not provisional', () => {
  assert.equal(isValidBookingId('86926061661'), true);
  assert.equal(isProvisionalBookingId('86926061661'), false);
  assert.equal(isProvisionalBookingId('local:abc'), true);
});

test('Phase 5d syncing banner: cancel / no-show / mixed / stages', () => {
  const at = 1_700_000_000_000;
  assert.deepEqual(choosePendingSyncBanner(['cancel'], false, at), {
    message: 'Syncing cancel…',
    reason: 'cancel',
    at,
  });
  assert.deepEqual(choosePendingSyncBanner(['no_show'], false, at), {
    message: 'Syncing no-show…',
    reason: 'no_show',
    at,
  });
  assert.deepEqual(choosePendingSyncBanner(['cancel', 'no_show'], false, at), {
    message: 'Syncing…',
    reason: 'mixed',
    at,
  });
  assert.deepEqual(choosePendingSyncBanner(['cancel'], true, at), {
    message: 'Syncing…',
    reason: 'mixed',
    at,
  });
  assert.deepEqual(choosePendingSyncBanner([], true, at), {
    message: 'Syncing…',
    reason: 'stages',
    at,
  });
  assert.equal(choosePendingSyncBanner(['complete'], false, at), null);
  assert.equal(choosePendingSyncBanner([], false, at), null);
});
