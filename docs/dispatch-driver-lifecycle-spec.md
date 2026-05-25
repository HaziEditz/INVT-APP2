# Driver App ↔ Dispatch — Unified Booking Lifecycle Spec

**Document owner:** Taxi360 / Bookawaka driver-app team
**Target reader:** Dispatch backend / console developer
**Status:** ✅ Agreed by dispatch dev — implementation in progress (order: G5 → G4 → G6 → G2)
**Driver app baseline:** OTA `22bo-fix9`, runtime `1.5.0`, production channel

---

## 1. Background

Driver app has been refactored to handle bookings **per-bookingId** rather than as a single global "current job" slot. The remaining gaps require **server-side cooperation** from dispatch. This document specifies the exact Firebase paths, field names, and HTTP endpoints needed.

Once dispatch implements the four items below, the driver app team will ship matching OTAs against runtime 1.5.0 (no native rebuild required).

---

## 2. Items already covered (no dispatch change needed)

| # | Item | Status |
|---|---|---|
| Multiple offers + 1 queued simultaneously | Driver `jobs[]` array supports `offered`/`current`/`queued`/`completed` rows in parallel. | ✅ Live |
| Targeted cancellation | Cancel filters by `bookingId`, leaves other rows untouched. | ✅ Live |
| Meter preservation on offer cancel | `stopMeter()` only fires when the **active** trip is cancelled. | ✅ Live |
| Session-end resets (sign-out / suspend / kick) | Five `setJobs([])` sites audited — all genuine session-end events. | ✅ Live |
| Booking-source badge on offer popup | Reads `jobBookingSrc` / `BookingSource` / `bookingSource` / `source`. Renders DISPATCH / WEBSITE / PASSENGER APP / RE-OFFER / HAIL / ACCOUNT / PREBOOK. | ✅ Live (fix8) |
| Conditional availability after cancel | If a queued booking remains, stays `Assigned`; only goes `Available` when slate is empty. | ✅ Live (fix9) |
| Full presence re-assert on "Available" tap | `vehicletype + PlayerId + lat/lng + lastSeen` re-written on every status change. | ✅ Live (fix8) |
| Prebook visibility | Driver only sees a prebook when dispatcher releases it. Release time stays on dispatch side. Driver receives it as a normal offer. | ✅ No change needed — set `jobBookingSrc: "prebook"` so the badge renders. |

---

## 3. Items needing dispatch-side work

### G2 — Per-booking jobs slot (multi-slot)

**Today:** `jobs/{companyId}/{vehicleId}/{driverId}` is a **single slot** — one booking lives there at a time. Deleting it loses the bookingId context.

**Proposed:**
```
jobs/{companyId}/{vehicleId}/{driverId}/{bookingId}
```

Each active booking gets its own child node under the driver. Dispatch writes/deletes per booking. Driver app listens to the parent path and reacts to per-child add/remove/change events.

**Why we need it:** when dispatch retracts a queued booking, driver app currently can't tell which booking was retracted (because the single slot only holds one). Multi-slot makes retractions unambiguous.

**Migration:** can run dual-write (old single slot + new multi-slot) for one release cycle. Driver app will read the multi-slot first and fall back to single slot if multi-slot is empty.

---

### G4 — Structured event types on every booking write

**Today:** Driver app guesses event type from message keywords in `notification/{driverId}`.

**Proposed:** Every booking-related write (notification AND `allbookings/{cid}/{bookingId}`) must include a top-level field:

```json
{
  "eventType": "new_offer" | "updated" | "cancelled" | "reassigned" | "completed" | "recalled",
  "bookingId": "20042026155",
  "updatedAt": 1716033845123,
  "version": 7,
  ...rest of booking fields
}
```

| `eventType` | Meaning | Driver-app UI behaviour |
|---|---|---|
| `new_offer` | First time this booking is offered to this driver | Pops offer modal with countdown |
| `updated` | Any field on the booking changed (pickup/drop/notes/fare/stops/etc) | Toast: "Trip details updated" — patches in place, never re-pops modal |
| `cancelled` | Booking is terminated | Removes row + shows "Job Cancelled" alert. If active, stops meter. |
| `reassigned` | Booking handed to a different driver | Removes row silently — no alert |
| `completed` | Booking marked done elsewhere (rare — driver-app drives this) | Removes row silently |
| `recalled` | Dispatcher pulled the offer back before driver responded | Closes offer modal + clears dedup so a re-offer of the same bookingId pops the modal again |

---

### G5 — `updatedAt` + `version` on every booking write (stale-write protection)

**Why:** mobile networks blip. A delayed Firebase write can arrive AFTER a more recent state and resurrect a cancelled or stale booking. Without versioning, driver app has to last-write-wins and gets weird ghost rows.

**Proposed contract:** every write to `allbookings/{cid}/{bookingId}` AND every notification payload includes both:

| Field | Type | Notes |
|---|---|---|
| `updatedAt` | int64 ms epoch | Firebase `serverTimestamp()` preferred over client clock |
| `version` | int monotonic | Increment by 1 on every mutation, never reset |

**Driver-app behaviour:** keeps a `Map<bookingId, {lastVersion, lastUpdatedAt}>` in memory. Drops any incoming snapshot where `version <= lastVersion` (or `updatedAt < lastUpdatedAt` if `version` is missing).

This is **cheap** to implement on dispatch side — single counter increment per booking — and eliminates a whole class of resurrection bugs.

---

### G6 — Reconnect rebuild endpoint

**Why:** when a driver's phone reconnects after a network drop, the driver app needs the authoritative list of bookings currently assigned/queued to them — not whatever happens to still be in Firebase listeners' state.

**Proposed endpoint:**

```
GET /api/driver/active-bookings?driverId={id}&companyId={cid}&vehicleId={vid}
```

**Response:**
```json
{
  "bookings": [
    {
      "bookingId": "20042026155",
      "status": "current" | "queued" | "offered",
      "version": 7,
      "updatedAt": 1716033845123,
      "jobBookingSrc": "dispatch" | "website" | "app" | "prebook" | "re-offer",
      "passengerName": "...",
      "passengerPhone": "...",
      "pickupAddress": "...",
      "dropAddress": "...",
      "fare": 24.50,
      "paymentType": "cash" | "eftpos" | "card" | "account" | "acc" | "total_mobility" | "gift_card",
      "wheelchair": false,
      "passengers": 1,
      "notes": "..."
    }
  ],
  "fetchedAt": 1716033845999
}
```

**Driver-app behaviour:** on every Firebase `.info/connected` transition to `true`, driver app calls this endpoint and reconciles its `jobs[]` array:
- Add missing bookings the driver doesn't have yet
- Remove orphan rows the server no longer claims
- Patch field changes where versions differ

**This single endpoint fixes:** offers lost during reconnect, cancelled jobs resurrected by stale Firebase writes, queued jobs that should have promoted but didn't.

---

## 4. Future-only (do **not** build yet)

These are tracked but out of scope until you're ready to actually dispatch concurrent food/freight jobs.

| # | Item | Note |
|---|---|---|
| G10b | Driver handles **multiple simultaneous active trips** (e.g. courier with 3 deliveries in progress) | Driver-app meter / Dashboard / presence model assumes 1 active trip. Significant refactor — runtime bump (1.6.0). For now, taxi case (1 current + 1 queued) is fully supported. |

---

## 5. Agreed implementation order

1. **G5** — `updatedAt` (serverTimestamp) + `version` (start at 1) on every booking write. ← dispatch building first
2. **G4** — `eventType` top-level field on `notification/{driverId}` + `allbookings/{cid}/{bookingId}`.
3. **G6** — `GET /api/driver/active-bookings` endpoint (`UserKey` header auth).
4. **G2** — per-booking `jobs/{cid}/{vid}/{drvId}/{bookingId}` slot under 6-week dual-write flag.

Driver-app team ships one OTA per item as it lands on dispatch side. No native rebuild needed for any of these — all changes ride on runtime `1.5.0`.

### Driver-side OTA plan (for tracking)

| Dispatch ships | Driver-app OTA | Changes |
|---|---|---|
| G5 lands | `22bp` | Add `lastSeenVersionMap` ref keyed by bookingId; drop incoming snapshots where `version <= lastVersion` (or `updatedAt < lastUpdatedAt` if version missing). Both jobs-path listener and allbookings listener. |
| G4 lands | `22bq` | New `routeBookingEvent(eventType, bookingId, data)` function; replace keyword guessing in notification listener with a switch on `eventType`. `reassigned` → silent cancelled. |
| G6 lands | `22br` | On `.info/connected` → `true`, call `/api/driver/active-bookings`, reconcile `jobs[]` (add/remove/patch). |
| G2 lands | `22bs` | Listen on `jobs/{cid}/{vid}/{drvId}` parent path with `onChildAdded`/`onChildChanged`/`onChildRemoved`. Read multi-slot first, fall back to single-slot until the 6-week flag flips. |

---

## 6. Agreed answers (locked)

Dispatch dev confirmed all five answers — drives the contract for the driver-side OTAs.

1. **Server clock for `updatedAt`** — Firebase `serverTimestamp()` sentinel. Authoritative. ✅
2. **`version` initial value** — starts at `1` on first write. Driver app treats `undefined` as `0`. ✅
3. **`eventType` placement** — top-level field on both `notification/{driverId}` and `allbookings/{companyId}/{bookingId}`. ✅
4. **Dual-write window for G2** — **6 weeks** behind a feature flag. Dispatch writes old single-slot AND new multi-slot in parallel; driver app reads multi-slot first, falls back to single. After 6 weeks dispatch drops the single-slot write. ✅
5. **Auth on `/api/driver/active-bookings`** — `UserKey` (driver's `passforlink`) in header. Server derives `companyId` + `vehicleId` from the driver record server-side, **not** from query params. Driver app does **not** need to send those as query params (server ignores them if sent). ✅

### 6a. Bonus: granular field-diff event stream (optional consumer)

Dispatch already writes a richer event stream at:

```
bookingEvents/{companyId}/{bookingId}/{push-id}
```

Each push-id is a per-field diff event (e.g. `PickupChanged`, `DropoffChanged`, `FareChanged`, `StopAdded`, `PassengerNoteChanged`).

**Driver-app default:** ignore this node entirely and rely on the simplified top-level `eventType` from §3 G4. Generic "Trip details updated" toast is the recommended UX.

**Optional upgrade:** if granular toasts ("Pickup changed to 12 Smith St", "Fare updated to $24.50") become useful, driver app can subscribe to this node too. Out of scope for the initial four-OTA rollout — deferred to a future polish OTA.

### 6b. Agreed `eventType` semantics

Dispatch confirmed exactly when each event fires:

| `eventType` | Dispatch emits when |
|---|---|
| `new_offer` | First write of a bookingId to a driver's `jobs/` node |
| `updated`   | Any field-level edit (pickup, drop, fare, notes, schedule, passenger info) |
| `cancelled` | Booking terminated by passenger / dispatcher / website |
| `reassigned`| Booking moved to a different driver — *original* driver receives `cancelled`, *new* driver receives `new_offer` |
| `completed` | Trip marked done |
| `recalled`  | Dispatcher pulled offer back before driver responded, OR a driver-post-Assigned recall |

Driver app implementation note: `reassigned` does **not** need a distinct UI handler. From the original driver's perspective it lands as `cancelled` (silent removal — no "Job Cancelled" alert because nothing was wrong). Driver-app `eventType` router can collapse `reassigned` → same code path as `cancelled` but suppress the alert.

---

## 7. Contact

Driver-app changes land on EAS production channel `lovesaf/taxi360-driver`, runtime `1.5.0`. Each OTA pushes in 2-3 minutes from sign-off. Test device: Samsung Galaxy A04.

Driver app's current presence + lifecycle invariants are documented in `replit.md` (driver-app repo root) — relevant sections: "Behaviour Notes (Active Invariants)" and "Firebase Paths".
