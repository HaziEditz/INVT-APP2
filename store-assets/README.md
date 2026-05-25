# Google Play Store — Setup Checklist

Files in this folder are everything you need to publish Bookawaka Driver to Google Play Internal Testing.

## What you need to do (one-time, ~1–2 hours)

### 1. Pay the Google Play Console fee — $25 USD one-time
Sign up at https://play.google.com/console — use a Google account you control long-term (changing the publisher account later is hard).

### 2. Host the privacy policy publicly
Open `store-assets/privacy-policy.md`, paste into:
- A public Google Doc (Share → Anyone with the link → Viewer), OR
- A simple Notion / GitHub Pages / company website page

Copy the public URL — you'll paste it into Play Console.

### 3. Build the production AAB
Run this command in the Replit shell when you're ready (takes ~15 min on EAS servers):
```
EAS_NO_VCS=1 npx eas-cli@latest build --profile production --platform android --non-interactive
```
On first run EAS will offer to generate and store an upload keystore for you — accept (this is the keystore Play Store will require for every future build, EAS keeps it safe).

When the build finishes EAS gives you a download link to a `.aab` file. Download it.

### 4. Create the app in Play Console
- App name: Bookawaka Driver
- Default language: English (United States) — or English (New Zealand)
- App or game: App
- Free or paid: Free
- Confirm declarations (developer program policies, US export laws)

### 5. Fill the store listing
Paste from `store-assets/play-store-listing.md` into:
- Main store listing (name, short description, full description)
- App category: Maps & Navigation
- Contact details
- Privacy policy URL (from step 2)

### 6. Upload graphic assets
- App icon (512×512) — reuse `assets/images/icon.png` (resize if needed)
- Feature graphic (1024×500) — create or commission
- Phone screenshots (2–8 minimum) — take from your A04 with the running app

### 7. Complete the policy questionnaires
- Content rating (IARC) — answers in `play-store-listing.md`
- Target audience — 18+ (professional drivers)
- News app: No
- COVID-19 contact tracing: No
- Data safety — answers in `play-store-listing.md`
- Government app: No
- Financial features: No (you process payments via Stripe but don't issue them)
- Health: No
- Ads: No (no ads in this app)

### 8. Internal testing release
Section "Internal testing track setup" in `play-store-listing.md` walks through it.

### 9. Send driver tester invites
Once the rollout shows "Available to testers" (5–10 min after you submit), send each driver the opt-in URL from Play Console. They click it on their phone and install via Play Store.

---

## After it's live — daily workflow

| Change | How to ship |
|---|---|
| Bug fix in JS / TypeScript / styling | `eas update` (instant, no Play Store) |
| New permission, new package, new app icon, app.json change | `eas build --profile production` → upload new AAB to Internal Testing → submit (5 min Google review) |
| Promote internal test → production rollout | Play Console → Production → Promote release |
