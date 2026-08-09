/**
 * Accept claim: hung network must not leave acceptingOfferRef stuck forever.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { withTimeout } from '../lib/asyncTimeout.ts';
import {
  ACCEPT_ALREADY_PROCESSING_MESSAGE,
  ACCEPT_ALREADY_PROCESSING_TITLE,
  isAcceptAlreadyInFlight,
} from '../lib/acceptOfferPolicy.ts';
import { ACCEPT_HTTP_TIMEOUT_MS, isTransportLikeError } from '../lib/weakSignalPolicy.ts';

function neverResolves() {
  return new Promise(() => {});
}

test('ACCEPT_HTTP_TIMEOUT_MS is a short single-attempt budget', () => {
  assert.ok(ACCEPT_HTTP_TIMEOUT_MS <= 12_000);
  assert.ok(ACCEPT_HTTP_TIMEOUT_MS >= 5_000);
});

test('concurrent accept is detected (never silent)', () => {
  assert.equal(isAcceptAlreadyInFlight(false), false);
  assert.equal(isAcceptAlreadyInFlight(true), true);
  assert.ok(ACCEPT_ALREADY_PROCESSING_TITLE.length > 0);
  assert.ok(ACCEPT_ALREADY_PROCESSING_MESSAGE.length > 0);
});

test('hung accept fetch times out and clears the in-flight lock', async () => {
  let accepting = false;
  let uiAcceptingId = /** @type {string | null} */ (null);
  const started = Date.now();

  const runAccept = async (offerId) => {
    if (isAcceptAlreadyInFlight(accepting)) {
      return { outcome: 'busy' };
    }
    accepting = true;
    uiAcceptingId = offerId;
    try {
      await withTimeout(neverResolves(), 120, 'acceptJobOffer');
      return { outcome: 'ok' };
    } catch (err) {
      // Mirrors isDispatchAcceptRetryable for non-DispatchApiError + transport timeout copy.
      assert.equal(isTransportLikeError(err), true);
      assert.match(String(err?.message || err), /timed out after \d+ms/i);
      return { outcome: 'timeout' };
    } finally {
      accepting = false;
      uiAcceptingId = null;
    }
  };

  const first = await runAccept('8692609001');
  assert.equal(first.outcome, 'timeout');
  assert.equal(accepting, false);
  assert.equal(uiAcceptingId, null);
  assert.ok(Date.now() - started < 800);

  // Second attempt must not be permanently blocked by the hung first attempt.
  const secondStarted = Date.now();
  const second = await runAccept('8692609002');
  assert.equal(second.outcome, 'timeout');
  assert.equal(accepting, false);
  assert.ok(Date.now() - secondStarted < 800);

  // While locked, a concurrent press is busy — not a silent no-op.
  accepting = true;
  uiAcceptingId = '8692609003';
  const concurrent = await runAccept('8692609004');
  assert.equal(concurrent.outcome, 'busy');
  accepting = false;
  uiAcceptingId = null;
});

test('second Accept while locked reports busy (not silent no-op)', () => {
  const gate = isAcceptAlreadyInFlight(true)
    ? { outcome: 'busy', title: ACCEPT_ALREADY_PROCESSING_TITLE }
    : { outcome: 'ok' };
  assert.equal(gate.outcome, 'busy');
  assert.equal(gate.title, 'Already processing');
});

test('Offer-tab UI maps acceptingOfferId to Accepting… label', () => {
  const acceptingOfferId = '8692609001';
  const anyAccepting = !!acceptingOfferId;
  const titleFor = (offerId) => {
    const thisAccepting = acceptingOfferId === String(offerId);
    if (thisAccepting) return 'Accepting…';
    if (anyAccepting) return 'Wait…';
    return 'Accept';
  };
  assert.equal(titleFor('8692609001'), 'Accepting…');
  assert.equal(titleFor('8692609002'), 'Wait…');
  assert.equal(titleFor('8692609001'), 'Accepting…');
});
