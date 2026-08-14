/**
 * TM remainder transaction fee — collect-only, never touches subsidy math.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calcTmPaymentBreakdown } from '../lib/tmConfigLogic.ts';
import { buildTmPersistFields, pickTmFieldsFromPayload } from '../lib/tmPaymentPersist.ts';
import {
  claimMeterSubsidyFromRecord,
  claimPassengerShareFromRecord,
  parseTransactionFeeAmount,
  passengerCollectedTotal,
  tmTransactionFeeLabel,
} from '../lib/tmTransactionFee.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const modalSrc = readFileSync(join(root, 'components/PaymentModal.tsx'), 'utf8');
const invtServer = readFileSync(join(root, '..', 'INVT', 'server.js'), 'utf8');

const TM_CFG = {
  councilSubsidyPercent: 65,
  councilCapAmount: 35,
  hoistCostPerUnit: 11,
  sourceCouncilId: 'cncl_invercargill_city_council_test',
};

test('parseTransactionFeeAmount ignores blanks and negatives', () => {
  assert.equal(parseTransactionFeeAmount(''), 0);
  assert.equal(parseTransactionFeeAmount('abc'), 0);
  assert.equal(parseTransactionFeeAmount('-1'), 0);
  assert.equal(parseTransactionFeeAmount('2.00'), 2);
  assert.equal(parseTransactionFeeAmount('2.2'), 2.2);
  assert.equal(parseTransactionFeeAmount('2.26'), 2.26);
});

test('tmTransactionFeeLabel adapts by remainder method', () => {
  assert.equal(tmTransactionFeeLabel('EFTPOS'), 'EFTPOS fee');
  assert.equal(tmTransactionFeeLabel('Card'), 'Card fee');
  assert.equal(tmTransactionFeeLabel('Cash'), 'Cash fee');
  assert.equal(tmTransactionFeeLabel(''), 'Transaction fee');
});

test('fee adds to collected total only — Cash and Card leave council identical', () => {
  const meter = 6.49;
  const split = calcTmPaymentBreakdown(meter, 0, TM_CFG);
  const feeCash = 2;
  const feeCard = 1.5;

  const cash = buildTmPersistFields(
    {
      councilPays: split.councilPays,
      passengerPays: split.passengerPays,
      meterFare: split.meterFare,
      tmSubsidyFare: split.councilPaysMeter,
      totalFare: split.totalFare,
      tmCardNumber: '41353203',
      tmCardName: 'Jane Doe',
      transactionFee: feeCash,
      passengerCollectedTotal: passengerCollectedTotal(split.passengerPays, feeCash),
    },
    { remainderPaymentType: 'Cash', councilId: TM_CFG.sourceCouncilId },
  );
  const card = buildTmPersistFields(
    {
      councilPays: split.councilPays,
      passengerPays: split.passengerPays,
      meterFare: split.meterFare,
      tmSubsidyFare: split.councilPaysMeter,
      totalFare: split.totalFare,
      tmCardNumber: '41353203',
      tmCardName: 'Jane Doe',
      transactionFee: feeCard,
      passengerCollectedTotal: passengerCollectedTotal(split.passengerPays, feeCard),
    },
    { remainderPaymentType: 'Card', councilId: TM_CFG.sourceCouncilId },
  );
  const none = buildTmPersistFields(
    {
      councilPays: split.councilPays,
      passengerPays: split.passengerPays,
      meterFare: split.meterFare,
      tmSubsidyFare: split.councilPaysMeter,
      totalFare: split.totalFare,
      tmCardNumber: '41353203',
      tmCardName: 'Jane Doe',
    },
    { remainderPaymentType: 'EFTPOS', councilId: TM_CFG.sourceCouncilId },
  );

  assert.equal(claimMeterSubsidyFromRecord(cash), split.councilPaysMeter);
  assert.equal(claimMeterSubsidyFromRecord(card), split.councilPaysMeter);
  assert.equal(claimMeterSubsidyFromRecord(none), split.councilPaysMeter);
  assert.equal(cash.tmCouncilPays, card.tmCouncilPays);
  assert.equal(cash.tmCouncilPays, none.tmCouncilPays);
  assert.equal(cash.tmSubsidyFare, none.tmSubsidyFare);

  assert.equal(claimPassengerShareFromRecord(cash), split.passengerPays);
  assert.equal(claimPassengerShareFromRecord(card), split.passengerPays);
  assert.equal(cash.passengerPays, split.passengerPays);
  assert.equal(cash.tmPassengerPays, split.passengerPays);

  assert.equal(cash.transactionFee, 2);
  assert.equal(card.transactionFee, 1.5);
  assert.equal(none.transactionFee, undefined);
  assert.equal(cash.passengerCollectedTotal, +(split.passengerPays + feeCash).toFixed(2));
  assert.equal(card.passengerCollectedTotal, +(split.passengerPays + feeCard).toFixed(2));

  // Fee must not inflate meter / totalFare economic fields.
  assert.equal(cash.tmMeterFare, meter);
  assert.equal(cash.tmTotalFare, split.totalFare);
});

test('pickTmFieldsFromPayload forwards transactionFee without mutating subsidy', () => {
  const picked = pickTmFieldsFromPayload({
    isTotalMobility: true,
    tmCouncilPays: 4.22,
    tmPassengerPays: 2.27,
    tmSubsidyFare: 4.22,
    passengerPays: 2.27,
    transactionFee: 2,
    passengerCollectedTotal: 4.27,
    tmRemainderPaymentType: 'Cash',
  });
  assert.ok(picked);
  assert.equal(picked.tmCouncilPays, 4.22);
  assert.equal(picked.tmPassengerPays, 2.27);
  assert.equal(picked.transactionFee, 2);
  assert.equal(picked.passengerCollectedTotal, 4.27);
  assert.equal(claimMeterSubsidyFromRecord(picked), 4.22);
});

test('PaymentModal wires generic fee outside meterSubtotal / extrasTotal', () => {
  assert.match(modalSrc, /tmTransactionFeeAmt/);
  assert.match(modalSrc, /tmTransactionFeeLabel/);
  assert.match(modalSrc, /passengerCollectedTotal/);
  assert.match(modalSrc, /tmFeeLabel/);
  // Must not fold TM fee into extrasTotal / meter path used by calcTmPaymentBreakdown.
  assert.doesNotMatch(
    modalSrc,
    /extrasTotal \+=[\s\S]{0,120}tmTransactionFee/,
  );
  assert.match(modalSrc, /added on top of passenger share only/);
  assert.match(modalSrc, /does not change council subsidy/);
});

test('dispatch complete whitelist includes transactionFee (persist path)', () => {
  assert.match(invtServer, /'transactionFee',\s*'passengerCollectedTotal'/);
  const whitelistIdx = invtServer.indexOf('function _completePayloadFieldKeys');
  const snippet = invtServer.slice(whitelistIdx, whitelistIdx + 2500);
  assert.match(snippet, /transactionFee/);
  assert.match(snippet, /passengerCollectedTotal/);
});
