# TODO — La Brisa de Mar del Plata Manager

High-level backlog of everything requested so far. Each section will be broken down into its own spec + implementation plan (via superpowers brainstorming/writing-plans) before coding starts.

## 1. Core reservation management
- [ ] List all reservations
- [ ] Track which source each reservation came from (Booking.com, Airbnb, direct/WhatsApp, etc.)
- [ ] Keep historical record of past reservations (for marketing use, see section 5)

## 2. Guest onboarding workflow (per new reservation)
- [ ] New reservation is created (manually or via channel sync)
- [ ] Automated message sent to guest asking to confirm dates and number of pax
- [ ] Request 30% of total amount as booking confirmation payment
- [ ] Guest must accept a "digital contract" (house rules: no parties, noise, etc.)
- [ ] Request a refundable security deposit (returned after checkout)
- [ ] Once terms accepted + dates/pax confirmed + 30% payment confirmed → mark reservation as confirmed
- [ ] Send confirmation email to guest once fully confirmed

## 3. Channel integrations
- [ ] Integrate with Booking.com (credentials or API) to fetch/sync reservations
- [ ] Integrate with Airbnb (credentials or API) to fetch/sync reservations
- [ ] App acts as central hub aggregating reservations from all sources
- [ ] **Future idea (not yet designed/approved):** iCal sync only gives blocked date ranges, not guest name/contact/pax/price. Considered alternative: use a headless browser (e.g. Playwright/Puppeteer) logged in with the owner's own Booking.com extranet credentials to scrape the actual reservation details page instead of relying on iCal. Real tradeoffs to weigh before building this: (1) likely violates Booking.com's/Airbnb's Terms of Service — scraping a logged-in account is different from using a public export feed; (2) fragile — breaks silently whenever the extranet's HTML/login flow changes, no warning like an API would give; (3) requires storing the owner's real login credentials (and handling 2FA) in the app, a meaningfully bigger security surface than an iCal URL or an API key. Worth a fresh brainstorming pass on its own before committing to it, weighed against just having staff manually copy guest details from the Booking.com/Airbnb inbox (which the current iCal-based plan already assumes).
- [ ] **Future idea (not yet designed/approved), safer alternative to the scraping idea above:** let staff take a screenshot of a Booking.com/Airbnb reservation page and upload the image to the admin app; extract guest name, dates, pax, price etc. from the image (via an LLM vision model or OCR) to pre-fill the reservation form instead of typing it all manually. No login automation, no stored credentials, no ToS risk since it's just an image the staff member captured themselves — meaningfully lower-risk than the scraping idea. Worth its own brainstorming pass (accuracy/failure handling when extraction gets a field wrong, which vision/OCR service to use, image upload storage).

## 4. Google Calendar integration
- [ ] Sync reservations to a shared Google Calendar
- [ ] Staff/employees can view all reservations on the calendar

## 5. Marketing / CRM
- [ ] Maintain guest history across all past reservations
- [ ] Ability to send marketing campaigns to past guests
- [ ] **Future idea (not yet designed/approved):** at the guest check-in link (the existing guest onboarding portal), have the guest validate/confirm their phone number and email as part of the flow. If what they enter differs from what's on file, update our stored record to match what the guest confirmed — treat the guest's own confirmation as more trustworthy than whatever staff originally typed in (same reasoning already applied to `Guest.name` syncing from contract acceptance in sub-project 5). Needs its own brainstorming pass: what exactly "validate" means (a plain confirm-or-edit field vs. an actual verification step like an OTP/confirmation link), and whether changing the on-file contact info for an in-progress reservation should require any staff review before taking effect.
- [ ] **Future idea (not yet designed/approved):** give `Guest` a history-of-changes record — e.g. if a guest updates their phone number (per the idea above, or any other future edit path), keep a trail of what changed, from what value to what value, and when. Needs its own brainstorming pass: whether this is a generic audit log (reusable pattern, similar to `ReservationEvent` from sub-project 2) or a narrower phone/email-only change log, and how much history is actually useful to show staff versus just useful for debugging a "wait, why did this change" question.

## 6. Infrastructure & deployment
- [ ] Dockerized infrastructure (local dev environment)
- [ ] Easy deployment to production server
- [ ] Two separate web apps/sites:
  - [ ] Admin "intranet" app (internal reservation management)
  - [ ] Public-facing app (guest forms: confirmation, contract acceptance, payment info) — kept separate so guests never access the admin/intranet site
- [ ] Use labrisa.com.ar domain with subdomains for each app (e.g. admin subdomain + public/guest-facing subdomain)
- [ ] Guest-facing app's look and feel should match labrisa.com.ar's existing design (colors, typography, general style) so guests feel it's an integrated part of the same site, not a disconnected tool. Admin/intranet app has no such constraint — internal-only, functional design is fine.

## 7. Staff notifications via WhatsApp (Twilio)
- [ ] Send notifications to a staff WhatsApp group chat via the Twilio WhatsApp API (distinct from the existing email-based failure alerts from sub-project 2 — this is for day-to-day operational visibility, not just error alerting)
- [ ] Example notifications: "New reservation confirmed and paid for [dates]", "Reminder: current guest checks out tomorrow at 3PM", likely also new-reservation-created, deposit-received, deposit-return-due
- [ ] Needs its own brainstorming pass: which events trigger a message (avoid notification fatigue from over-notifying), Twilio WhatsApp Business setup/approval process, message template requirements (WhatsApp Business API requires pre-approved templates for business-initiated messages), where the group/recipient config lives

## Planning order (proposed)
1. Core reservation management + multi-channel source tracking + base infra skeleton (Docker, two-app structure, subdomain routing)
2. Guest onboarding workflow automation (messaging, deposit, contract, confirmation email)
3. Channel integrations (Booking.com / Airbnb sync)
4. Google Calendar integration
5. Marketing / CRM campaigns
