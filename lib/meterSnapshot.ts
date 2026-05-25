/**
 * meterSnapshot.ts — Durable persistence of the live meter state.
 *
 * v12-ota22c4: Item #2 + #3 of the offline-first hardening series.
 *
 * Goal
 * ----
 * If the driver app force-closes, the phone reboots, the JS engine OOM-kills
 * the bridge, or Android reclaims background memory, the in-memory meter
 * state (seconds / distance / waiting cost / tariff / hail meta) would be
 * lost. The trip would never complete on the dispatch board, and the driver
 * would lose the fare.
 *
 * This module snapshots a strict subset of meter state to AsyncStorage every
 * 5 seconds while the meter is running, and clears it the moment a trip
 * completes (or shift ends, or driver signs out cleanly). On cold-start,
 * DriverContext reads it and resumes the meter automatically — driver does
 * NOT need to tap anything to recover.
 *
 * Single-key design — only ONE active meter snapshot can exist at a time
 * (a driver can never be on two trips). We don't shard per-jobId because the
 * snapshot is meant to be ephemeral live state. Long-term records live in
 * tripJournal (per-jobId journal entries + completion summary).
 *
 * Schema is versioned (`schemaV`) — bump on any breaking change so old
 * snapshots from a previous build are ignored rather than mis-read.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'taxi360.activeMeterSnapshot.v1';
const SCHEMA_V = 1;

export type MeterTripSource =
  | 'hail'
  | 'dispatch'
  | 'website'
  | 'passenger'
  | 'account'
  | 'other';

export interface MeterSnapshot {
  schemaV:        number;
  // Identity
  companyId:      string;
  driverId:       string;
  vehicleId:      string;
  // Trip identity
  bookingId:      string | null;   // null for hail trips that haven't got a central job id yet
  isHail:         boolean;
  source:         MeterTripSource;
  jobType:        string;          // taxi | TM | ACC | food | freight
  // Meter values (the things we MUST preserve to recover the fare)
  meterRunning:   boolean;
  meterPaused:    boolean;
  meterSeconds:   number;
  meterDistance:  number;          // km
  meterIsWaiting: boolean;
  meterWaitingSecs:      number;
  meterWaitingIntervals: number;
  meterWaitingCost:      number;
  // Timestamps
  meterOnAt:      string | null;   // ISO when meter first started
  // Tariff
  tariffId:       string;
  tariffName:     string;
  flagFall:       number;
  ratePerMile:    number;
  waitingPerMin:  number;
  waitingInterval: number;
  speedThreshold: number;
  /** Full original Tariff object (defensive — used if availableTariffs[] can't
   *  resolve the id on resume). Stored as `any` to avoid importing the Tariff
   *  type and creating a coupling cycle with DriverContext. */
  tariffFull:     any;
  // Pickup
  pickupAddress:  string | null;
  pickupLat:      number | null;
  pickupLng:      number | null;
  // Hail-specific meta (passenger name, payment data prepared at start, etc.)
  hailMeta:       any | null;
  // House-keeping
  savedAt:        number;          // epoch ms — used to detect very stale snapshots
}

/**
 * Save the current meter snapshot. Best-effort — never throws.
 * Errors are silently swallowed so a transient AsyncStorage failure cannot
 * crash the meter tick or starve the 5s persistence interval.
 */
export async function saveMeterSnapshot(s: Omit<MeterSnapshot, 'schemaV' | 'savedAt'>): Promise<void> {
  try {
    const full: MeterSnapshot = { ...s, schemaV: SCHEMA_V, savedAt: Date.now() };
    await AsyncStorage.setItem(KEY, JSON.stringify(full));
  } catch {
    // intentionally ignored
  }
}

/**
 * Load the snapshot if one exists. Returns null when:
 *   • no snapshot is stored,
 *   • the stored payload is malformed,
 *   • the schema version doesn't match,
 *   • the snapshot is older than 24h (auto-expired as a safety net).
 *
 * 24h expiry guard: if an app gets stuck with an orphan snapshot somehow,
 * we don't want it to "resume" a trip from 3 days ago. Real trips never
 * exceed a single shift (max 14h NZ compliance) so 24h is generous.
 */
export async function loadMeterSnapshot(): Promise<MeterSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MeterSnapshot;
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.schemaV !== SCHEMA_V) return null;
    if (typeof parsed.savedAt !== 'number') return null;
    const ageMs = Date.now() - parsed.savedAt;
    if (ageMs > 24 * 60 * 60 * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Wipe the active snapshot. Called on trip completion / shift end / sign-out. */
export async function clearMeterSnapshot(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // intentionally ignored
  }
}
