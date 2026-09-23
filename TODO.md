# TODO — La Brisa de Mar del Plata Manager

High-level backlog of everything requested so far. Each section will be broken down into its own spec + implementation plan (via superpowers brainstorming/writing-plans) before coding starts.

## 1. Core reservation management
- [x] List all reservations
- [x] Track which source each reservation came from (Booking.com, Airbnb, direct/WhatsApp, etc.)
- [x] Keep historical record of past reservations (for marketing use, see section 5)

## 2. Guest onboarding workflow (per new reservation)
- [x] New reservation is created (manually or via channel sync)
- [x] Automated message sent to guest asking to confirm dates and number of pax
- [x] Request 30% of total amount as booking confirmation payment
- [x] Guest must accept a "digital contract" (house rules: no parties, noise, etc.)
- [x] Request a refundable security deposit (returned after checkout)
- [x] Once terms accepted + dates/pax confirmed + 30% payment confirmed → mark reservation as confirmed
- [x] Send confirmation email to guest once fully confirmed

## 3. Channel integrations
- [x] Integrate with Booking.com to fetch/sync reservations — iCal feed (date-blocking only) **plus** a Chrome extension that scrapes the real extranet reservation page (guest name/contact/pax/price) and sends it to `POST /reservations/import`
- [x] Integrate with Airbnb to fetch/sync reservations — same iCal + Chrome extension pattern, scraping the hosting-messages thread page instead (Airbnb never exposes guest email here, only phone)
- [x] App acts as central hub aggregating reservations from all sources
- [x] Re-running the Chrome extension against an already-imported reservation now **updates** it from the fresh scrape (only the fields that scrape actually found) instead of no-op'ing, with a passive "already loaded" indicator shown before the operator even clicks anything
- [ ] ~~Headless-browser credential scraping~~ — considered and **rejected** (ToS risk, stored credentials, fragility); the Chrome-extension approach above was built instead, since it scrapes only what the logged-in staff member's own browser session can already see, no stored credentials needed
- [ ] ~~Screenshot/OCR import~~ — built (`api/src/reservation-import/`, Tesseract OCR), then **removed**: once the Chrome extension covered both channels directly, the OCR path was redundant, so it and its "Importar desde captura" control were deleted outright rather than left as unused surface area
- [x] **iCal feeds repurposed as a mismatch detector, not a data source** — since the Chrome extension is now how reservation data actually gets in, `ChannelSyncService` no longer creates/upserts Reservation rows from Booking.com/Airbnb's iCal feed at all. Every 30 minutes it checks each blocked date range in the feed against real reservations on file (by date overlap); an unmatched blocked range raises a `CALENDAR_MISMATCH` Notification (deduped per feed event so it doesn't repeat every sync while still unread) — a sign staff haven't loaded that reservation yet.

## 4. Google Calendar integration
- [x] Sync reservations to a shared Google Calendar — two-way: reservations push to the calendar, and changes made directly in Google Calendar pull back in on a schedule (plus manual "sync now" / "force sync" buttons in Settings)
- [x] Staff/employees can view all reservations on the calendar

## 3b. Notifications system
- [x] In-app notification center: `Notification` model, staff-only list/unread-count/mark-read endpoints, a bell-style "Notificaciones" nav link with an unread badge (polled every 60s), and a `/notifications` page. Currently raised by two sources: `CALENDAR_MISMATCH` (section 3 above) and `PAYMENT_RECEIPT_UPLOADED` (section 8 below).

## 8. Payment receipt uploads (guest-facing)
- [x] Guests can upload a payment/deposit receipt image from the check-in page (Step 3: Pago y garantía) — file picker or paste, same UX pattern the removed screenshot-OCR control used. Files are stored on local disk (a Docker volume, `receipts_data:/app/uploads`), served back only through an authenticated endpoint (JWT for staff, confirmationToken match for the guest re-viewing their own upload) since receipts are financial documents, never a public URL.
- [x] Every upload raises a `PAYMENT_RECEIPT_UPLOADED` notification linking to the reservation.
- [x] Admin's reservation detail page shows a thumbnail gallery of uploaded receipts with "Marcar pago del 30% como recibido" / "Marcar depósito como recibido" buttons right next to them (the same underlying actions already on the page, just surfaced next to the evidence) — staff decide from the image itself which payment(s) it covers, since receipts aren't tagged to a specific payment at upload time.

## 5. Marketing / CRM
- [x] Maintain guest history across all past reservations — including phone-only guests (Airbnb), who couldn't get a `Guest` record at all until that was fixed
- [x] Ability to send marketing campaigns to past guests — filtered by "stayed within N months" / "not stayed within N months" / all, with an unsubscribe link
- [x] **Guest confirms/validates their own contact info** (the first future idea) — effectively done as a side effect of the existing flow: the guest-web wizard's Step 1 always writes the guest-entered name/phone/email onto the reservation and syncs it to the `Guest` record, so the guest's own input already wins over whatever staff first typed in. Not framed as an explicit "differs from what's on file, confirm the change" step, and no staff-review gate before it takes effect — worth a proper brainstorming pass only if that gap actually causes a problem in practice.
- [ ] **Guest change-history / audit log** — still not done. No model tracks what a `Guest`'s phone/email/name changed from/to or when; `ReservationEvent` only covers reservation-level events, not guest-field edits. Needs its own brainstorming pass if this becomes something staff actually need (e.g. for a "wait, why did this change" question).

## 6. Infrastructure & deployment
- [x] Dockerized infrastructure (local dev environment)
- [x] Easy deployment to production server — `deploy.sh`, live on a DigitalOcean droplet
- [x] Two separate web apps/sites:
  - [x] Admin "intranet" app (internal reservation management)
  - [x] Public-facing app (guest forms: confirmation, contract acceptance, payment info) — kept separate so guests never access the admin/intranet site
- [x] Use labrisa.com.ar domain with subdomains for each app (`admin.`, `checkin.`, `api.labrisa.com.ar`)
- [x] Guest-facing app's look and feel matches labrisa.com.ar's branding (favicon pulled from the real site, footer links back to it, redesigned theme)
- [x] **UI component library** — done: both `admin-web/src/ui/` and `guest-web/src/ui/` have a shared set of components (Button, Card, FormField, Input, Select, Table, Badge, PageHeader, Alert, etc.), applied across every page, mobile-first with working desktop layouts

## 7. Staff notifications via WhatsApp (Twilio)
- [ ] **Still entirely pending.** What exists today is guest-facing only: automatic WhatsApp reminders *to guests* (reservation reminder + deposit reminder, both on a daily schedule, templates configurable in Settings). There is no staff-group notification channel yet — nothing pings the team on Twilio WhatsApp for "reservation confirmed and paid", "guest checks out tomorrow", etc. Still needs its own brainstorming pass: which events trigger a message, Twilio WhatsApp Business template approval, where the group/recipient config lives.

## Planning order (proposed)
1. Core reservation management + multi-channel source tracking + base infra skeleton (Docker, two-app structure, subdomain routing)
2. Guest onboarding workflow automation (messaging, deposit, contract, confirmation email)
3. Channel integrations (Booking.com / Airbnb sync)
4. Google Calendar integration
5. Marketing / CRM campaigns
