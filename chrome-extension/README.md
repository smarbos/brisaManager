# La Brisa — Booking.com Reservation Sync (Chrome extension)

Manifest V3 extension. When a staff member opens a Booking.com extranet
reservation page (reached via the link in Booking.com's "¡Nueva reserva!"
host notification email), this scrapes the reservation details on that page
and sends them to La Brisa's API with one click. It only ever acts on a page
the staff member is already logged into and viewing — no credentials are
stored or handled by the extension.

## Status: Phase 1 (inspection helper)

Booking.com's extranet markup is unknown to us (logged-in, JS-rendered admin
panel, no public docs, likely obfuscated class names that can differ by
reservation type). Real field extraction can't be written reliably without
seeing the actual rendered page, so this phase ships everything that
*doesn't* depend on Booking.com's DOM, plus a scanner to figure out the rest:

**Already fully built and usable as-is:**
- `manifest.json` — permissions, content script registration
- `background.js` — the actual `POST /reservations/import` call (with a 10s
  timeout, error handling, and the `Authorization: Bearer <token>` header),
  reached via `chrome.runtime.sendMessage` from the content script
- `options.html` / `options.js` — stores API base URL + token in
  `chrome.storage.local`; requests the minimal runtime host permission for
  just that one domain (via `chrome.permissions.request`) before saving, so
  the extension never needs a hardcoded or overly broad host permission
- `styles.css` + the floating buttons/toast in `content_script.js` — the
  "Enviar a La Brisa" button, the debug scan button, and success/error toasts

**Still a placeholder, waiting on real selectors:**
- `extractReservationFields()` in `content_script.js` — currently returns
  `null` for every field with all of them listed in `unverified_fields`, so
  clicking "Enviar a La Brisa" today sends a mostly-empty (but structurally
  correct) payload. This is intentional per the "don't silently send a
  blank" requirement — nothing here is silently wrong, it's just not filled
  in yet.

## How to load it

1. Go to `chrome://extensions`
2. Enable "Developer mode" (top right)
3. "Load unpacked" → select this `chrome-extension/` folder
4. Click the extension's icon in the toolbar → opens the options page →
   enter the API base URL and token, click "Guardar" (this will prompt you
   to grant permission for that one domain — accept it)

## How to run the Phase 1 scan (no DevTools needed)

1. Open a real Booking.com extranet reservation page — a URL like:
   `https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/booking.html?res_id=...&hotel_id=9586863`
2. Click the "🔍 Escanear (debug)" button (bottom right).
3. A box appears on the page with the scan results as text. Click inside it,
   press Ctrl+A (select all) then Ctrl+C (copy), and paste it wherever you're
   sending it — no browser console required.

(Advanced/optional: the same dump is also logged to the DevTools console —
F12 → Console tab — under `[La Brisa] Inspection dump ready`, and stored on
`window.__laBrisaInspection` if you'd rather grab it that way.)

### What the dump contains

- `matches`: for each known field (guest name, check-in, check-out, guests,
  price, status), every element whose *own* text matched a guessed label (in
  Spanish or English), plus several independent guesses at where the *value*
  lives nearby (next sibling, parent's next sibling, `dt`→`dd`, table row's
  next cell). Each guess includes a short selector path and an HTML preview.
- `allLabelValuePairs`: **every** label+value pair found under the label CSS
  classes confirmed real from prior captures, with no keyword guessing at
  all. Use this when a field in `matches` comes up empty — it already caught
  a real gap once (no Spanish guess matched "Total guests", but the field
  was right there in this list under its real Spanish text).

It also records `res_id` and `hotel_id` read directly from the URL (never
from the DOM, since those are unambiguous and already in the address bar),
and how many DOM elements were scanned in total, as a sanity check that the
scan actually ran against a fully-rendered page and not a half-loaded one.

## Phase 2 (once real selectors are known)

Only `extractReservationFields()` needs to change: replace the `null`
placeholders with real lookups (by label text + one of the confirmed
value-guess strategies, not hardcoded class names — Booking.com's classes
are auto-generated and can change on deploy). If a field genuinely can't be
found on a given page, leave it `null` and keep it in `unverified_fields`
rather than guessing — the button and payload already handle that case.

## API contract

```
POST {API_BASE_URL}/reservations/import
Authorization: Bearer <token>
Content-Type: application/json

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
```

`guest_email` is found by scanning the page for a `mailto:` link or
email-shaped text (preferring Booking.com's `@guest.booking.com` relay
address) — it's not tied to any label, since it wasn't part of the "Guest
name" field's own text even though it renders right next to it. When
present, the email is always stored on the reservation and used to link
(or create) a Guest record — that's just CRM bookkeeping, safe regardless of
whether other fields are still unverified. The actual confirmation email to
the guest, though, only sends once `unverified_fields` is empty *and* an
email is present — never on the strength of an unverified/placeholder
scrape, since that one is guest-facing.

This endpoint is implemented at `api/src/channel-import/` (distinct from the
existing `POST /reservation-import/parse-screenshot` screenshot-OCR
endpoint). It's protected two ways beyond the bearer token check:

- **`hotel_id` is pinned server-side** to the `BOOKING_HOTEL_ID` env var
  (`9586863` for La Brisa). A request for any other `hotel_id` — even with a
  valid token — is rejected with 403 and logged, since this system only ever
  operates one property.
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
  reservation page and clicking a button.
- No Airbnb support yet — Booking.com extranet only.
