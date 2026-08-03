import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSessionRoute } from '../lib/sessionRoutePolicy.ts';
import {
  CONNECTION_BANNER_ALERT_ROLE,
  CONNECTION_BANNER_SYNCING_ROLE,
} from '../lib/connectionBannerA11y.ts';

test('off-shift logged-in driver is forced to select-vehicle (no zombie tabs)', () => {
  assert.equal(
    resolveSessionRoute({
      hasFirebaseUser: true,
      shiftActive: false,
      endShiftInProgress: false,
      inAuth: false,
      onSelectVehicle: false,
      inTabs: true,
    }),
    '/select-vehicle',
  );
});

test('on-shift driver stays on tabs and is pulled off select-vehicle', () => {
  assert.equal(
    resolveSessionRoute({
      hasFirebaseUser: true,
      shiftActive: true,
      endShiftInProgress: false,
      inAuth: false,
      onSelectVehicle: true,
      inTabs: false,
    }),
    '/(tabs)',
  );
  assert.equal(
    resolveSessionRoute({
      hasFirebaseUser: true,
      shiftActive: true,
      endShiftInProgress: false,
      inAuth: false,
      onSelectVehicle: false,
      inTabs: true,
    }),
    null,
  );
});

test('signed-out driver goes to login', () => {
  assert.equal(
    resolveSessionRoute({
      hasFirebaseUser: false,
      shiftActive: false,
      endShiftInProgress: false,
      inAuth: false,
      onSelectVehicle: false,
      inTabs: true,
    }),
    '/(auth)/login',
  );
});

test('end-shift in progress does not redirect', () => {
  assert.equal(
    resolveSessionRoute({
      hasFirebaseUser: true,
      shiftActive: false,
      endShiftInProgress: true,
      inAuth: false,
      onSelectVehicle: false,
      inTabs: true,
    }),
    null,
  );
});

test('connection banner roles are Android-safe (no "status")', () => {
  const androidSafe = new Set([
    'none',
    'button',
    'link',
    'search',
    'image',
    'keyboardkey',
    'text',
    'adjustable',
    'imagebutton',
    'header',
    'summary',
    'alert',
  ]);
  assert.equal(CONNECTION_BANNER_ALERT_ROLE, 'alert');
  assert.equal(CONNECTION_BANNER_SYNCING_ROLE, 'summary');
  assert.ok(androidSafe.has(CONNECTION_BANNER_ALERT_ROLE));
  assert.ok(androidSafe.has(CONNECTION_BANNER_SYNCING_ROLE));
  assert.equal(androidSafe.has('status'), false);
});
