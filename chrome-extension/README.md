# La Brisa — Reservation Sync (Chrome extension)

Manifest V3 extension with two independent content scripts:

- **Booking.com** (`content_script.js`) — scrapes a Booking.com extranet
  reservation page (reached via the link in Booking.com's "¡Nueva reserva!"
  host notification email) and sends it to La Brisa's API with one click.
  The API then emails the guest their check-in confirmation link directly.
- **Airbnb** (`content_script_airbnb.js`) — on an Airbnb hosting message
  thread, extracts the guest name/dates/pax from the page, creates (or
  finds) the matching reservation, and prepares a message containing the
  guest's check-in confirmation link for you to paste into that same chat.
  Airbnb never exposes the guest's real email on this page, so the chat
  message — not an email — is the primary way an Airbnb guest gets the link.

Both only ever act on a page a staff member is already logged into and
viewing — no credentials are stored or handled by the extension.

## Status

**Booking.com: Phase 2 (real extraction).** Selectors were confirmed
against two real captured reservation pages (English and Spanish locale) —
see the file-header comment in `content_script.js` for exactly what's
confirmed vs. still a known gap (e.g. `status` is never scrapeable from this
page). The "🔍 Escanear (debug)" button remains in place for the next
reservation type that doesn't fit (multi-room, cancelled, etc.).

**Airbnb: Phase 1-real (unverified by default).** `content_script_airbnb.js`
was written against one real screenshot plus a partial HTML dump — never a
live page — so every scraped field is always listed in `unverified_fields`
regardless of whether extraction happened to guess right, until a real
capture confirms the selectors. That caution already paid off once: the
first version's guest-name guess (any `h1`/`h2` with text) matched the
"Mensajes" nav heading instead of the real conversation header, and its
compose-box selector (`div[contenteditable="true"]`) never matched Airbnb's
real box at all — it uses `contenteditable="plaintext-only"` — so the
generated message silently landed in some other editable element on the
page (the "Tus notas" panel) instead of the chat. Both are fixed now:
`extractGuestName()` requires a comma in the heading text (every real
conversation header is "GuestName, HostName"; page-chrome headings never
have one), and `findComposeBox()` looks for the confirmed real
`[data-testid="messaging-composebar"]` / `#message_input` first. It still
ships its own "🔍 Escanear (debug)" button for whatever's confirmed wrong
next (see "How to run the Airbnb scan" below).

**Already fully built and shared by both:**
- `manifest.json` — permissions, content script registration for both sites
- `background.js` — the actual `POST /reservations/import` and
  `GET /reservations/import/status` calls (10s timeout, error handling,
  `Authorization: Bearer <token>` header), channel-agnostic — reached via
  `chrome.runtime.sendMessage` from either content script
- `options.html` / `options.js` — stores API base URL + token in
  `chrome.storage.local`; requests the minimal runtime host permission for
  just that one domain (via `chrome.permissions.request`) before saving, so
  the extension never needs a hardcoded or overly broad host permission
- `styles.css` + the floating buttons/toast/debug panel — shared by both
  content scripts under the same `la-brisa-*` classnames

## How to load it

1. Go to `chrome://extensions`
2. Enable "Developer mode" (top right)
3. "Load unpacked" → select this `chrome-extension/` folder
4. Click the extension's icon in the toolbar → opens the options page →
   enter the API base URL and token, click "Guardar" (this will prompt you
   to grant permission for that one domain — accept it)

## How to run the Booking.com scan (no DevTools needed)

1. Open a real Booking.com extranet reservation page — a URL like:
   `https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/booking.html?res_id=...&hotel_id=9586863`
2. Click the "🔍 Escanear (debug)" button (bottom right).
3. A box appears on the page with the scan results as text. Click inside it,
   press Ctrl+A (select all) then Ctrl+C (copy), and paste it wherever you're
   sending it — no browser console required.

(Advanced/optional: the same dump is also logged to the DevTools console —
F12 → Console tab — under `[La Brisa] Inspection dump ready`, and stored on
`window.__laBrisaInspection` if you'd rather grab it that way.)

### What the Booking.com dump contains

- `matches`: for each known field (guest name, check-in, check-out, guests,
  price, status), every element whose *own* text matched a guessed label (in
  Spanish or English), plus several independent guesses at where the *value*
  lives nearby (next sibling, parent's next sibling, `dt`→`dd`, table row's
  next cell). Each guess includes a short selector path and an HTML preview.
- `allLabelValuePairs`: **every** label+value pair found under the label CSS
  classes confirmed real from prior captures, with no keyword guessing at
  all. Use this when a field in `matches` comes up empty.

It also records `res_id` and `hotel_id` read directly from the URL (never
from the DOM), and how many DOM elements were scanned in total.

## How to run the Airbnb scan

1. Open an Airbnb hosting message thread — a URL like:
   `https://www.airbnb.com.ar/hosting/messages/1000000484`
2. Click the "🔍 Escanear (debug)" button (bottom right). It first clicks
   "Mostrar reserva" and "Administrá la reserva" open on your behalf (safe —
   these only reveal information, they never submit or send anything), then
   scans.
3. Same copy-the-textbox flow as Booking.com's scan above.

`content_script_airbnb.js` also runs a passive, read-only check on page load
(`GET /reservations/import/status`) — if this thread is already loaded, a
green "✓ Ya cargada en La Brisa" badge appears top-right and the main button
relabels to "Actualizar datos de la reserva". Clicking it either way still
runs the same extraction + `POST /reservations/import`; the only difference
is what the backend does with an already-existing, non-cancelled match — see
"Re-importing an already-loaded reservation" under API contract below.

The dump includes every `h1`/`h2`/`h3` heading on the page, every short text
node mentioning "huésped(es)", candidate values found near "Check-in"/
"Check-out" labels (next sibling, parent's next sibling, parent's own text),
the payment-info block's raw text, any "Número de teléfono de ..." row found,
and any short all-caps alphanumeric strings that might be an Airbnb
reservation confirmation code (none has been confirmed present on this page
yet — the thread id is used as the dedupe key instead). Pasting a couple of
real dumps back is exactly how `content_script.js`'s real selectors were
confirmed for Booking.com, and is the next step to move Airbnb out of
"Phase 1-real".

## API contract

```
POST {API_BASE_URL}/reservations/import
Authorization: Bearer <token>
Content-Type: application/json

// Booking.com
{
  "source": "booking.com",
  "hotel_id": "9586863",
  "res_id": "5000000607",
  "guest_name": "...",
  "guest_email": "znoemi.737138@guest.booking.com",
  "check_in": "2026-11-20",
  "check_out": "2026-11-23",
  "guests": 2,
  "total_price": "...",
  "currency": "...",
  "status": "confirmed",
  "unverified_fields": ["total_price"]
}

// Airbnb — hotel_id is omitted (not applicable), res_id is the messages
// thread id, guest_email is always null (never exposed on this page).
// guest_phone, total_price, and currency are all confirmed real but live
// behind collapsed disclosure rows ("Mostrar reserva" / "Administrá la
// reserva") that content_script_airbnb.js clicks open before extracting.
{
  "source": "airbnb",
  "res_id": "1000000484",
  "guest_name": "María Laura",
  "guest_email": null,
  "guest_phone": "+591 75278095",
  "check_in": "2026-10-27",
  "check_out": "2026-10-31",
  "guests": 3,
  "total_price": "$ 270.400,00",
  "currency": "ARS",
  "status": null,
  "unverified_fields": ["guest_name", "guest_phone", "guests", "check_in", "check_out", "total_price", "currency", "status"]
}
```

Response body (both sources):

```json
{
  "id": "...",
  "created": true,
  "guestName": "...",
  "checkIn": "...",
  "checkOut": "...",
  "status": "PENDING",
  "confirmationUrl": "https://checkin.labrisa.com.ar/r/...",
  "message": "¡Hola María Laura! Para completar el check-in, por favor completá estos pasos rápidos: https://checkin.labrisa.com.ar/r/..."
}
```

`message` is only populated for `source: "airbnb"` — it's the
Settings-configurable "Mensaje de check-in de Airbnb" template, rendered
server-side with the guest's name and confirmation link already filled in.
`content_script_airbnb.js` copies it to the clipboard and makes a best-effort
attempt to type it directly into Airbnb's message compose box; either way,
nothing is ever sent automatically — you review and click Airbnb's own send
button yourself.

For Booking.com, `guest_email` is found by scanning the page for a
`mailto:` link or email-shaped text (preferring Booking.com's
`@guest.booking.com` relay address) — it's not tied to any label. When
present, the email is always stored on the reservation and used to link (or
create) a Guest record. The actual confirmation email to the guest sends
whenever an email is present, independent of `unverified_fields` — see
`ChannelImportService.import()`'s own comment for why (status is *always*
unverified from Booking.com's page, which made an "only when fully
verified" gate permanently unreachable).

### Re-importing an already-loaded reservation

Sending the same `source` + `res_id` again — whether the operator clicks the
button twice by habit, or deliberately re-runs it because the guest changed
dates/pax on Airbnb after the first import — does **not** create a
duplicate. The existing reservation is updated instead, but only with
whatever this scrape actually found a non-null value for: `guest_name`,
`guest_phone`, `check_in`, `check_out`, `guests`, and `total_price`
(+`currency`) each overwrite independently, and a field this scrape came
back empty on (including `guest_email`, which Airbnb never provides) is left
exactly as it was — so a staff correction never gets silently clobbered by a
stale or partial rescan. The response's `created` field distinguishes the
two cases (`true` for a brand-new reservation, `false` for an update to an
existing one), and `content_script_airbnb.js` shows a different success
toast for each.

```
GET {API_BASE_URL}/reservations/import/status?source=airbnb&res_id=1000000484
Authorization: Bearer <token>
```

```json
// No non-cancelled reservation on file for this source+res_id
{ "exists": false }

// A match was found
{
  "exists": true,
  "guestName": "María Laura",
  "checkIn": "2026-10-27T00:00:00.000Z",
  "checkOut": "2026-10-31T00:00:00.000Z",
  "status": "PENDING"
}
```

This endpoint is implemented at `api/src/channel-import/` (distinct from the
existing `POST /reservation-import/parse-screenshot` screenshot-OCR
endpoint). It's protected two ways beyond the bearer token check:

- **`hotel_id` is pinned server-side** to the `BOOKING_HOTEL_ID` env var
  (`9586863` for La Brisa) — only for `source: "booking.com"`; Airbnb has no
  equivalent identifier in this flow. A Booking.com request for any other
  `hotel_id` — even with a valid token — is rejected with 403 and logged.
- **Rate limited** to 10 requests/minute per IP (`@nestjs/throttler`), scoped
  to just this endpoint. The check runs *before* the token check specifically
  so that repeated wrong-token guesses also count against the limit, rather
  than an attacker being able to brute-force the token at unlimited speed.

To test the extension end-to-end, set these two vars in the repo's root
`.env` (see `.env.example`) and use the same `EXTENSION_API_KEY` value as the
"Token de acceso" in the extension's options page:

```
EXTENSION_API_KEY=<openssl rand -hex 24>
BOOKING_HOTEL_ID=9586863
```

## Non-goals (by design)

- No automatic login or session handling — a human is always already logged in.
- No polling or background execution — purely triggered by opening a
  reservation/message page and clicking a button.
- No message is ever sent automatically on Airbnb — the extension only
  pre-fills the compose box (best-effort) and always also copies to the
  clipboard as a guaranteed fallback; a human always reviews and clicks
  Airbnb's own send button.
