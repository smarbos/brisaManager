# Design: Screenshot-Based Reservation Import

Status: Approved
Date: 2026-09-14

## Purpose

Booking.com's iCal export for this property doesn't include real reservation data — every VEVENT in the feed, block or booking alike, is a generic "CLOSED - Not available" entry with no guest name, dates-only precision aside, or contact info (confirmed by direct investigation: two independently-generated export URLs returned identical, non-matching data against the property's real bookings). Booking.com's confirmation email was checked too and found to carry no usable structured data. What does reliably carry the real reservation details is the Booking.com host app itself — a screenshot of a reservation's detail page shows the guest's name, check-in/check-out dates, pax count, and a unique reservation ID.

This project lets staff import a reservation by uploading (or pasting) a screenshot of that detail page. The screenshot is OCR'd, parsed into fields, and used to pre-fill the existing "New reservation" form — staff review and correct before saving, exactly as they already do for a fully manual entry. This is not full automation: it removes the retyping, not the human judgment.

Scoped to Booking.com only, and to the single-reservation detail-page screenshot only (not the multi-reservation list view) — see Scope below for why.

## Scope

- **Booking.com only.** Airbnb's host app has a different layout with no real examples to design or test against yet; add it as its own follow-up pass once real Airbnb screenshots are available.
- **Detail-page screenshot only, one reservation per image.** The list view shows multiple reservations per screenshot with no per-item unique ID and a more cramped layout — reliably grouping OCR text into the right reservation card is a meaningfully harder problem than parsing one self-contained detail page, for no real gain (staff can screenshot each reservation's own detail page just as easily, one at a time).
- **No price extraction.** Neither screenshot type shows a total amount. `totalAmount` keeps its existing default and staff enters the real amount manually, the same as they already do for channel-synced placeholder reservations.
- **No image storage.** The screenshot is processed in memory and discarded once fields are extracted — no new file-storage infrastructure (this app has none today). Only the resulting `Reservation` row, created through the normal form submission, persists.

## Data extracted

From the detail-page screenshot (see the two real examples this design was built against), via OCR text parsing:

| Field | Source line in the screenshot | Notes |
|---|---|---|
| Reservation ID | A bare run of 8-12 digits, on its own line, not matching the date or phone-number patterns | Used for dedup — see below. This is the anchor the other two fields below are found relative to, since it's the least ambiguous pattern to match. |
| Guest name | The non-empty text line immediately preceding the reservation-ID line | The guest's name appears twice in the screenshot (once in the top nav bar, once as the heading directly above the ID) — anchoring off the ID's position, rather than trying to distinguish "nav bar" from "heading" text some other way, picks the correct occurrence without needing positional/pixel information OCR text alone doesn't carry. |
| Check-in | Under the "Check-in" label: weekday + day + Spanish month abbreviation + year (e.g. "vie, 6 nov 2026") | Parsed with a Spanish weekday/month regex, converted to an ISO date. |
| Check-out | Same pattern under "Check-out" | |
| Pax count | The number preceding "adultos" (e.g. "3 adultos") | Children, if shown separately on some reservations, are out of scope for this pass — not present in either example. |

Anything not confidently matched comes back as `null` from the extraction endpoint — the frontend never guesses on the backend's behalf, and a `null` field is simply left for staff to fill in by hand.

## Backend

New module `api/src/reservation-import/`:

- `ReservationImportController` — `POST /reservation-import/parse-screenshot`, JWT-guarded (`JwtAuthGuard`, matching every other admin-facing route). Accepts one `multipart/form-data` file field, handled by `multer`'s in-memory storage engine (`memoryStorage()` — the buffer never touches disk).
- `ReservationImportService.extractFromScreenshot(buffer: Buffer): Promise<ExtractedReservationFields>` — runs OCR via `tesseract.js` (Spanish language data, `eng`+`spa` or `spa`-only trained data) against the buffer to get raw recognized text, then applies the parsing rules from the table above. Returns:
  ```typescript
  interface ExtractedReservationFields {
    guestName: string | null;
    checkIn: string | null;   // ISO date (YYYY-MM-DD)
    checkOut: string | null;  // ISO date (YYYY-MM-DD)
    paxCount: number | null;
    externalReference: string | null; // e.g. "booking-manual-5459856627"
  }
  ```
- The parsing step is a pure function separate from the OCR call itself (`parseExtractedText(rawText: string): ExtractedReservationFields`), so it can be unit-tested against canned OCR-output fixtures without invoking real OCR in the test suite.
- No new Prisma model, no new migration — this endpoint only returns extracted fields; the actual `Reservation` row is created exactly as it is today, through the existing `POST /reservations` (`ReservationsService.create()`), when staff submit the (pre-filled, staff-reviewed) form.

**Dedup:** the extracted `externalReference` (`booking-manual-<id>`) is namespaced distinctly from the iCal sync's own UID format (`<hash>@booking.com`) so the two import paths can never collide with each other, while both still rely on the existing `Reservation` `@@unique([source, externalReference])` constraint. Verified against the current code: `ReservationsService.create()` passes `externalReference` straight through to `prisma.reservation.create()` with no existing try/catch around a unique-constraint violation, so re-submitting the same imported `externalReference` today surfaces as an unhandled 500 from the API, which the form's existing generic catch block turns into "No se pudo guardar la reserva." That's the same (unfriendly, but non-crashing) behavior a duplicate manual entry already gets today — this feature doesn't change it, and improving it is out of scope here since it isn't specific to screenshot import.

## Frontend

`ReservationFormPage.tsx`'s "New reservation" view (not the edit view — this only makes sense for creating a reservation) gets:

- A file input labeled "Importar desde captura de Booking.com", plus a paste handler on the same drop zone (`onPaste`, reading `event.clipboardData.files`) so staff can paste a screenshot directly from their clipboard without saving it to disk first.
- On file selection (from either path), the image is POSTed to `/reservation-import/parse-screenshot`. While the request is in flight, the control shows a brief "Leyendo captura..." state.
- On success, each non-null field from the response overwrites the corresponding `form` state field; `null` fields are left untouched (so a field staff already typed is never clobbered by a blank result). `source` is also set to `'BOOKING'` unconditionally on a successful import, since this path only ever applies to Booking.com screenshots.
- On failure (network error, or a response where every field came back `null`), a small inline notice appears: "No pudimos leer los datos de la captura — completá el formulario manualmente." The form remains fully usable either way; this is a convenience layered on top of the existing manual flow, never a blocker.

## Error handling

- A corrupt or unreadable image, or one OCR can't extract any recognizable field from, results in every field being `null` — a normal (not error) response. The frontend's "couldn't read it" notice covers this case, not an HTTP error.
- An actual failure (OCR engine throws, file is not a valid image `multer` can read) returns a 400 from the controller; the frontend shows the same manual-fallback notice.
- The parsing function never throws on unexpected input shapes — a field it can't confidently match is `null`, not an exception.

## Testing

- **Backend:** unit tests for `parseExtractedText()` against canned OCR-output text fixtures built from the real screenshot content (including the exact Spanish weekday/month strings, the "N noches"/"N adultos" patterns, and edge cases: missing pax line, missing reservation ID, garbled/partial text). Unit tests for `ReservationImportService.extractFromScreenshot()` mocking the `tesseract.js` call so the OCR engine itself is never invoked in the test suite. An e2e test for the controller covering the auth-required case and one successful mocked-OCR path.
- **Frontend:** a test for the import control's merge-into-form behavior — a successful response with a mix of populated and `null` fields updates only the populated ones and leaves user-typed values in the null ones untouched; a failed/empty response shows the fallback notice without disturbing the form.
- **Calibration note:** the parsing regexes in this spec are designed against the screenshot's visual layout, not against real `tesseract.js` output (which this design process had no way to generate). The implementation plan should expect a calibration step — running the real OCR engine against the actual example screenshots and adjusting the parsing patterns to match what it actually outputs, before the unit tests' fixtures are finalized.
