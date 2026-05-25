# Privacy Policy — Bookawaka Driver

**Effective date:** 12 May 2026
**Publisher:** Khyber Tech / Bookawaka

This privacy policy describes what information the **Bookawaka Driver** mobile application ("the app") collects, how it is used, and who it is shared with. The app is provided to professional taxi drivers operating under taxi companies that subscribe to the Bookawaka dispatch platform.

## 1. Who this policy applies to

This policy applies to drivers who install and sign in to the Bookawaka Driver app. Passengers using a separate passenger booking app are covered by a different policy provided by their booking app.

## 2. Information we collect

### 2.1 Account information
When a taxi company adds a driver to their fleet, the following details are entered by the company's dispatcher and stored in our backend so the driver can sign in:
- Driver name
- Driver ID (assigned by the company)
- Email address (used as login)
- Vehicle assignment (which taxi the driver is allocated to drive)
- Company affiliation

### 2.2 Location data
While the driver is signed in and on shift the app collects:
- Real-time GPS coordinates (latitude, longitude, accuracy, speed, heading)
- Foreground location while the app is open
- Background location while the meter is running, so trip distance and time stay accurate when the screen is locked or another app is in use

Location data is used to:
- Show the driver's position on the dispatcher console
- Match the driver to nearby job offers
- Calculate trip distance for the meter
- Record pick-up and drop-off coordinates on completed trips

Background location collection stops when the driver ends their shift or signs out.

### 2.3 Trip data
For every trip the app records:
- Pick-up address and coordinates
- Drop-off address and coordinates
- Start time, arrival time, pick-up time, completion time
- Distance travelled and duration
- Fare breakdown (flag fall, distance cost, waiting time cost, tariff used)
- Payment type (cash, EFTPOS, card, account, ACC, Total Mobility, gift card)
- Payment reference numbers where applicable (e.g. Total Mobility voucher number, ACC claim number, account client reference)
- Last four digits of card and cardholder name when a card payment is taken via the in-app reader

### 2.4 Communication
Chat messages between the driver and the company's dispatcher are stored so both sides can review the conversation.

### 2.5 Diagnostic data
To improve app stability we collect crash reports, performance metrics, and error logs through Sentry. These reports include device model, operating system version, app version, and a stack trace. They do not include personal information beyond what may incidentally appear in error messages.

## 3. How we use the information

We use the information solely to:
- Provide the dispatch service the driver's company has subscribed to
- Match drivers with passenger jobs
- Calculate fares correctly
- Process payments through Stripe (when card payment is used)
- Maintain shift records for the company's compliance with local work-time regulations
- Diagnose and fix app problems

We do **not** sell driver data, share it with advertisers, or use it for marketing.

## 4. Where the data is stored and who can see it

- **Realtime database** (Google Firebase, hosted in the United States) stores live presence, jobs, chat, and trip records. Each company's data is isolated by its company ID and is only visible to that company's dispatchers and drivers.
- **Stripe** processes card payments when the driver uses the in-app card reader. Card data is sent directly to Stripe and is not stored on our servers. Stripe's privacy policy: https://stripe.com/privacy
- **Sentry** stores diagnostic crash reports. Sentry's privacy policy: https://sentry.io/privacy/
- **The driver's own taxi company** (the dispatcher who employs them) has full visibility of that driver's trips, location while on shift, earnings, and chat history through the dispatcher console.

## 5. How long the data is kept

- Live location data is kept only while the driver is on shift and is overwritten continuously.
- Trip records, chat messages and shift history are kept by the taxi company for as long as required by local tax and transport regulations. Drivers should ask their company directly if they want a copy of their records or want them deleted.
- Diagnostic data in Sentry is kept for 90 days and then automatically deleted.

## 6. Permissions the app requests

| Permission | Why |
|---|---|
| Location (foreground + background) | Show driver on dispatcher map; calculate meter; record pick-up / drop-off |
| Foreground service | Keep the meter running accurately when the app is in the background |
| Notifications | Alert the driver to incoming job offers and chat messages |
| Storage / files (camera roll on iOS) | Save trip receipts (optional, only when the driver chooses to export one) |

## 7. Driver rights

Drivers can:
- View, edit and update their profile through the Profile tab
- Sign out at any time, which clears their live presence from the dispatcher view
- Request a copy or deletion of their personal data by contacting their taxi company's administrator
- Uninstall the app at any time, which stops all data collection from that device

## 8. Children

The app is intended for licensed adult taxi drivers and is not directed at children under 13. We do not knowingly collect data from children.

## 9. Changes to this policy

If we make material changes to this policy we will update the effective date at the top and notify drivers in-app the next time they sign in.

## 10. Contact

For privacy questions, data requests or complaints contact:

**Bookawaka**
Email: info@bookawaka.com

If you are unsatisfied with our response you can also raise the matter with the privacy regulator in your country.
