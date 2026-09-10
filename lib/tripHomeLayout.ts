/**
 * Home trip column: map vs work panel from the *measured* column height.
 * Short-wide fold inners, Flex Mode, and tall phones share the same rules —
 * never a device-model check that just moves the clip to another control.
 */

export const TRIP_TABS_MIN = 48;
export const TRIP_ACTION_BAR_MIN = 64;
/** "Trip details" + Expand — must stay on-screen with End Trip. */
export const TRIP_PINNED_HEADER_MIN = 44;
export const TRIP_STATUS_ROW = 48;
export const TRIP_METER_MIN = 108;
export const TRIP_TARIFF_MIN = 44;
export const TRIP_MAP_FLOOR = 56;
/** Expo-router tab bar (height 56 + bottom inset padding). */
export const TRIP_APP_TAB_BAR_MIN = 56;

export type TripHomeLayoutInput = {
  /** Map + work column only (body onLayout). Not the full window. */
  availableHeight: number;
  windowWidth: number;
  meterLive: boolean;
};

export type TripHomeLayout = {
  mapMax: number;
  mapMin: number;
  workMin: number;
};

function round(n: number): number {
  return Math.round(Math.max(0, n));
}

/** Inner fold / Flex Mode: height is not much larger than width. */
export function isShortWideAspect(height: number, width: number): boolean {
  if (!(width > 0) || !(height > 0)) return false;
  return height / width < 1.28;
}

export function tripWorkChrome(meterLive: boolean): number {
  const toolsH = meterLive ? TRIP_METER_MIN : TRIP_TARIFF_MIN;
  return toolsH + TRIP_TABS_MIN + TRIP_PINNED_HEADER_MIN + TRIP_ACTION_BAR_MIN;
}

/**
 * Map shrinks first on short-wide windows so Expand + End Trip always fit.
 * Work min is never less than tools + tabs + Expand header + action bar.
 */
export function computeTripHomeLayout(input: TripHomeLayoutInput): TripHomeLayout {
  const availableHeight = Number(input.availableHeight) || 0;
  const windowWidth = Number(input.windowWidth) || 0;
  const chrome = tripWorkChrome(input.meterLive);
  const shortWide = isShortWideAspect(availableHeight, windowWidth);

  const mapRatio = shortWide
    ? input.meterLive
      ? 0.12
      : 0.16
    : input.meterLive
      ? 0.22
      : 0.3;
  const mapCap = shortWide
    ? input.meterLive
      ? 132
      : 168
    : input.meterLive
      ? 200
      : 280;
  const mapWantMin = shortWide
    ? input.meterLive
      ? 80
      : 110
    : input.meterLive
      ? 140
      : 180;

  const wantedMap = Math.min(Math.max(availableHeight * mapRatio, mapWantMin), mapCap);
  const mapBudget = availableHeight - chrome;
  const mapMax = round(
    mapBudget >= TRIP_MAP_FLOOR
      ? Math.min(wantedMap, mapBudget)
      : Math.max(0, mapBudget),
  );
  const mapMin = round(Math.min(mapMax, Math.max(TRIP_MAP_FLOOR, Math.round(mapMax * 0.7))));
  const leftover = availableHeight - mapMax;
  const workMin = round(Math.max(chrome, leftover));

  return { mapMax, mapMin, workMin };
}

/** Fallback column height before body onLayout (tab bar + status row). */
export function estimateTripColumnHeight(windowHeight: number, topInset: number, bottomInset: number): number {
  const tabBar = TRIP_APP_TAB_BAR_MIN + Math.max(Number(bottomInset) || 0, 8);
  return Math.max(
    0,
    (Number(windowHeight) || 0) - (Number(topInset) || 0) - TRIP_STATUS_ROW - tabBar,
  );
}
