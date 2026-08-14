/**
 * Offline→online resume gate used by PaymentModal auto-retry.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldBumpNetworkResume } from '../lib/networkResume.ts';

test('shouldBumpNetworkResume only on offline→online', () => {
  assert.equal(shouldBumpNetworkResume(null, false), false); // first online tick
  assert.equal(shouldBumpNetworkResume(null, true), false); // first offline tick
  assert.equal(shouldBumpNetworkResume(false, false), false); // stay online
  assert.equal(shouldBumpNetworkResume(false, true), false); // online→offline
  assert.equal(shouldBumpNetworkResume(true, true), false); // stay offline
  assert.equal(shouldBumpNetworkResume(true, false), true); // offline→online
});
