/**
 * TM PaymentModal hoist UX: same-card prefill, names, review gating.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildTmHoistEntries,
  resolvePrimaryTmCard,
} from '../lib/tmConfigLogic.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const modalSrc = readFileSync(join(root, 'components/PaymentModal.tsx'), 'utf8');

function canReviewTm(opts) {
  const {
    remainder = '',
    isWav = true,
    hoistRows = [],
    tmCardNumber = '',
    tmCardExpiry = '',
    tmCardName = '',
  } = opts;
  if (!remainder) return false;
  if (isWav && hoistRows.some((r) => !String(r.cardNumber || '').trim())) return false;
  if (
    isWav &&
    hoistRows.some((r) => String(r.cardNumber || '').trim() && !String(r.cardName || '').trim())
  ) {
    return false;
  }
  const entries = buildTmHoistEntries(hoistRows, 11);
  const primary = resolvePrimaryTmCard(tmCardNumber, tmCardExpiry, entries, tmCardName);
  if (primary.tmCardNumber && !primary.tmCardName) return false;
  if (!primary.tmCardNumber && !(isWav && entries.length > 0)) return false;
  return true;
}

test('single wheelchair passenger: primary card prefills hoist — no redundant entry', () => {
  const primaryCard = '41353203';
  const primaryName = 'Jane Doe';
  const primaryExpiry = '11/27';
  // Same UX as addHoistRow when primary is set
  const hoistRows = [
    {
      cardNumber: primaryCard,
      cardExpiry: primaryExpiry,
      cardName: primaryName,
    },
  ];
  const entries = buildTmHoistEntries(hoistRows, 11);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].cardNumber, primaryCard);
  assert.equal(entries[0].cardName, primaryName);
  const primary = resolvePrimaryTmCard(primaryCard, primaryExpiry, entries, primaryName);
  assert.equal(primary.tmCardNumber, primaryCard);
  assert.equal(primary.tmCardName, primaryName);
  assert.equal(canReviewTm({ remainder: 'Cash', hoistRows, tmCardNumber: primaryCard, tmCardName: primaryName, tmCardExpiry: primaryExpiry }), true);
});

test('hoist-only: first hoist card+name becomes primary without separate primary fields', () => {
  const hoistRows = [{ cardNumber: '999', cardExpiry: '01/28', cardName: 'Sam WAV' }];
  const entries = buildTmHoistEntries(hoistRows, 11);
  const primary = resolvePrimaryTmCard('', undefined, entries, '');
  assert.equal(primary.tmCardNumber, '999');
  assert.equal(primary.tmCardName, 'Sam WAV');
  assert.equal(canReviewTm({ remainder: 'EFTPOS', hoistRows }), true);
});

test('review blocked until remaining payment explicitly selected', () => {
  const hoistRows = [{ cardNumber: '111', cardName: 'Pat', cardExpiry: '' }];
  assert.equal(canReviewTm({ remainder: '', hoistRows, tmCardNumber: '111', tmCardName: 'Pat' }), false);
  assert.equal(canReviewTm({ remainder: 'Cash', hoistRows, tmCardNumber: '111', tmCardName: 'Pat' }), true);
});

test('review blocked when hoist card missing passenger name', () => {
  const hoistRows = [{ cardNumber: '111', cardName: '', cardExpiry: '' }];
  assert.equal(canReviewTm({ remainder: 'Cash', hoistRows }), false);
});

test('PaymentModal source: review/confirm flow, names, no bare Done', () => {
  assert.match(modalSrc, /Passenger \/ cardholder name \*/);
  assert.match(modalSrc, /Use primary card/);
  assert.match(modalSrc, /Prefill from primary/);
  assert.match(modalSrc, /Review payment →/);
  assert.match(modalSrc, /tmConfirm/);
  assert.match(modalSrc, /Confirm TM payment/);
  assert.match(modalSrc, /Select payment method/);
  assert.doesNotMatch(modalSrc, /title="Done"/);
  assert.match(modalSrc, /cardName/);
});
