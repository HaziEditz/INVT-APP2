/**
 * bookingEvents/{companyId}/{bookingId} — granular per-booking update stream
 * written by the dispatch server. Driver app subscribes while a job is active.
 */

export type BookingEventType = 'PickupChanged' | 'FareChanged' | 'StopAdded' | 'StatusChanged';

export interface BookingEventRecord {
  type: BookingEventType;
  seq: number;
  timestamp: number;
  data: Record<string, unknown>;
}

export interface FieldChange {
  from: unknown;
  to: unknown;
}

export type ChangesMap = Record<string, FieldChange>;

export interface JobFieldPatch {
  pickupAddress?: string;
  dropAddress?: string;
  fare?: number;
  rideCost?: number;
  distance?: string;
  duration?: string;
  notes?: string;
  passengerName?: string;
  passengerPhone?: string;
  stops?: string;
}

const EVENT_TYPES = new Set<BookingEventType>([
  'PickupChanged', 'FareChanged', 'StopAdded', 'StatusChanged',
]);

export function parseBookingEvent(raw: unknown): BookingEventRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const type = String(o.type ?? '').trim() as BookingEventType;
  if (!EVENT_TYPES.has(type)) return null;
  const seq = Number(o.seq);
  if (!Number.isFinite(seq) || seq <= 0) return null;
  const timestamp = Number(o.timestamp);
  return {
    type,
    seq,
    timestamp: Number.isFinite(timestamp) ? timestamp : 0,
    data: (o.data && typeof o.data === 'object')
      ? o.data as Record<string, unknown>
      : {},
  };
}

/** Sort event records by seq ascending (stable tie-break on timestamp). */
export function sortBookingEventsBySeq(events: BookingEventRecord[]): BookingEventRecord[] {
  return [...events].sort((a, b) => {
    if (a.seq !== b.seq) return a.seq - b.seq;
    return a.timestamp - b.timestamp;
  });
}

function changeTo(changes: ChangesMap | undefined, ...keys: string[]): unknown {
  if (!changes) return undefined;
  for (const k of keys) {
    const entry = changes[k];
    if (entry && Object.prototype.hasOwnProperty.call(entry, 'to')) {
      return entry.to;
    }
  }
  return undefined;
}

/** Build a human-readable stops list from dispatcher stop fields. */
export function formatStopsList(
  nextstop: unknown,
  nextstopdata: unknown,
  stops: unknown,
  existing?: string,
): string {
  if (stops !== undefined && stops !== null && stops !== '') {
    if (Array.isArray(stops)) {
      return stops
        .map(s => (typeof s === 'string' ? s : (s as { address?: string; Address?: string })?.address
          ?? (s as { address?: string; Address?: string })?.Address
          ?? String(s)))
        .filter(Boolean)
        .join('\n');
    }
    if (typeof stops === 'object') {
      try { return JSON.stringify(stops); } catch { return existing ?? ''; }
    }
    const s = String(stops).trim();
    if (s) return s;
  }
  if (nextstopdata !== undefined && nextstopdata !== null) {
    const raw = String(nextstopdata).trim();
    if (!raw) return existing ?? '';
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .map((item: unknown) => {
            if (typeof item === 'string') return item;
            if (item && typeof item === 'object') {
              const o = item as { address?: string; Address?: string; name?: string };
              return o.address ?? o.Address ?? o.name ?? '';
            }
            return String(item ?? '');
          })
          .filter(Boolean)
          .join('\n');
      }
    } catch { /* plain-text fallback below */ }
    return raw;
  }
  const count = parseInt(String(nextstop ?? '0'), 10) || 0;
  if (count > 0 && existing) return existing;
  return existing ?? '';
}

/** Map a dispatch diff ({ field: { from, to } }) onto driver-app job fields. */
export function patchFromChanges(changes: ChangesMap | undefined, current: {
  pickupAddress?: string;
  dropAddress?: string;
  fare?: number;
  rideCost?: number;
  distance?: string;
  duration?: string;
  notes?: string;
  passengerName?: string;
  passengerPhone?: string;
  stops?: string;
}): JobFieldPatch {
  if (!changes || typeof changes !== 'object') return {};
  const patch: JobFieldPatch = {};

  const pickTo = changeTo(changes, 'PickAddress', 'pickupAddress', 'pickup');
  const dropTo = changeTo(changes, 'DropAddress', 'dropAddress', 'dropoff');
  if (pickTo !== undefined) patch.pickupAddress = String(pickTo ?? '').trim();
  if (dropTo !== undefined) patch.dropAddress = String(dropTo ?? '').trim();

  const fareTo = changeTo(
    changes,
    'EstimatedFare', 'RideCost', 'CustomeRate', 'FixedPrice', 'Fare', 'fare', 'EstimatedCost',
  );
  if (fareTo !== undefined && fareTo !== null && fareTo !== '') {
    const n = parseFloat(String(fareTo));
    if (Number.isFinite(n)) {
      patch.fare = n;
      if (changes.RideCost || changes.CustomeRate || changes.EstimatedFare) {
        patch.rideCost = n;
      }
    }
  }

  const notesTo = changeTo(changes, 'Notes', 'notes', 'comment', 'Comment', 'DriverNote', 'DispatchNotes');
  if (notesTo !== undefined) patch.notes = String(notesTo ?? '');

  const nameTo = changeTo(changes, 'Name', 'PassengerName', 'passengername');
  if (nameTo !== undefined) patch.passengerName = String(nameTo ?? '');

  const phoneTo = changeTo(changes, 'PhoneNo', 'PassengerPhone', 'passengerPhone');
  if (phoneTo !== undefined) patch.passengerPhone = String(phoneTo ?? '');

  const distTo = changeTo(changes, 'EstimatedDistance', 'Distance', 'distance');
  if (distTo !== undefined) patch.distance = String(distTo ?? '');

  const durTo = changeTo(changes, 'EstimatedTime', 'Duration', 'duration');
  if (durTo !== undefined) patch.duration = String(durTo ?? '');

  const nextstop = changeTo(changes, 'Nextstop', 'nextstop');
  const nextstopdata = changeTo(changes, 'nextstopdata');
  const stopsVal = changeTo(changes, 'stops', 'Stops', 'extraStops');
  if (nextstop !== undefined || nextstopdata !== undefined || stopsVal !== undefined) {
    patch.stops = formatStopsList(nextstop, nextstopdata, stopsVal, current.stops);
  }

  return patch;
}

export function extractChanges(data: Record<string, unknown>): ChangesMap | undefined {
  const raw = data.changes;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as ChangesMap;
  }
  return undefined;
}
