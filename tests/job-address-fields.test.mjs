import assert from 'node:assert/strict';
import test from 'node:test';
import {
  firstNonEmptyString,
  readDropoffAddress,
  readPickupAddress,
} from '../lib/jobAddressFields.ts';

test('firstNonEmptyString skips blanks', () => {
  assert.equal(firstNonEmptyString('', '  ', 'Real St'), 'Real St');
  assert.equal(firstNonEmptyString(null, undefined, ''), '');
});

test('readDropoffAddress accepts DropAddress (dispatch booking key)', () => {
  assert.equal(
    readDropoffAddress({ DropAddress: '88 Karangahape Rd', dropoff: '' }),
    '88 Karangahape Rd',
  );
  assert.equal(readDropoffAddress({ jobdropoff: 'Via jobdropoff' }), 'Via jobdropoff');
  assert.equal(readDropoffAddress({ to: 'Via to' }), 'Via to');
});

test('readPickupAddress accepts PickAddress', () => {
  assert.equal(
    readPickupAddress({ PickAddress: '12 Queen St', pickup: '' }),
    '12 Queen St',
  );
});
