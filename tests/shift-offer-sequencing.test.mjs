import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isAutoDispatchEligibleStatus,
  shouldShowOfferPopupNow,
} from '../lib/shiftOfferSequencing.ts';

test('offer popup waits for readyForJobs (post-login bootstrap)', () => {
  assert.equal(shouldShowOfferPopupNow(false), false);
  assert.equal(shouldShowOfferPopupNow(true), true);
});

test('only Available is auto-dispatch eligible (Away bootstrap is not)', () => {
  assert.equal(isAutoDispatchEligibleStatus('Available'), true);
  assert.equal(isAutoDispatchEligibleStatus('Away'), false);
  assert.equal(isAutoDispatchEligibleStatus('Offline'), false);
  assert.equal(isAutoDispatchEligibleStatus(''), false);
});
