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
- [x] In-app notification center: `Notification` model, staff-only list/unread-count/mark-read endpoints, a bell-style "Notificaciones" nav link with an unread badge (polled every 60s), and a `/notifications` page. Raised by five sources now: `CALENDAR_MISMATCH` (section 3), `PAYMENT_RECEIPT_UPLOADED` and `GUEST_MESSAGE` (a guest's payment-update note with no receipt attached — section 8), and `AMBIENT_ALERT`/`DEVICE_OFFLINE` (section 9).

## 8. Payment receipt uploads (guest-facing)
- [x] Guests can upload a payment/deposit receipt image from the check-in page (Step 3: Pago y garantía) — file picker or paste, same UX pattern the removed screenshot-OCR control used. Files are stored on local disk (a Docker volume, `receipts_data:/app/uploads`), served back only through an authenticated endpoint (JWT for staff, confirmationToken match for the guest re-viewing their own upload) since receipts are financial documents, never a public URL.
- [x] Every upload raises a `PAYMENT_RECEIPT_UPLOADED` notification linking to the reservation; a guest can also send a plain text note with no image attached, which raises a `GUEST_MESSAGE` notification instead.
- [x] Admin's reservation detail page shows a thumbnail gallery of uploaded receipts with "Marcar pago del 30% como recibido" / "Marcar depósito como recibido" buttons right next to them (the same underlying actions already on the page, just surfaced next to the evidence) — staff decide from the image itself which payment(s) it covers, since receipts aren't tagged to a specific payment at upload time.

## 5. Marketing / CRM
- [x] Maintain guest history across all past reservations — including phone-only guests (Airbnb), who couldn't get a `Guest` record at all until that was fixed
- [x] Ability to send marketing campaigns to past guests — filtered by "stayed within N months" / "not stayed within N months" / all, with an unsubscribe link
- [x] **Guest confirms/validates their own contact info** (the first future idea) — effectively done as a side effect of the existing flow: the guest-web wizard's Step 1 always writes the guest-entered name/phone/email onto the reservation and syncs it to the `Guest` record, so the guest's own input already wins over whatever staff first typed in. Not framed as an explicit "differs from what's on file, confirm the change" step, and no staff-review gate before it takes effect — worth a proper brainstorming pass only if that gap actually causes a problem in practice.
- [x] **Guest change-history / audit log** — done. `GuestEvent` tracks NAME/PHONE/EMAIL_CHANGED with structured `field`/`oldValue`/`newValue` columns (plus a human-readable `detail`), and `ReservationEvent` gained a matching `FIELD_CHANGED` type covering every reservation field (price, dates, pax, status, guest info) edited via the admin app, the guest's own check-in form, or a Booking.com/Airbnb re-scrape. Both also record `actor` — the staff email, "Huésped", or "Extensión de Chrome" — answering the "wait, why did this change" question this item called out, including "who did it." Surfaced in `ActivityLogPage` and `GuestDetailPage`. Along the way, fixed a real bug this uncovered: `GuestsService.syncFromReservation` was re-deriving guest identity from email/phone on every sync, so correcting a guest's contact info on an existing reservation could silently create a duplicate `Guest` instead of updating the one on file.

## 6. Infrastructure & deployment
- [x] Dockerized infrastructure (local dev environment)
- [x] Easy deployment to production server — `deploy.sh`, live on a DigitalOcean droplet
- [x] Two separate web apps/sites:
  - [x] Admin "intranet" app (internal reservation management)
  - [x] Public-facing app (guest forms: confirmation, contract acceptance, payment info) — kept separate so guests never access the admin/intranet site
- [x] Use labrisa.com.ar domain with subdomains for each app (`admin.`, `checkin.`, `api.labrisa.com.ar`)
- [x] Guest-facing app's look and feel matches labrisa.com.ar's branding (favicon pulled from the real site, footer links back to it, redesigned theme)
- [x] **UI component library** — done: both `admin-web/src/ui/` and `guest-web/src/ui/` have a shared set of components (Button, Card, FormField, Input, Select, Table, Badge, PageHeader, Alert, etc.), applied across every page, mobile-first with working desktop layouts

## 3c. WhatsApp delivery tracking
- [x] Every WhatsApp send (check-in link, reservation reminder, deposit reminder) is tracked in `WhatsappMessage`; Twilio's signed status callback (`POST /webhooks/twilio/whatsapp-status`) updates it. Rejected or undelivered messages show on the reservation list's warning icon until resent successfully or no longer relevant, and on the reservation detail page with Twilio's error code. See `docs/superpowers/specs/2026-10-01-whatsapp-delivery-tracking-design.md`.

## 7. Staff notifications via WhatsApp (Twilio)
- [ ] **Still entirely pending.** What exists today is guest-facing only: automatic WhatsApp reminders *to guests* (reservation reminder + deposit reminder, both on a daily schedule, templates configurable in Settings). There is no staff-group notification channel yet — nothing pings the team on Twilio WhatsApp for "reservation confirmed and paid", "guest checks out tomorrow", etc. Still needs its own brainstorming pass: which events trigger a message, Twilio WhatsApp Business template approval, where the group/recipient config lives.

## 9. Ambient monitoring (ESP32 sensors)
- [x] Firmware (`ambient-control/`) on an ESP32 reads sound, MQ-7 CO, MQ-2 smoke, and DHT22 temperature/humidity, and reports to the API over `/ambient-alerts` (on a threshold breach) and a heartbeat (`AmbientService.recordHeartbeat`)
- [x] Per-sensor alert thresholds, with an "emergency" tier (sustained, much-higher-than-alert reading) that sounds the physical buzzer until it clears
- [x] Admin web's Sensores page: per-device cards showing each sensor's last reading against its threshold, device online/offline status, and a remote "Probar sirena" (test buzzer) control
- [x] `DEVICE_OFFLINE` notification when a device stops heartbeating
- [x] Guests can see the same ambient readings on their own check-in confirmation page (Step 4, "Sensores" tab)
- [x] Sound/CO/smoke are explicitly presented as raw uncalibrated ADC counts, not real ppm/dB units, since only the DHT22 (temperature/humidity) is a genuinely calibrated sensor

## 10. Security review (2026-09-29)
Full-repo review of the API, admin-web, guest-web, Chrome extension, ambient-control firmware and deploy setup. Ordered by severity.

**High**
- [x] **Unauthenticated DoS via the guest receipt upload** — `POST /public/reservations/:token/images` buffered up to 10 × 10 MB into memory *before* the token was checked (any made-up token worked), with no rate limit, on a `multer` version (2.2.0, via `@nestjs/platform-express` ≤11.2.5) carrying 5 high-severity advisories (crash / size-limit bypass). Fix: upgrade, validate the token in a guard (guards run before the multipart interceptor), rate-limit `public/*`. **Done:** `@nestjs/platform-express` 11.2.6 / `multer` 2.4.0; `PublicReservationTokenGuard` rejects unknown/expired tokens before the body is read; `public` throttler (120/min per IP, 10/min on uploads).
- [ ] **`DEBUG_MODE=true` in production** (per the production reference block in the local `.env` — verify on the droplet). Redirects every guest email to the debug inbox, and lets *any* reservation token ever issued — including past guests' — read the live sensors (sound/CO/temp/humidity) at any time, since the fully-confirmed + during-stay gate is skipped. A former guest could infer when the current guests are home. Fix: turn it off; refuse to boot with it on in production.
- [x] **Stored XSS via SVG receipt upload** — the upload filter trusted the client-sent `image/*` mimetype (SVG included) and the file was served back with that exact Content-Type. Opening a receipt in a new tab from the admin app (a `blob:` URL, so admin origin) would run the SVG's script where the admin JWT lives in `localStorage` (8h, no revocation). Fix: detect the type from magic bytes (jpeg/png/webp/gif/heic only), store the detected type, serve with `nosniff` + `CSP: sandbox`. **Done:** `reservation-images/image-type.ts`; legacy rows with a non-raster type are served as `application/octet-stream` attachments.
- [x] **No brute-force protection on `/auth/login`** — single admin account, no rate limit or lockout. Fix: per-IP throttle on login, with Express `trust proxy` set so throttling sees real client IPs behind Traefik (without it every throttle in the app buckets all clients under Traefik's IP). **Done:** 10 attempts / 15 min per IP; `trust proxy` = 1 in `main.ts`.

**Medium**
- [x] **No security headers anywhere** — no HSTS, CSP, `X-Frame-Options`, `nosniff`, `Referrer-Policy` from Traefik, either nginx, or the API (no `helmet`). Admin app is clickjackable and has no CSP backstop. **Done:** `helmet` on the API (CORP relaxed to same-site for guest-web's receipt `<img>`s); both nginx configs send CSP (API origin injected from `VITE_API_URL` at image build), HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy` (`no-referrer` on guest-web, whose URLs carry the token), `Permissions-Policy`.
- [x] **Guest confirmation tokens never expire** — `/r/:token` grants bank details (CBU/CUIL), the guest's own data and receipts, uploads, and a one-time contact-info overwrite, forever. The link travels through Airbnb messages and email. Fix: expire N days after check-out. **Done:** `TOKEN_VALID_DAYS_AFTER_CHECKOUT = 30`; an expired link gets the same 404 as an unknown one (guest-web already shows "link no válido").
- [x] **HTML injection into outbound emails** — `guestName` (guest-controlled via confirm-dates, or scraped from Booking/Airbnb) was interpolated raw into the HTML email templates, staff alert emails and campaign emails — a phishing link inside a genuine La Brisa email to staff. Fix: HTML-escape interpolated values (templates themselves stay staff-authored HTML). **Done:** `common/escape-html.ts`, applied in `EmailService` (templates + alerts) and campaign bodies; `renderTemplate` itself untouched since it also renders plain-text WhatsApp/Airbnb messages.
- [x] **Guest identity takeover by email** — when a reservation has no `guestId` yet, confirm-dates upserts the `Guest` by email, so a token holder who types someone else's email links to (and overwrites name/phone on) that person's profile. Also: guests are enrolled in marketing with no explicit opt-in — check against Ley 25.326. **Done** (guest identity document feature, `docs/superpowers/specs/2026-09-29-guest-identity-document-design.md`): the identity document (AES-256-GCM encrypted, matched by HMAC) is required at check-in and is the guest key; the guest form only fills blanks on a matched profile and logs `CONTACT_INFO_NOT_APPLIED`; an email/phone owned by another guest is skipped, not thrown; marketing needs the check-in opt-in. Residual risk accepted in the spec: someone who knows a stranger's DNI can link their own stay to that profile (but can't read or change it).
- [ ] **Ambient device: physical tamper can silence life-safety alerts** — USB serial `CALIBRATE_CO`/`CALIBRATE_SMOKE` are unauthenticated and have no upper bound, so calibrating in contaminated air raises the threshold arbitrarily. Flash isn't encrypted, so a USB dump yields the WiFi password and `AMBIENT_API_KEY`. Fix: hard cap thresholds in firmware, alert server-side when a heartbeat-reported threshold changes, enable flash encryption/secure boot, tamper-resistant enclosure; keep a certified standalone CO detector regardless. **Partly done:** CO/smoke alert thresholds capped in firmware (CO 2500; smoke 3200, since the MQ-2 reads ~2590 in normal air) (an over-cap calibration is rejected, an over-cap NVS value ignored at boot); emergency threshold capped at 4000 (2× the 2500 default was above the 12-bit ADC's 4095, so the buzzer could never sound); threshold-changing serial commands need `SERIAL_ADMIN_PIN` (5s lockout after a wrong one); the API raises an `AMBIENT_ALERT` when a heartbeat reports a changed CO/smoke threshold or one over the cap. **Still open (needs the physical board):** flash encryption + secure boot v2 + NVS encryption (irreversible eFuse burn — try on a spare board first; see ambient-control/README.md "Hardening"), enclosure, standalone CO detector. Until flash is encrypted, a USB dump also reveals `SERIAL_ADMIN_PIN`.
- [x] **CI host-key check is a no-op** — `ssh-keyscan` runs in the same job right before `StrictHostKeyChecking=yes` (`.github/workflows/deploy.yml`), so it trusts whatever answers. Fix: store the droplet's host key as a secret. **Done:** the workflow writes `known_hosts` from the `SSH_KNOWN_HOSTS` secret and refuses to deploy without it; capturing it out-of-band is in `docs/deploy-github-actions-setup.md`. Still open: Related: deploy user presumably in the `docker` group (root-equivalent) and Traefik mounts `docker.sock` — keep that SSH key tightly scoped.
- [ ] **Plaintext production secrets in the local `.env`** (step-by-step in "Owner checklist" below) — JWT secret, DB password, admin password, Twilio token in the commented reference block, file mode 644 (not committed). Fix: move to a password manager, `chmod 600`, rotate if this machine has been shared/backed up elsewhere.

**Personal-data protection (Ley 25.326 / AAIP Res. 47/2018)**
- [ ] **No encryption at rest beyond the server disk** — names, emails, phones and receipt images sit in plain Postgres and on the uploads volume; a DB dump or backup exposes everything. Document numbers get app-level encryption in the guest-document feature; decide whether other fields/receipts need the same.
- [ ] **Single shared admin account** — no per-staff users, no offboarding, no MFA, and the change-history "actor" is always the same email. Needs user management (and ideally MFA).
- [ ] **Sessions can't be revoked** — JWT lives 8h in `localStorage`; logout only deletes the local copy. Consider short-lived tokens + refresh, or a server-side session/revocation list.
- [ ] **No read/access audit** — changes are logged, reads aren't; nobody can answer "who viewed this guest's document".
- [ ] **No visible backup strategy** — nothing in the repo backs up Postgres or the receipts volume (code comments assume droplet backups; verify). Backups must be encrypted and include a restore test.
- [ ] **No retention policy or ARCO process** — guest data and receipts are kept forever; no way to handle access/rectification/deletion requests. **Partly done:** receipts are deleted daily once the stay is over and the deposit returned, or 30 days after check-out (`ReservationImagesRetentionService`). ARCO requests are still handled manually via contacto@labrisa.com.ar.
- [x] **No privacy notice or consent at collection** — check-in form doesn't inform the guest (Ley 25.326 art. 6), marketing enrollment has no opt-in, and the database likely needs registering with the AAIP's Registro Nacional de Bases de Datos. **Done:** short note + expandable full notice on the check-in form (`guest-web/src/confirmation/privacyNotice.ts`), unchecked marketing opt-in, campaigns only reach guests who opted in. Lawyer review and AAIP registration are in the owner checklist.
- [x] **Third-party data sharing undisclosed** — **Done:** listed in the check-in privacy notice. Was: guest names go to Google Calendar event titles; emails/phones to Resend and Twilio; hosting on DigitalOcean. Legitimate, but must be disclosed (and international transfers, art. 12, considered).

**Low**
- [ ] API-key guards compare with `!==` rather than a constant-time compare.
- [ ] One `AMBIENT_API_KEY` for all devices — a leaked key can impersonate any `deviceId` and feed readings guests see.
- [ ] Firmware pins only ISRG Root X1 — availability risk (not security) if Let's Encrypt's chain changes.
- [ ] `npm audit` still flags `deepmerge-ts` (high) via Prisma's CLI config loader — not reachable from requests; the only offered fix is a breaking Prisma downgrade.
- [ ] Unsubscribe is a plain `GET`, so email-security link scanners can unsubscribe guests unintentionally.

**Already solid:** OAuth `state` nonce; `@IsUrl` blocks `javascript:` in extension-error links; Postgres not exposed in prod; ESP32 validates TLS; UUIDv4 tokens; receipt images scoped to their reservation; extension has no `innerHTML`, no `externally_connectable`, HTTPS-only API URL; bcrypt; `ValidationPipe` whitelist; no secrets in git history; strong production secrets.

## 11. Owner checklist (manual, not code)
Things only Damian can do — nothing here goes in the repo. **Never paste secret values into this file**; names only.

**Local `.env` cleanup** (`/home/smarbos/dev/brisaManager/.env`)
- [ ] Save these to the password manager first, then **delete the whole commented `# PRODUCTION reference (droplet ...)` block** at the bottom of the file:
  - Secrets: `JWT_SECRET`, `POSTGRES_PASSWORD`, `ADMIN_SEED_PASSWORD`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`
  - Not secret, but part of the same block: `ADMIN_DOMAIN`, `GUEST_DOMAIN`, `API_DOMAIN`, `ACME_EMAIL`, `ADMIN_SEED_EMAIL`, `EMAIL_FROM`, `TWILIO_WHATSAPP_FROM`, and the stale `DEBUG_MODE=true` note (production actually reports `debugMode: false` as of 2026-09-29)
- [ ] Save these **active** real values to the password manager too: `RESEND_API_KEY`, `GOOGLE_CLIENT_SECRET`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `EXTENSION_API_KEY`, `AMBIENT_API_KEY`. If any of them is the *production* credential, consider a separate dev/test credential for local use.
- [ ] `chmod 600 .env` (currently 644 — readable by other users on this machine).
- [ ] If this machine or its backups have ever been shared, rotate the secrets above.

**Before deploying the security fixes of 2026-10-01**
- [ ] Add the `SSH_KNOWN_HOSTS` secret to the `production` GitHub Environment (see `docs/deploy-github-actions-setup.md`) — deploys fail without it.
- [ ] Before reflashing the ambient device: add `SERIAL_ADMIN_PIN` to `ambient-control/include/secrets.h` if it isn't there (a random one was generated locally on 2026-10-01) and save it in the password manager.

**Before deploying the guest identity document feature**
- [ ] Generate two keys: `openssl rand -hex 32` (run it twice — one per key).
- [ ] Add them to the **droplet's** `.env` as `DOCUMENT_ENCRYPTION_KEY` and `DOCUMENT_HASH_KEY` (the API won't start without them).
- [ ] Save both in the password manager. **Losing `DOCUMENT_ENCRYPTION_KEY` makes every stored document number unreadable forever.**
- [ ] Download any payment receipt still needed — the first retention run deletes receipts for stays that ended more than 30 days ago.

**Legal / admin**
- [ ] Have a lawyer review the check-in privacy notice (spec section 3), especially the AAIP legend wording.
- [ ] Confirm the city/province for the notice's address ("Formosa 259, depto L").
- [ ] Register the guest database with the AAIP's Registro Nacional de Bases de Datos.

## Planning order (proposed)
1. Core reservation management + multi-channel source tracking + base infra skeleton (Docker, two-app structure, subdomain routing)
2. Guest onboarding workflow automation (messaging, deposit, contract, confirmation email)
3. Channel integrations (Booking.com / Airbnb sync)
4. Google Calendar integration
5. Marketing / CRM campaigns
