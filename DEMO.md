# DEMO.md — La Brisa Reservation System: Video Walkthrough Script

Use this as a shot list for a screen-recording that walks your team through
the whole system: **admin app**, **guest check-in page**, and **Google
Calendar**. It's written as a sequence of "do this → say this" beats, in the
order that tells the clearest story (a reservation's whole life, start to
finish), not necessarily the order features were built.

Total runtime if you follow it beat-for-beat: roughly 18–22 minutes. Cut
whatever your audience already knows (e.g. skip Settings if this is for
front-desk staff who'll never touch it).

---

## Before you hit record

A few things to set up first so the recording goes smoothly and doesn't
show real guest data:

- [ ] **Create one throwaway "demo" reservation** to use throughout the
      video (see Part 2.2 below) — use a fake name and your own phone/email
      so you can actually receive the check-in link. Don't reuse a real
      guest's reservation on camera.
- [ ] **Have the check-in link handy on a second device or a phone**, so you
      can show the guest side of the flow right after creating it, without
      cutting the recording to wait for an email.
- [ ] **Have a small real image file ready** (a screenshot, a photo of a
      receipt — anything) to upload as the "payment receipt" in Part 3, so
      that beat doesn't stall looking for a file.
- [ ] **Decide whether Google Calendar is already connected.** If it is, you
      can only demo "Sincronizar ahora" / "Forzar sync" — the full
      Connect flow (Part 9) requires disconnecting first, which is
      disruptive to do on the real production calendar mid-recording.
      Simplest: demo it already-connected, and just describe the one-time
      connect step verbally instead of doing it live.
- [ ] **Chrome extension**: have it already installed and configured
      (options page → API URL + token saved) before recording — showing the
      one-time setup is optional and can be a short aside.
- [ ] **Booking.com / Airbnb import**: this only works against a real,
      logged-in Booking.com extranet page or a real Airbnb hosting-messages
      thread. If you don't have a live test reservation on either platform
      to film against, skip the live click-through and instead show the
      screenshots/description in Part 11 — don't fake it with unrelated
      data.
- [ ] Pick one real bank/payment detail set already in Settings → Pagos so
      the "Pago y garantía" step in the guest wizard shows real-looking
      (but not sensitive) info.

---

## Part 0 — The pitch (30 seconds, talking head or voiceover)

Say something like:

> "This is how we manage every reservation from the moment it's booked —
> whether it came from Booking.com, Airbnb, or someone calling us directly
> — through guest check-in, payment, and the security deposit, all the way
> to check-out. Three pieces: an admin app for us, a check-in page the guest
> uses on their phone, and a shared Google Calendar so everyone can see
> what's booked."

---

## Part 1 — Admin: Login

1. Open `admin.labrisa.com.ar`.
2. Log in with your staff email/password.
3. Land on **Reservas** — this is the home screen.

> "This is the admin app — only staff have access to this."

---

## Part 2 — Admin: Reservations list

1. Point out the **filters**: Canal (Booking.com / Airbnb / Directo / Otro)
   and Estado, which **defaults to "Pendiente"** — so whoever opens this
   page first sees what needs action, not the full history.
2. Point out the **Buscar** box — search by guest name.
3. Point out the **Precio** column (formatted as money) and the **⚠
   warning icon** at the start of a row — hover it to show the tooltip
   (missing email/phone, confirmation email never sent, missing amount, or
   unverified dates from a channel import). This is the "needs attention"
   signal.
4. Click **Nueva reserva**.

> "Reservas that come in through Booking.com or Airbnb land here
> automatically — I'll show that later with the Chrome extension. This
> button is for a reservation that comes in directly, like a WhatsApp
> message or a phone call."

### 2.2 — Create the demo reservation manually

1. Fill in: guest name (something obviously fake, e.g. "Reserva Demo"),
   your own email and phone (so you can receive the link), check-in/
   check-out dates, huéspedes, canal = **Directo**, monto total, moneda.
2. Save.

> "Since I gave it an email, the guest gets an automatic email right away
> with their check-in link. I'll skip waiting for that and just copy the
> link directly for this demo."

3. On the reservation detail page that appears, click **Copiar link de
   confirmación para el huésped** — paste it somewhere you can grab it from
   for Part 3 (or open it directly on your second device now).

---

## Part 3 — Guest check-in page (the guest's phone screen)

Open the link you copied in Part 2.2 — ideally actually on a phone, or at
least in a narrow browser window, since this is what every guest sees on
their own phone.

### Step 1 — Confirmá tu reserva
- Show the check-in/check-out/huéspedes/total summary at the top.
- Fill in name, phone, and email.
- Submit — this is "Fechas confirmadas" back in admin.

### Step 2 — Reglas de la casa
- Show the house rules list (configured in Settings → Reglas).
- Check the box, accept.

### Step 3 — Pago y garantía
- Show the bank transfer details (CBU/Alias with the **copy buttons**) for
  the confirmation payment, and the separate security deposit section below
  it.
- Point out **both show "Pendiente"** right now — nothing here auto-
  confirms a bank transfer; a human has to mark it received (next part).
- **Upload a payment receipt**: scroll to "Subir comprobante de pago" and
  either choose the image file you prepared or paste one (Ctrl+V after
  clicking into the box). It appears as a thumbnail right there — click it
  to open full-size.
- Show **"Actualizar estado de los pagos"** — this is what the guest taps
  after staff marks something received, to refresh their own view.

> "The guest doesn't have to pick which payment the receipt is for — they
> just upload whatever they have, and we match it up on our side."

### Step 4 — Confirmación
- Only reached once **both** the 30% payment and the deposit are marked
  received (next part) — mention that's coming up, then cut back to admin.

---

## Part 4 — Back in Admin: driving the reservation to "Confirmed"

1. Go back to the reservation detail page for your demo reservation.
2. Point out the new **Comprobantes de pago** card at the top — the receipt
   you just uploaded as the guest is right there as a thumbnail.
3. Click **Marcar pago del 30% como recibido** right from that card (the
   same button also lives further down in the checklist — either one
   works, this one's just closer to the evidence).
4. Click **Marcar depósito como recibido**.
5. Walk down the checklist below: Email inicial, Fechas confirmadas,
   Contrato aceptado — all show as done since you just did them as the
   guest.
6. Refresh the guest page (or tap "Actualizar estado de los pagos" there) —
   it's now on **Step 4: Confirmación**, and the reservation's status badge
   in admin should now read **Confirmada**.

> "Everything here is staff-driven on purpose — we're not plugging into an
> automatic payment gateway, we're just tracking a bank transfer someone on
> our team actually verified, with the receipt right there for reference."

7. Point out the other buttons that appear depending on state: **Reenviar
   email de confirmación** (resend the initial email), and — only once
   confirmed — **Reenviar email de confirmación final**. If you want to show
   a cancellation, do it on the demo reservation, not a real one:
   **Cancelar reserva** → note the **Reenviar email de cancelación** button
   that then appears.

---

## Part 5 — Admin: Notificaciones

1. Point at the **Notificaciones** link in the nav — note the red unread
   badge (it should show at least 1, from the receipt you just uploaded in
   Part 3).
2. Click into it. Show the list: each row has a type badge, the message,
   and — when relevant — a link straight to the reservation.
3. Find the "comprobante de pago" entry for your demo reservation and click
   **Marcar como leída**.

> "This is the one place that surfaces things needing attention without
> anyone having to go looking — right now it's two kinds of alert: a guest
> uploaded a receipt, or the Booking.com/Airbnb calendar shows a day
> blocked that we don't have a matching reservation for."

If there happens to be a real `CALENDAR_MISMATCH` notification in the list
already (from real production data), point it out here too — it's not
something worth manufacturing on purpose for the recording, but genuinely
useful to show if one's sitting there.

---

## Part 6 — Admin: Guests (the CRM)

1. Click **Huéspedes** in the nav.
2. Point out the **search box** (name, email, or phone).
3. Click into your demo guest — show their stay history and total stays
   count.

> "Every reservation with an email or phone builds up a guest record here —
> including Airbnb guests, who often only give us a phone number, never an
> email."

---

## Part 7 — Admin: Templates & Campaigns

1. **Plantillas**: show creating/editing a reusable email template.
2. **Campañas**: show picking a template and a filter (e.g. "stayed in the
   last N months"), the recipient count preview, and Enviar.

> "This is how we send things like a seasonal discount to past guests —
> filtered by when they last stayed, not a blast to everyone."

---

## Part 8 — Admin: Registro de actividad

1. Click **Registro de actividad**.
2. Show the filters: tipo de evento, huésped (name search), and date range
   (Desde/Hasta).

> "This is the audit trail — every email sent or failed, every status
> change, tied back to the reservation."

---

## Part 9 — Admin: Configuración

Walk the five tabs, briefly:

1. **Reglas y contenido** — the house rules text guests see in Step 2.
2. **Pagos** — payment instructions, confirmation payment % (or fixed
   amount), deposit amount, the final confirmation-step text.
3. **Alojamiento** — address, Google Maps link, and the **iCal URLs** for
   Booking.com/Airbnb.
4. **Comunicaciones** — the Airbnb chat message template, the three email
   templates (initial/final/cancellation), and the two WhatsApp reminder
   templates + how many days before/after they fire.
   - **Note for the video:** WhatsApp reminders send automatically every
     morning via a scheduled job — there's no "send now" button, so this
     tab is describe-only, not something to trigger live.
5. **Integraciones**:
   - **Sincronización de canales** — "Sincronizar ahora" checks the
     Booking.com/Airbnb iCal feeds against reservations already on file and
     raises a Notificación for any blocked day with nothing matching it. It
     no longer creates reservations by itself — that's the Chrome
     extension's job now (Part 11).
   - **Google Calendar** — if already connected, show "Sincronizar Google
     Calendar ahora" (pulls changes made directly in the calendar) and
     "Forzar sync de reservas al calendario" (pushes every reservation back
     out — useful if one's missing because it predates connecting the
     calendar). If not connected, show "Conectar Google Calendar" and the
     Google consent screen.

---

## Part 10 — Google Calendar

1. Switch to the actual Google Calendar (the shared one connected above).
2. Find the demo reservation's event — point out the guest name, dates.

> "Anyone with access to this calendar — even without an admin login — can
> see what's booked. This is what keeps double-bookings from happening."

---

## Part 11 — Chrome extension (Booking.com / Airbnb import)

Only film this against a real, live page you're logged into — don't
reconstruct it with screenshots pretending to be live.

### Booking.com
1. Open a real Booking.com extranet reservation page.
2. Click the floating **"Generar link" / send button** the extension
   injects.
3. Show the reservation appearing in the admin Reservas list.

### Airbnb
1. Open a real Airbnb hosting-messages thread.
2. If this thread was already imported before, point out the green
   **"✓ Ya cargada en La Brisa"** badge and that the button now reads
   **"Actualizar datos de la reserva"**.
3. Click it — show the toast distinguishing "¡Reserva creada!" (first time)
   vs. "Esta reserva ya estaba cargada — actualizamos los datos..." (a
   re-scan), and the pre-filled check-in message it copies to the
   clipboard / inserts into Airbnb's own chat box.

> "Airbnb never gives us the guest's email, so instead of an automatic
> email, we send them the check-in link right in the same Airbnb
> conversation — but a human always reviews it before hitting send on
> Airbnb's side, nothing goes out automatically. This is also what actually
> loads a reservation into the system now — the iCal feed you saw in
> Settings only checks whether something's missing, it doesn't create
> anything by itself anymore."

---

## Part 12 — Wrap-up: what happens with no one watching

Good closing beat — list what runs unattended, since the video so far has
been all manual clicks:

- Every 30 minutes, the **Booking.com/Airbnb iCal feeds are checked**
  against what's on file, and a notification goes out for any gap.
- **WhatsApp reminders** go out automatically every morning to guests with
  an upcoming reservation or an overdue deposit.
- **Google Calendar pulls and pushes** happen automatically too, alongside
  the manual "sync now" buttons.
- A guest uploading a receipt, at any hour, **raises a notification**
  immediately — no one has to go check.
- Every email send/failure and status change is logged in **Registro de
  actividad**, so nothing happens silently.

---

## Things I noticed while writing this — worth deciding before you record

- **No live "send WhatsApp reminder now" button exists.** If you want to
  actually show a WhatsApp message arriving in the video (not just describe
  it), that's a feature we'd need to add first — say the word if you want
  it for the recording.
- **The Chrome extension needs real source material** (an actual logged-in
  Booking.com or Airbnb tab) — there's no safe way to fake it convincingly,
  so Part 11 depends on you having that available when you record. (The
  screenshot-upload import that used to cover this in admin-web was removed
  — the Chrome extension replaced it for both channels.)
- **A real `CALENDAR_MISMATCH` notification can't be manufactured on
  demand** — it only appears when the Booking.com/Airbnb calendar actually
  shows a blocked day with nothing matching in our system. Part 5 says to
  show one only if it's already there; don't create a fake blocked day on a
  real channel just for the recording.
- **Google Calendar's full "Connect" flow is disruptive to redo** once
  already connected (disconnecting first affects the real shared calendar).
  Decide up front whether you're showing the live OAuth screen or just
  narrating over the already-connected state.
- **Cancelling a reservation on camera** should only ever be your throwaway
  demo reservation — I called that out above, just flagging it again since
  it's a one-way action in the current system (no "un-cancel" button).
- I didn't see a demo/sandbox mode anywhere in the app — every action in
  this script hits the real production database. That's fine for a one-off
  recording, but means your demo reservation, its uploaded receipt, and its
  guest record will show up in real lists/searches afterward unless you
  delete them once you're done.
