# RTDB Phase 0 — Option B membership + emulator harness

**Status:** Planning/implementation harness only. **Production rules are NOT deployed from this folder.**

## Decision: Option B

Membership for company-scoped paths:

```
auth != null && (
  root.child('drivers').child($companyId).child(auth.uid).exists()
  || root.child('adminAccess').child($companyId).child(auth.uid).exists()
)
```

Matches the nested shape the driver app already uses (`drivers/{cid}/{uid}`).

## Q&A (confirmed before Phase 0)

### 1. Driver moves company — stale access?

- **Correct transfer (nested move):** access flips **immediately** on the next rule evaluation. No token refresh delay (unlike custom claims, which can lag up to ~1h until ID token refresh).
- **Today’s SA `approveTransfer`:** only updates flat `drivers/{uid}.companyId`. Under Option B that leaves **stale access to the old company** and **no access to the new company** until nested leaves are moved. Deny-matrix proves both behaviors.
- **Before any live Phase 2+ deploy:** SA transfer must call the nested move (`security/rtdb/membershipHelpers.mjs` → `buildDriverTransferUpdate`).

### 2. Multi-company at once?

- **Supported if** the driver has a nested leaf under **each** `companyId`.
- **`sharedWith` alone is NOT membership** for rules. Owner UI writes `drivers/{uid}/sharedWith`; the driver app does not use that for RTDB scoping today. If multi-company dispatch is a real product path, provision `drivers/{cid}/{uid}` per company (or change rules later to also honor `sharedWith` — not recommended as primary).

### 3. Performance vs custom claims?

- Option B does a `root.child(...).exists()` lookup per listener attach / write authorize.
- At BookaWaka scale (tens–low hundreds of concurrent drivers per company), this is **negligible** vs network and payload size. Firebase evaluates rules at attach/auth-change, not per child event for broad listeners.
- Custom claims are slightly cheaper to evaluate and reusable across Firestore/Storage, but add claim-sync infrastructure and **stale-claim windows** on transfer — worse for our transfer UX than Option B.

### 4. Long-term downsides vs claims?

| Topic | Option B | Custom claims |
|---|---|---|
| Transfer freshness | Immediate if nested leaf moved | Stale until token refresh |
| Multi-company | Natural (multiple leaves) | Awkward (claim size / multi-tenant lists) |
| Cross-product (Storage/Firestore) | Must re-check RTDB or duplicate | One claim works everywhere |
| Login without world-readable `drivers` | Still need Phase 4 server lookup | Claims can carry `companyId` |
| Compromise if leaf not deleted | Stale tenant access | Stale until claim cleared |

**Net:** Option B is the right fit for RTDB-first BookaWaka **if** transfer/offboard always delete nested leaves. Revisit claims only if we add Storage/Firestore rules that need the same ACL without RTDB lookups.

## Files

| Path | Role |
|---|---|
| `database.rules.phase0-shadow.json` | Copy of live rules + Option B on closedJobs / completedJobs / tmTripStatus / companySettings |
| `firebase.json` | Emulator config (port 9000) — local only |
| `membershipHelpers.mjs` | Canonical expressions + transfer update builder |
| `rtdb-deny-matrix.test.mjs` | Deny-matrix + transfer/multi-company cases (emulator) |
| `package.json` | **Isolated** deps (`firebase@10` + `@firebase/rules-unit-testing` + `firebase-tools@13`) so they never conflict with the driver app's `firebase@11` |

## Run

```bash
# Always (no Java): Option B helpers + shadow-rules assertions + semantic deny-matrix
npm run test:unit
# or narrowly:
node --test tests/rtdb-membership-helpers.test.mjs tests/rtdb-deny-matrix-semantic.test.mjs

# Full Firebase emulator deny-matrix (Java 17+).
# Installs into security/rtdb/node_modules only — does NOT touch the app's firebase@11 tree.
# Uses firebase-tools@13 (JDK 17); global firebase-tools 15+ requires JDK 21.
npm run test:rtdb-rules
```

If `test:rtdb-rules` fails with `Could not spawn java -version`, install a JDK and re-run. Semantic suite covers the same Option B allow/deny cases without the emulator.

## Explicitly out of scope (Phase 0)

- Deploying rules to `bookawaka2026-564e1`
- Changing live `INVT/database.rules.json`
- Closing public `notification*` / `online` holes (Phase 1+)
- Shipping SA transfer UI fix (required before Phase 2 live; helper is ready in `membershipHelpers.mjs`)
