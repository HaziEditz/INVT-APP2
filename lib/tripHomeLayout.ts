/**
 * Home trip column: map + work panel sizes that always leave room for the
 * End Trip / On Board action bar on short-wide screens (Galaxy Z Fold 8 inner
 * 4:3, Flex Mode, large insets).
 */

export const TRIP_TABS_MIN = 48;
export const TRIP_ACTION_BAR_MIN = 64;
export const TRIP_STATUS_ROW = 48;
export const TRIP_METER_MIN = 108;
export const TRIP_TARIFF_MIN = 44;
export const TRIP_MAP_FLOOR = 72;

export type TripHomeLayoutInput = {
  windowHeight: number;
  meterLive: boolean;
  /** Safe-area top inset from HomeStatusBar. */
  topInset?: number;
};

export type TripHomeLayout = {
  mapMax: number;
  mapMin: number;
  workMin: number;
};

function round(n: number): number {
  return Math.round(Math.max(0, n));
}

/**
 * Map is capped; work panel gets leftover height. On a Fold-8-class short
 * window the map shrinks first so tools + tabs + action bar always fit.
 */
export function computeTripHomeLayout(input: TripHomeLayoutInput): TripHomeLayout {
  const windowHeight = Number(input.windowHeight) || 0;
  const topChrome = (Number(input.topInset) || 0) + TRIP_STATUS_ROW;
  const toolsH = input.meterLive ? TRIP_METER_MIN : TRIP_TARIFF_MIN;
  const mustFitWithoutMap = topChrome + toolsH + TRIP_TABS_MIN + TRIP_ACTION_BAR_MIN;

  const wantedMap = input.meterLive
    ? Math.min(Math.max(windowHeight * 0.22, 140), 200)
    : Math.min(Math.max(windowHeight * 0.3, 180), 280);
  const mapBudget = windowHeight - mustFitWithoutMap;
  const mapMax = round(
    mapBudget >= TRIP_MAP_FLOOR
      ? Math.min(wantedMap, mapBudget)
      : Math.max(0, mapBudget),
  );

  const wantedMapMin = input.meterLive
    ? Math.min(Math.max(windowHeight * 0.16, 110), 160)
    : Math.min(Math.max(windowHeight * 0.2, 140), 200);
  const mapMin = round(Math.min(mapMax, wantedMapMin));

  const leftover = windowHeight - topChrome - mapMax;
  const workFloor = toolsH + TRIP_TABS_MIN + TRIP_ACTION_BAR_MIN;
  const workMin = round(Math.max(workFloor, leftover));

  return { mapMax, mapMin, workMin };
}
