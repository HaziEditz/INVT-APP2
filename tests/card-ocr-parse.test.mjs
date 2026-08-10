import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessCardScanQuality,
  normalizeCardNumberCandidate,
  normalizeExpiryCandidate,
  parseCardOcrText,
  passesLuhn,
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
  assert.equal(passesLuhn(got.cardNumber), true);
});

test('normalize helpers', () => {
  assert.equal(normalizeCardNumberCandidate('413532 - 03'), '413532-03');
  assert.equal(normalizeCardNumberCandidate('02418442'), ''); // truncated — not a PAN
  assert.equal(normalizeExpiryCandidate('exp 3/2028'), undefined); // needs zero-padded month
  assert.equal(normalizeExpiryCandidate('03/2028'), '03/28');
});

test('parseCardOcrText tolerates empty / garbage', () => {
  assert.deepEqual(parseCardOcrText(''), {});
  assert.deepEqual(parseCardOcrText(['VISA', 'DEBIT']), {});
});

test('parseCardOcrText ignores Authorized Signature strip label', () => {
  const text = `
VISA
AUTHORIZED SIGNATURE
JANE DOE
4111 1111 1111 1111
03/28
`;
  const got = parseCardOcrText(text);
  assert.equal(got.cardName, 'JANE DOE');
  assert.notEqual(got.cardName, 'AUTHORIZED SIGNATURE');
  assert.equal(got.cardNumber, '4111111111111111');
});

test('parseCardOcrText rejects blurry truncated PAN and fragment name', () => {
  const text = `
AME BG H AT
02418442
03/28
`;
  const got = parseCardOcrText(text);
  assert.equal(got.cardNumber, undefined);
  assert.equal(got.cardName, undefined);
  assert.equal(got.cardExpiry, '03/28');
});

test('assessCardScanQuality rejects truncated PAN and prompts rescan', () => {
  const parsed = parseCardOcrText(`
AME BG H AT
02418442
03/28
`);
  const q = assessCardScanQuality(parsed, 'AME BG H AT\n02418442\n03/28');
  assert.equal(q.ok, false);
  assert.match(String(q.reason), /scan again|card number/i);
  assert.equal(q.fields.cardNumber, undefined);
});

test('assessCardScanQuality accepts clean bank card read', () => {
  const text = `
VISA
JOHN Q PUBLIC
4111 1111 1111 1111
12/28
`;
  const parsed = parseCardOcrText(text);
  const q = assessCardScanQuality(parsed, text);
  assert.equal(q.ok, true);
  assert.equal(q.fields.cardNumber, '4111111111111111');
  assert.equal(q.fields.cardName, 'JOHN Q PUBLIC');
});

test('assessCardScanQuality rejects near-empty OCR as unclear photo', () => {
  const q = assessCardScanQuality({}, '.\n');
  assert.equal(q.ok, false);
  assert.match(String(q.reason), /unclear|scan again/i);
});
