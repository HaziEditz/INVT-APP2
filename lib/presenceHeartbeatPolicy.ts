/** Normal on-shift presence repair cadence (idle Available). */
export const PRESENCE_HEARTBEAT_MS = 20_000;
/** Rewrite lastSeen when server age exceeds this (idle path). */
export const PRESENCE_LASTSEEN_REPAIR_MS = 15_000;
/**
 * While a dispatch offer is pending, stamp lastSeen this often so mid-offer
 * heal (10s) cannot false-positive on a healthy idle Available driver.
 */
export const PRESENCE_OFFER_HEARTBEAT_MS = 5_000;
