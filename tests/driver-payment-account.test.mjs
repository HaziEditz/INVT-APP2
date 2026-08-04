import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeDriverPaymentType,
  readAccountFieldsFromRecord,
} from '../lib/driverPayment.ts';
import {
  derivePresenceWriteStatusFromIntent,
  presenceWhilePendingTripSync,
} from '../lib/tripJournalFlushPolicy.ts';

test('normalizeDriverPaymentType maps account casing variants', () => {
  assert.equal(normalizeDriverPaymentType('account'), 'Account');
  assert.equal(normalizeDriverPaymentType('Account'), 'Account');
  assert.equal(normalizeDriverPaymentType('Account/Corporate'), 'Account');
  assert.equal(normalizeDriverPaymentType('cash'), 'Cash');
  assert.equal(normalizeDriverPaymentType('CARD'), 'Card');
});

test('readAccountFieldsFromRecord accepts jobAccount* and Account_* mirrors', () => {
  assert.deepEqual(
    readAccountFieldsFromRecord({
      jobAccountId: '-OUNEPJIYVKHAAC6CFTN',
      jobAccountName: 'Invercargill taxis',
    }),
    {
      accountId: '-OUNEPJIYVKHAAC6CFTN',
      accountName: 'Invercargill taxis',
    },
  );
  assert.deepEqual(
    readAccountFieldsFromRecord({
      Account_id: 'abc',
      Account_Name: 'Acme Co',
    }),
    { accountId: 'abc', accountName: 'Acme Co' },
  );
});

test('pending sync keeps Busy even when Away intent is set', () => {
  assert.equal(
    presenceWhilePendingTripSync({
      away: true,
      hasLocalTrip: false,
      pendingJournalWork: true,
    }),
    'Busy',
  );
  assert.equal(
    derivePresenceWriteStatusFromIntent({
      awayIntent: 'missed',
      hasPaymentJob: false,
      activeStage: null,
      hailActive: false,
      pendingJournalWork: true,
    }),
    'Busy',
  );
});

test('manual Away still wins when no trip and no pending sync', () => {
  assert.equal(
    derivePresenceWriteStatusFromIntent({
      awayIntent: 'manual',
      hasPaymentJob: false,
      activeStage: null,
      hailActive: false,
      pendingJournalWork: false,
    }),
    'Away',
  );
});
