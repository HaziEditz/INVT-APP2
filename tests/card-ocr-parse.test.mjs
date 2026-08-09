import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeCardNumberCandidate,
  normalizeExpiryCandidate,
  parseCardOcrText,
} from '../lib/cardOcrParse.ts';

test('parseCardOcrText extracts TM-style id, name, expiry', () => {
  const text = `
TOTAL MOBILITY
MARIANNE SMITH
413532-03
VALID THRU 08/27
`;
  assert.deepEqual(parseCardOcrText(text), {
    cardNumber: '413532-03',
    cardName: 'MARIANNE SMITH',
    cardExpiry: '08/27',
  });
});

test('parseCardOcrText extracts bank PAN digit run', () => {
  const text = `
VISA
JOHN Q PUBLIC
4111 1111 1111 1111
12/28
`;
  const got = parseCardOcrText(text);
  assert.equal(got.cardNumber, '4111111111111111');
  assert.equal(got.cardName, 'JOHN Q PUBLIC');
  assert.equal(got.cardExpiry, '12/28');
});

test('normalize helpers', () => {
  assert.equal(normalizeCardNumberCandidate('413532 - 03'), '413532-03');
  assert.equal(normalizeExpiryCandidate('exp 3/2028'), undefined); // needs zero-padded month
  assert.equal(normalizeExpiryCandidate('03/2028'), '03/28');
});

test('parseCardOcrText tolerates empty / garbage', () => {
  assert.deepEqual(parseCardOcrText(''), {});
  assert.deepEqual(parseCardOcrText(['VISA', 'DEBIT']), {});
});
