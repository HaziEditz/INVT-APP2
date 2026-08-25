/**
 * #2 Offers Offered-browse: stuck Offered jobs must remain visible in pool browse.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'lib/pendingJobs.ts'), 'utf8');

test('parseJobOfferRecord allows Offered statuses when requirePending', () => {
  assert.match(src, /status !== 'offered'/);
  assert.match(src, /status !== 'offer'/);
  assert.match(src, /status !== 'offering'/);
  assert.match(src, /pool browse includes Pending and Offered/);
});

test('parseJobOfferRecord copies TM / prepaid payment stamps', () => {
  assert.match(src, /isTotalMobility/);
  assert.match(src, /tmCardNumber/);
  assert.match(src, /paymentStatus/);
  assert.match(src, /isPrePaid/);
});
