/**
 * Auth / shift routing policy.
 * Keeps cold-start and off-shift navigation free of the
 * "logged-in Profile + Off main" zombie session.
 */

export type SessionRouteTarget = '/(auth)/login' | '/select-vehicle' | '/(tabs)';

export type SessionRouteInput = {
  hasFirebaseUser: boolean;
  shiftActive: boolean;
  /** True while End Shift overlay / sign-out flow is running. */
  endShiftInProgress: boolean;
  inAuth: boolean;
  onSelectVehicle: boolean;
  inTabs: boolean;
};

/**
 * Resolve where AuthNavigator should send the driver.
 * Returns null when the current route is already correct.
 *
 * Off-shift logged-in drivers always go to vehicle selection — never tabs.
 * Staying on tabs with vehicleSessionReady && !shiftActive left drivers in a
 * silent dead state (no SOS, no offers, generic map) after crash/reopen.
 */
export function resolveSessionRoute(input: SessionRouteInput): SessionRouteTarget | null {
  if (input.endShiftInProgress) return null;

  if (!input.hasFirebaseUser) {
    return input.inAuth ? null : '/(auth)/login';
  }

  if (input.shiftActive) {
    if (!input.inTabs && (input.onSelectVehicle || input.inAuth)) {
      return '/(tabs)';
    }
    return null;
  }

  // Logged in, off shift → vehicle confirm / start shift.
  if (!input.onSelectVehicle && !input.inAuth) {
    return '/select-vehicle';
  }
  return null;
}
