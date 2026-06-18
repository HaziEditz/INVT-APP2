# Tariff record parser contract

Owner Panel publishes tariff rates to Firebase Realtime Database. Dispatch and the driver app must parse the same nodes from the same paths so both show identical live tariffs.

## Firebase paths (read both, merge by id)

| Path | Role |
|------|------|
| `tariffs/{companyId}` | Legacy / secondary tariff list |
| `tariffZones/{companyId}` | **Primary** Owner Panel path (see `INVT/MULTITENANCY_SPEC.md`) |

**Merge rule:** Build a map keyed by tariff `id`. Ingest `tariffs/` first, then `tariffZones/` — **tariffZones overrides** on duplicate ids.

**Skip:** Child keys starting with `zone_grid_` (polygon-only, no pricing).

**Snapshot shape:** Array of records or object map of child key → record.

## Canonical field aliases

Each record may use PascalCase (Owner Panel / legacy) or camelCase (newer writes). Parsers in both repos must accept all aliases below.

| Concept | Aliases (first match wins) |
|---------|----------------------------|
| **id** | `Id`, `id`, Firebase child key |
| **name** | `TariffName`, `tariffName`, `name`, `zoneName`, `label` — must be non-empty |
| **flag fall / start price** | `StartPrice`, `baseFare`, `startPrice`, `flagFall`, `flagfall`, `base` |
| **distance rate** | `DistanceRate`, `pricePerKm`, `perKm`, `ratePerKm`, `kmRate` |
| **waiting rate** | `WaitingRate`, `waitingRate`, `waitRate`, `waitingRatePerMinute`, `waitingPerMin`, `waitPerMin`, `waiting`, `waitingCostPerMin`, `waitingPerMinute` |
| **minimum fare** | `MinimumFare`, `minimumFare` (dispatch estimates only; driver meter ignores today) |

Optional driver-only extensions (night / weekend / holiday) are parsed in the driver app but not applied in meter math yet.

## Implementations (keep in sync)

| Repo | File |
|------|------|
| **INVT** (dispatch) | `src/lib/fareEstimate.ts` → `parseTariffRecord` |
| **INVT-APP2** (driver) | `lib/parseTariffRecord.ts` → `parseTariffRecord` |

When adding a new alias or changing merge rules, update **both** files and this document.

## Driver app subscription

`lib/companyTariffs.ts` → `subscribeCompanyTariffs()` — real-time `onValue` on both paths, merged via `ingestTariffSnapshot` + `mergeTariffMaps`.

## Dispatch subscription

`src/hooks/useTariffs.ts` — same merge logic for fare estimates and job-card rates.

## Not covered here

- Create Job **dropdown** names in dispatch still come from server `TARIFF_STORE` (`[DispatcherSettings]` dt4), not this Firebase merge.
- `[TariffSync]` pushes Firebase → server store; only legacy Angular dispatch calls it today.

## Manual drift check

After Owner Panel edits a tariff:

1. Open dispatch Create Job — confirm fare estimate line uses new rates.
2. Open driver app Tariff picker — same names and `$flag + $/km` without restarting the app.
