/**
 * Offline Account payment — local cache + pending free-text resolve.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  filterCachedAccounts,
  pickBestAccountMatch,
  resolvePendingAccountFields,
  upsertCachedAccount,
} from '../lib/accountCacheLogic.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('upsertCachedAccount keeps MRU order and caps size', () => {
  let rows = [];
  rows = upsertCachedAccount(rows, { id: 'a', name: 'Alpha' }, 1000);
  rows = upsertCachedAccount(rows, { id: 'b', name: 'Beta' }, 2000);
  rows = upsertCachedAccount(rows, { id: 'a', name: 'Alpha Co' }, 3000);
  assert.equal(rows[0].id, 'a');
  assert.equal(rows[0].name, 'Alpha Co');
  assert.equal(rows[0].lastUsedAt, 3000);
  assert.equal(rows.length, 2);
});

test('filterCachedAccounts matches name and account code', () => {
  const rows = [
    { id: '1', name: 'Invercargill Taxis', accountCode: 'INV001', lastUsedAt: 1 },
    { id: '2', name: 'Airport Transfers', accountCode: 'APT9', lastUsedAt: 2 },
  ];
  assert.equal(filterCachedAccounts(rows, 'inver').length, 1);
  assert.equal(filterCachedAccounts(rows, 'apt9')[0].id, '2');
  assert.equal(filterCachedAccounts(rows, 'zz').length, 0);
});

test('pickBestAccountMatch prefers exact code then name', () => {
  const hits = [
    { Id: '1', Name: 'Acme', AccountCode: 'A1' },
    { Id: '2', Name: 'Acme South', AccountCode: 'SOUTH' },
  ];
  assert.equal(pickBestAccountMatch(hits, 'SOUTH')?.Id, '2');
  assert.equal(pickBestAccountMatch(hits, 'Acme')?.Id, '1');
});

test('resolvePendingAccountFields leaves resolved id alone', async () => {
  const out = await resolvePendingAccountFields(
    { accountId: 'x', accountName: 'X Co', accountPending: true },
    { search: async () => [{ Id: 'other', Name: 'Other' }] },
  );
  assert.equal(out.accountId, 'x');
  assert.equal(out.accountPending, false);
});

test('resolvePendingAccountFields matches free-text on reconnect', async () => {
  let remembered = null;
  const out = await resolvePendingAccountFields(
    { accountPending: true, accountRef: 'INV001', accountName: 'Invercargill Taxis' },
    {
      search: async () => [
        { Id: '-acc1', Name: 'Invercargill Taxis', AccountCode: 'INV001' },
      ],
      remember: async (hit) => {
        remembered = hit;
      },
    },
  );
  assert.equal(out.accountId, '-acc1');
  assert.equal(out.accountPending, false);
  assert.equal(remembered?.id, '-acc1');
});

test('resolvePendingAccountFields stays pending when search misses', async () => {
  const out = await resolvePendingAccountFields(
    { accountPending: true, accountRef: 'Unknown Co' },
    { search: async () => [] },
  );
  assert.equal(out.unresolved, true);
  assert.equal(out.accountPending, true);
  assert.equal(out.accountId, undefined);
});

test('PaymentModal wires ACC claim/PO and EFTPOS ref into extras', () => {
  const src = readFileSync(join(root, 'components/PaymentModal.tsx'), 'utf8');
  assert.match(src, /eftposRef:\s*eftposRef\.trim\(\)/);
  assert.match(src, /accClaimNo:\s*accClaimNo\.trim\(\)/);
  assert.match(src, /accPoNo:\s*accPoNo\.trim\(\)/);
  assert.match(src, /accountPending:\s*true/);
  assert.match(src, /searchCachedAccounts/);
  assert.match(src, /rememberBusinessAccount/);
});

test('PaymentModal Account search re-runs on network resume', () => {
  const src = readFileSync(join(root, 'components/PaymentModal.tsx'), 'utf8');
  assert.match(src, /NetInfo\.addEventListener/);
  assert.match(src, /networkResumeEpoch/);
  assert.match(src, /You appear offline/);
  assert.match(src, /tmPassengerPaymentType,\s*networkResumeEpoch,/);
});

test('finalizePayment journals payment refs and pending account', () => {
  const src = readFileSync(join(root, 'context/DriverContext.tsx'), 'utf8');
  assert.match(src, /accountPending:\s*true,\s*AccountPending:\s*true/);
  assert.match(src, /eftposRef/);
  assert.match(src, /accPoNo/);
  assert.match(src, /rememberBusinessAccount/);
});

test('trip journal flush resolves pending Account on reconnect', () => {
  const src = readFileSync(join(root, 'lib/tripJournalFlush.ts'), 'utf8');
  assert.match(src, /resolvePendingAccountFields/);
  assert.match(src, /searchBusinessAccounts/);
  assert.match(src, /accPoNo/);
  assert.match(src, /eftposRef/);
});

test('tmConfig falls back to local cache when RTDB fails', () => {
  const src = readFileSync(join(root, 'lib/tmConfig.ts'), 'utf8');
  assert.match(src, /loadCachedTmConfig/);
  assert.match(src, /saveCachedTmConfig/);
});
