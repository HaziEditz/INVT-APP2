# Google Play Store — Listing Copy

Paste these into the matching fields in Play Console → Store presence → Main store listing.

---

## App name (max 30 chars)
```
Bookawaka Driver
```

## Short description (max 80 chars)
```
Dispatch, meter and earnings for licensed taxi drivers on the Bookawaka network.
```

## Full description (max 4000 chars)
```
Bookawaka Driver is the official driver app for taxi companies on the Bookawaka dispatch platform. Drivers sign in with credentials issued by their taxi company and can immediately start receiving jobs, running the meter, and tracking their shift earnings.

KEY FEATURES

Dispatch jobs
- Receive job offers from your company's dispatcher with one tap to accept, decline, or queue
- See pickup, drop-off, passenger details and any special notes before accepting
- Live turn-by-turn map from your current location to the pickup, then from pickup to drop-off

Hail trips
- Start a metered trip the moment a passenger flags you down on the street
- Pick the right tariff (standard, peak, airport, Total Mobility, etc.) from your company's tariff list
- Complete fares are written back to dispatch for end-of-shift earnings reconciliation

Smart meter
- Distance and time tracked from real GPS, with automatic waiting-time detection when the car is stationary
- Tariff-aware fare calculation including flag-fall, per-kilometre rate, and per-minute waiting charge
- Meter keeps counting accurately even when the screen is locked

Payments built in
- Cash, EFTPOS, card (via in-app Stripe reader), corporate account, ACC, Total Mobility, and gift-card vouchers
- Capture voucher numbers, claim references and passenger contributions in one screen
- Payment receipts are written to the company's records automatically

Shift management
- Start and end shifts with one tap; the app handles your online status with dispatch
- Built-in NZ work-time compliance: hours worked, rest breaks, and warnings before the legal limit
- Daily, weekly and shift-by-shift earnings totals on the Shift tab

Driver booking
- Create a passenger booking from inside the app (e.g. for a regular customer who phones you directly) and send it to your dispatcher's unassigned tab

Chat with dispatch
- Two-way messaging with your company's dispatcher; works offline and syncs when you reconnect

Multi-tenant
- Works for any taxi company on the Bookawaka platform; your data is isolated by company

ACCOUNT REQUIRED
This app is for licensed taxi drivers whose company has subscribed to Bookawaka dispatch. If your company is not on Bookawaka the app cannot be used. Ask your dispatcher for sign-in credentials before downloading.

PERMISSIONS
- Location (including background): so the meter keeps counting time and distance when your screen is off, and so dispatch can match you to nearby jobs
- Notifications: to alert you to incoming job offers and dispatcher messages

PRIVACY
We never sell driver data. Live location is collected only while you are on shift and stops the moment you sign out. Full privacy policy at https://bookawaka.com/privacy (or wherever you publish it).

SUPPORT
Contact your dispatcher first for company-specific issues. For app bugs or installation problems email support@bookawaka.com.
```

---

## Categorisation

| Field | Value |
|---|---|
| App or game | App |
| Category | Maps & Navigation (alternative: Auto & Vehicles) |
| Tags (up to 5) | Taxi, Dispatch, Driver, Meter, Fleet |
| Email contact | support@bookawaka.com |
| Phone contact | (optional — leave blank or add company number) |
| Website | https://bookawaka.com (or your real site) |
| Privacy policy URL | **REQUIRED** — must be hosted publicly. See store-assets/privacy-policy.md and host the rendered version. |

---

## Graphic assets you need to upload

| Asset | Spec | Status |
|---|---|---|
| App icon | 512×512 PNG, no alpha, no rounding | Reuse `assets/images/icon.png` (verify size — Play Console will reject if not exactly 512×512). |
| Feature graphic | 1024×500 JPG or PNG | **Need to create** — hero image with app logo + tagline "Dispatch, meter, earnings for taxi drivers". Can be a simple gradient with text. |
| Phone screenshots | 2–8 images, 1080×1920 (or device aspect), JPG/PNG | **Need to capture** — recommended set: Dashboard with active shift, Job offer modal, Meter running, Payment screen, Earnings/Shift tab. Take from your A04 with the actual app. |
| Tablet screenshots | Optional | Skip — app is phone-only (`supportsTablet: false`) |

---

## Content rating

When you fill out the IARC questionnaire in Play Console, the answers should be:
- Violence: None
- Sexual content: None
- Profanity: None
- Controlled substances: None
- Gambling: None
- User-generated content: **Yes** (driver-to-dispatcher chat) — say messages are visible only to the company that employs the driver, not public
- Shares user location: **Yes** — shared with the driver's employing taxi company only

Expected rating: **Everyone**.

---

## Data safety form

Play Console requires a Data Safety form. Declare:

| Data type | Collected | Shared | Purpose | Required / optional |
|---|---|---|---|---|
| Approximate location | Yes | Yes (with the driver's employer) | App functionality, fraud prevention | Required |
| Precise location | Yes | Yes (with the driver's employer) | App functionality (job matching, meter) | Required |
| Name | Yes | Yes (with employer) | Account management | Required |
| Email address | Yes | No | Account management | Required |
| User IDs | Yes | Yes (with employer) | Account management | Required |
| Payment info | Yes | Yes (with Stripe + employer) | Process card payments | Optional (only on card trips) |
| Messages | Yes | Yes (with employer) | App functionality (driver↔dispatcher chat) | Optional |
| Crash logs | Yes | Yes (with Sentry) | Analytics | Optional |
| App performance | Yes | Yes (with Sentry) | Analytics | Optional |

- Data is encrypted in transit: **Yes**
- Drivers can request data deletion: **Yes** (via their employer / support email)
- Independent security review: **No** (unless you've actually had one)

---

## Internal testing track setup

1. Play Console → **Testing** → **Internal testing** → **Create new release**
2. Upload the AAB EAS produced (`build-xxxx.aab`)
3. Release name: `1.4.0 (1)` — Play Console will fill the version code automatically
4. Release notes: paste the recent OTA changelog from `replit.md`
5. **Save** → **Review release** → **Start rollout to internal testing**
6. Tab over to **Testers** → create a tester list → paste driver Gmail addresses → save
7. Copy the **opt-in URL** (looks like `https://play.google.com/apps/internaltest/...`) and send it to each driver
8. Driver clicks link on phone → "Become a tester" → "Download it on Google Play" → installs

After step 7 every future OTA you publish (`eas update`) reaches their device automatically; only native code changes need a fresh AAB upload.
