/**
 * Desk PIN-scope + cash-not-prepaid (live #86926090742).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isDispatchCreatedBooking,
  isPrepaidUpfrontJob,
  jobShowsAsAlreadyPaid,
  needsPickupVerification,
} from '../lib/pickupResolution.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('desk cash leftover paid is not prepaid and not PIN-group', () => {
  const live = {
    BookingSource: 'Dispatch Console',
    bookingSource: 'Dispatch Console',
    PaymentType: 'cash',
    paymentType: 'Cash',
    paymentStatus: 'paid',
    isPrePaid: false,
    pickupPin: '',
  };
  assert.equal(isDispatchCreatedBooking(live), true);
  assert.equal(isPrepaidUpfrontJob(live), false);
  assert.equal(needsPickupVerification(live), false);
  assert.equal(jobShowsAsAlreadyPaid(live), false);
});

test('empty source without PIN is treated as desk (lost BookingSource on phone)', () => {
  const lostSrc = {
    PaymentType: 'cash',
    paymentStatus: 'paid',
    pickupPin: '',
  };
  assert.equal(isDispatchCreatedBooking(lostSrc), true);
  assert.equal(needsPickupVerification(lostSrc), false);
});

test('website card paid still needs PIN verify', () => {
  assert.equal(
    needsPickupVerification({
      BookingSource: 'Website',
      PaymentType: 'Card',
      paymentStatus: 'paid',
    }),
    true,
  );
  assert.equal(
    jobShowsAsAlreadyPaid({
      BookingSource: 'Website',
      PaymentType: 'Card',
      paymentStatus: 'paid',
    }),
    true,
  );
});

test('Confirm PIN button is not disabled when pickupPin is empty', () => {
  const src = readFileSync(join(root, 'components/home/CurrentTripPanel.tsx'), 'utf8');
  assert.match(src, /Confirm PIN & name — unlock On Board/);
  assert.doesNotMatch(
    src,
    /disabled=\{completionBusy \|\| !\(activeJob\.pickupPin/,
  );
});

test('On Board gate uses needsPickupVerification (not leftover paid/PIN)', () => {
  const src = readFileSync(join(root, 'context/DriverContext.tsx'), 'utf8');
  assert.match(src, /if \(needsPickupVerification\(activeJob\) && !activeJob\.pickupVerifiedAt\)/);
});
