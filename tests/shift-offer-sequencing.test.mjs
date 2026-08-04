import assert from 'node:assert/strict';
import test from 'node:test';
import { withTimeout } from '../lib/asyncTimeout.ts';
import {
  SHIFT_BOOTSTRAP_GPS_BUDGET_MS,
  isAutoDispatchEligibleStatus,
  pickBestDeferredOfferPopup,
  shiftBootstrapOfferReadySteps,
  shouldOpenPopupGateBeforeAvailableWrite,
  shouldShowOfferPopupNow,
} from '../lib/shiftOfferSequencing.ts';

function neverResolves() {
  return new Promise(() => {});
}

/**
 * Mirrors startShift ordering after Away bootstrap:
 * budgeted GPS → open popup gate → Available → sync flush deferred popup.
 */
async function simulateStartShiftOfferReady(deps) {
  const steps = [];
  steps.push('startShiftOnlineAway');

  const gpsStarted = Date.now();
  try {
    await withTimeout(deps.getCurrentCoords(), deps.gpsBudgetMs, 'startBackgroundTracking.initialGps');
  } catch {
    // last-known / skip — non-fatal
  }
  steps.push('startBackgroundTrackingBudgeted');
  assert.ok(Date.now() - gpsStarted < deps.gpsBudgetMs + 200);

  if (shouldOpenPopupGateBeforeAvailableWrite()) {
    deps.readyForJobs = true;
    steps.push('openPopupGate');
  }

  await deps.writeAvailable();
  steps.push('writeAvailable');

  // Sync flush (not useEffect) — badge→popup in the same turn as Available.
  if (deps.readyForJobs && !deps.jobOfferId) {
    const best = pickBestDeferredOfferPopup(deps.deferredOffers, Date.now());
    if (best) {
      deps.jobOfferId = best.id;
      deps.popupAt = Date.now();
    }
  }
  steps.push('flushDeferredOfferPopupSync');
  return steps;
}

test('offer popup waits for readyForJobs (post-login bootstrap)', () => {
  assert.equal(shouldShowOfferPopupNow(false), false);
  assert.equal(shouldShowOfferPopupNow(true), true);
});

test('only Available is auto-dispatch eligible (Away bootstrap is not)', () => {
  assert.equal(isAutoDispatchEligibleStatus('Available'), true);
  assert.equal(isAutoDispatchEligibleStatus('Away'), false);
  assert.equal(isAutoDispatchEligibleStatus('Offline'), false);
  assert.equal(isAutoDispatchEligibleStatus(''), false);
});

test('SHIFT_BOOTSTRAP_GPS_BUDGET_MS keeps badge→popup under 3s', () => {
  assert.ok(SHIFT_BOOTSTRAP_GPS_BUDGET_MS > 0);
  assert.ok(SHIFT_BOOTSTRAP_GPS_BUDGET_MS <= 3_000);
});

test('popup gate opens before Available write', () => {
  assert.equal(shouldOpenPopupGateBeforeAvailableWrite(), true);
  assert.deepEqual(shiftBootstrapOfferReadySteps(), [
    'startShiftOnlineAway',
    'startBackgroundTrackingBudgeted',
    'openPopupGate',
    'writeAvailable',
    'flushDeferredOfferPopupSync',
  ]);
});

test('pickBestDeferredOfferPopup skips expired and prefers newest', () => {
  const now = 1_700_000_000_000;
  const best = pickBestDeferredOfferPopup(
    [
      { id: 'old', postedAt: now - 10_000, expiresAt: now + 30_000 },
      { id: 'new', postedAt: now - 1_000, expiresAt: now + 30_000 },
      { id: 'expired', postedAt: now - 500, expiresAt: now - 1 },
    ],
    now,
  );
  assert.equal(best?.id, 'new');
});

test('hanging GPS during bootstrap still opens popup gate under budget', async () => {
  const started = Date.now();
  const deferredOffers = [{ id: '8692606166', postedAt: started, expiresAt: started + 60_000 }];
  const state = {
    readyForJobs: false,
    jobOfferId: null,
    popupAt: 0,
    deferredOffers,
    gpsBudgetMs: 80,
    getCurrentCoords: () => neverResolves(),
    writeAvailable: async () => {},
  };

  // Offer lands as list/badge during Away bootstrap (readyForJobs still false).
  assert.equal(shouldShowOfferPopupNow(state.readyForJobs), false);

  const steps = await simulateStartShiftOfferReady(state);
  assert.deepEqual(steps, [...shiftBootstrapOfferReadySteps()]);
  assert.equal(state.readyForJobs, true);
  assert.equal(state.jobOfferId, '8692606166');
  assert.ok(state.popupAt - started < 500, `popup too slow: ${state.popupAt - started}ms`);
  assert.ok(Date.now() - started < 500);
});
