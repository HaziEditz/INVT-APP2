# BookaWaka Driver

Expo React Native driver app for the BookaWaka dispatch platform.

## Stack

- Expo SDK 52 · TypeScript · Expo Router
- Firebase Auth + Realtime Database
- Dispatch API: `https://invt-production.up.railway.app`
- Bundle ID: `com.bookawaka.driver`

## Setup

```bash
npm install
npx expo start
```

## EAS Build

```bash
npx eas build --profile production --platform android
```

Production updates channel: `production` (see `eas.json`).

## Screens

1. Login / Register
2. Home (shift, vehicle, go online, zone)
3. Job Offer modal (accept/decline + countdown)
4. Active Job (pickup → arrived → onboard → complete)
5. Meter (taxi fare + payment types)
6. Profile (earnings, NZTA hours, settings)
7. Job History
8. Zone Queue
9. Pre-booking
10. Chat

## Environment

Optional: set `EXPO_PUBLIC_COMPANY_ID` for default company scope.
