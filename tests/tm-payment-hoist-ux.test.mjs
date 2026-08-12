/**
 * TM PaymentModal hoist UX: Yes/No silent first hoist, remaining pay after, breakdown.
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
import { isCompleteCardholderName } from '../lib/tmPaymentPersist.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const modalSrc = readFileSync(join(root, 'components/PaymentModal.tsx'), 'utf8');

/** Mirrors PaymentModal.tmCanReview gating for the corrected flow. */
function canReviewTm(opts) {
  const {
    remainder = '',
    isWav = true,
    hoistUsedAnswer = null,
    hoistRows = [],
    tmCardNumber = '',
    tmCardExpiry = '',
    tmCardName = '',
  } = opts;
  const primaryCardReady =
    !!String(tmCardNumber || '').trim() && isCompleteCardholderName(tmCardName);
  const hoistQuestionDone = !isWav || hoistUsedAnswer != null;
  if (!primaryCardReady) return false;
  if (!hoistQuestionDone) return false;
  if (!remainder) return false;
  if (isWav && hoistUsedAnswer === 'yes') {
    if (hoistRows.length < 1) return false;
    if (hoistRows.some((r) => !String(r.cardNumber || '').trim())) return false;
    if (hoistRows.some((r) => !isCompleteCardholderName(r.cardName))) return false;
  }
  const entries = buildTmHoistEntries(
    hoistUsedAnswer === 'yes' ? hoistRows : [],
    11,
  );
  const primary = resolvePrimaryTmCard(tmCardNumber, tmCardExpiry, entries, tmCardName);
  if (!primary.tmCardNumber || !isCompleteCardholderName(primary.tmCardName)) return false;
  return true;
}

/** Same as onHoistYes: silent first hoist from primary. */
function silentFirstHoist(primaryCard, primaryName, primaryExpiry = '') {
  return [
    {
      cardNumber: primaryCard,
      cardExpiry: primaryExpiry,
      cardName: primaryName,
    },
  ];
}

test('Yes on hoist: silent first entry from primary — no extra fields needed', () => {
  const primaryCard = '41353203';
  const primaryName = 'Jane Doe';
  const primaryExpiry = '11/27';
  const hoistRows = silentFirstHoist(primaryCard, primaryName, primaryExpiry);
  const entries = buildTmHoistEntries(hoistRows, 11);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].cardNumber, primaryCard);
  assert.equal(entries[0].cardName, primaryName);
  assert.equal(entries[0].amount, 11);
  assert.equal(
    canReviewTm({
      remainder: 'Cash',
      hoistUsedAnswer: 'yes',
      hoistRows,
      tmCardNumber: primaryCard,
      tmCardName: primaryName,
      tmCardExpiry: primaryExpiry,
    }),
    true,
  );
});

test('No on hoist: skip hoist rows, remaining payment still required', () => {
  assert.equal(
    canReviewTm({
      remainder: '',
      hoistUsedAnswer: 'no',
      hoistRows: [],
      tmCardNumber: '111',
      tmCardName: 'Pat Lee',
    }),
    false,
  );
  assert.equal(
    canReviewTm({
      remainder: 'Cash',
      hoistUsedAnswer: 'no',
      hoistRows: [],
      tmCardNumber: '111',
      tmCardName: 'Pat Lee',
    }),
    true,
  );
});

test('WAV blocked until hoist Yes/No answered', () => {
  assert.equal(
    canReviewTm({
      remainder: 'Cash',
      hoistUsedAnswer: null,
      hoistRows: [],
      tmCardNumber: '111',
      tmCardName: 'Pat Lee',
    }),
    false,
  );
});

test('Add more hoist: extra row needs its own card + name', () => {
  const hoistRows = [
    ...silentFirstHoist('111', 'Primary WAV'),
    { cardNumber: '222', cardName: '', cardExpiry: '' },
  ];
  assert.equal(
    canReviewTm({
      remainder: 'Cash',
      hoistUsedAnswer: 'yes',
      hoistRows,
      tmCardNumber: '111',
      tmCardName: 'Primary WAV',
    }),
    false,
  );
  hoistRows[1].cardName = 'Extra WAV';
  assert.equal(
    canReviewTm({
      remainder: 'Cash',
      hoistUsedAnswer: 'yes',
      hoistRows,
      tmCardNumber: '111',
      tmCardName: 'Primary WAV',
    }),
    true,
  );
});

test('primary card + full name required before review', () => {
  assert.equal(
    canReviewTm({
      remainder: 'Cash',
      hoistUsedAnswer: 'no',
      tmCardNumber: '111',
      tmCardName: 'Marianne',
    }),
    false,
  );
  assert.equal(
    canReviewTm({
      remainder: 'Cash',
      hoistUsedAnswer: 'no',
      tmCardNumber: '',
      tmCardName: '',
    }),
    false,
  );
});

test('PaymentModal source: corrected order + silent Yes + hoist $ on confirm', () => {
  assert.match(modalSrc, /1\. Primary TM card \*/);
  assert.match(modalSrc, /2\. Hoist used\?/);
  assert.match(modalSrc, /onHoistYes/);
  assert.match(modalSrc, /Hoist recorded/);
  assert.match(modalSrc, /Add more hoist/);
  assert.match(modalSrc, /Remaining payment method \*/);
  assert.match(modalSrc, /primaryCardReady && hoistQuestionDone/);
  assert.match(modalSrc, /Review payment →/);
  assert.match(modalSrc, /tmConfirm/);
  assert.match(modalSrc, /Confirm TM payment/);
  assert.match(modalSrc, /Confirm Payment/);
  assert.match(modalSrc, /Hoist fee \(/);
  assert.match(modalSrc, /Passenger \(meter share\)/);
  assert.match(modalSrc, /tmConfigConfirmBlockReason/);
  assert.match(modalSrc, /tmConfigLoading/);
  assert.doesNotMatch(modalSrc, /title="Done"/);
  assert.doesNotMatch(modalSrc, /Use primary card/);
  assert.doesNotMatch(modalSrc, /Prefill from primary/);
  assert.doesNotMatch(modalSrc, /2\. Primary TM card \(optional\)/);
});
