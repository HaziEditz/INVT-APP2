# Dispatch HQ — Changes to Read (OTAs 22bl → 22bo)

Driver app is now writing new fields on every trip + a new contact-log node.
HQ side needs to render these to fully use the work that has shipped.

## 1. New top-level Firebase node

### `driverContactLog/{companyId}/{bookingId}/{timestampMs}`
Written every time the driver taps Call or Text on the passenger contact bar
(any booking source). Use for no-show dispute resolution.

```jsonc
{
  "at":         "2026-05-17T18:42:11.123Z",
  "kind":       "call" | "sms",
  "template":   "arrived" | "onway" | "late5" | "outside" | "call" | "blank" | null,
  "phone":      "+64 21 555 1234",
  "source":     "dispatch" | "hail" | "website" | "passenger" | "account" | null,
  "driverId":   "Firebase-auth-uid",
  "driverName": "John Smith"
}
```

Suggested HQ panel: in the booking detail timeline, render an icon row showing
each call / text attempt with timestamp + template label.

---

## 2. New fields on `online/{cid}/{vid}/current` and top-level `vehiclestatus`

The driver now writes a lifecycle field alongside the existing
`Available / Assigned / Busy / Offline` status:

| Field           | Values                                   | Set at                            |
|-----------------|------------------------------------------|-----------------------------------|
| `tripStage`     | `OnTheWay` / `Arrived` / `OnBoard` / `null` | acceptJob, Arrived tap, startMeter, completeJob, _freeDriver |
| `vehiclestatus` | `OnTheWay` / `Arrived` / `OnBoard` (also still writes Assigned/Available) | Same transitions |

HQ board should read `tripStage` (or `vehiclestatus` if `tripStage` missing)
and colour the driver pin / status row accordingly. The existing
Assigned/Busy/Available signal is unchanged.

---

## 3. New fields on every closed trip (`completedJobs/{cid}/{id}`, `allbookings/{cid}/{id}`, sync POST body)

### 3a. v22bm — Per-trip extras (Airport / Bike / Bag / EFTPOS / Cleaning / Other)

```jsonc
{
  "ExtrasItems": [
    { "id": "airport", "name": "Airport pickup",    "amount": 5 },
    { "id": "bag",     "name": "Extra bag",         "amount": 2 }
  ],
  "ExtrasTotal": 7,
  "FareExtras":  7   // also populated on completedJobs + allbookings + sync POST
}
```

`TotalFare` already includes `FareExtras`. If a card payment is taken, Stripe
charges the new combined total. HQ trip-detail view should list ExtrasItems in
the fare breakdown.

### 3b. v22bo — Split payment

```jsonc
{
  "PaymentType":   "split",
  "PaymentSplits": [
    { "method": "account", "amount": 21.00 },
    { "method": "cash",    "amount":  9.00 }
  ],
  "TotalFare": 30.00
}
```

`PaymentSplits` was previously always `null`. Now populated when the driver
uses the Split tab on the completion screen. Amounts always sum to `TotalFare`.
Methods are: `cash` | `eftpos` | `card` | `account` | `total_mobility` |
`acc` | `gift_card` (any combination).

### 3c. v22bl — Lifecycle timestamps

In addition to existing `MeterOn` / `MeterOff`, every closed trip now contains:
- `OnTheWayAt` — ISO time when driver tapped Accept
- `ArrivedAt`  — ISO time when driver tapped I've Arrived
- `OnBoardAt`  — ISO time when meter started (passenger picked up)

Use these to compute pickup-wait, response-to-arrived, and arrived-to-onboard
KPIs without log scraping.

---

## 4. Read this from `accClients/{cid}/{key}` (HQ already owns this node)

Driver now reads `percentPaid` (0–100) on account clients to auto-split the
fare. If your owner panel doesn't have a UI for it yet, add a single number
field per client called "Percent paid by account" (0–100, default 100).

Example shape:
```jsonc
{
  "clientRef":   "ACC-00142",
  "name":        "Lyttelton Aged Care",
  "percentPaid": 70   // ← new field driver reads
}
```

When set < 100, the driver app prompts the driver with a one-tap
"Auto-split: 70 % account, 30 % remainder" button.

---

## 5. No HQ change needed for these (driver-side only)

- Passenger contact buttons UI (Call / Text)
- Source + Job Type chips on the offer modal
- Hail silent-mode for incoming dispatch offers
- Extras picker UI

---

## Versioning

The trip records all carry `RuntimeVersion: "1.5.0"` and `BuildId: "ota22bo"`
(or whatever the active OTA is) so HQ can filter trips by build for any
incident triage.
