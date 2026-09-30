# Design: Guest Profile Takeover via Check-in Form

Status: Superseded by `2026-09-29-guest-identity-document-design.md` (its "fill blanks only" rule lives on there, in section 4). Not to be implemented on its own.
Date: 2026-09-29

## Purpose

From the 2026-09-29 security review (TODO.md section 10, "Guest identity takeover by email"). The guest check-in form (`POST /public/reservations/:token/confirm-dates`) is gated only by the reservation's confirmation token. What the guest types there (name, phone, email) is synced onto a CRM `Guest` record by `GuestsService.syncFromReservation()`.

When the reservation has **no `guestId` yet**, the sync finds an existing `Guest` by the submitted email and upserts it, **overwriting that guest's `name` and `phone`**. This happens for reservations staff created manually with just a name; Booking.com/Airbnb imports always carry an email or phone and are linked at import. So anyone holding such a link can type another guest's email and:

- overwrite that guest's stored name and phone;
- attach their own stay to that guest, inflating `totalStays`/`lastStayAt`, which feed the campaign filters.

They can't read anything: all `Guest` data is staff-only. This is a data-integrity problem, not a data leak.

The same matching is also how returning guests are recognized automatically, so it can't simply be removed.

## Decision

**Link, fill blanks only.** Guest-submitted data still links the reservation to a matching existing `Guest`, so returning guests keep being recognized. But it may only fill fields that are empty on that guest. It never overwrites a stored name, phone or email. Every submitted value that wasn't applied is logged as a `GuestEvent` so staff can see it and fix it by hand.

Alternatives considered and rejected:

- **Never auto-link guest-submitted data.** Airtight, but returning guests would only be recognized after staff link them manually, and that needs a new merge UI.
- **Link now, hold overwrites for staff approval.** The most complete option, but it needs a pending-changes model and an approve/reject UI. That's too much for the actual risk.

## Scope

- **Only the guest check-in form is restricted.** Staff edits (`ReservationsService` create/update) and Chrome-extension imports (`ChannelImportService`) keep today's overwrite behavior. Those sources are authenticated and trusted.
- **Reservation already linked to a guest (`input.guestId` set):** the guest may still correct their own contact info, as today (TODO.md section 5, "Guest confirms/validates their own contact info"). That profile was assigned by staff or the import, so it's theirs.
- **Reservation fields are untouched by this change.** `Reservation.guestName`/`guestPhone`/`guestEmail` are still set from the form in `PublicReservationsService.confirmDates()`. They're per-reservation, and staff and the WhatsApp reminders read them.
- **Known residual risk, accepted:** a token holder can still attach their stay to someone else's `Guest` by typing that person's email. Stays can be padded, but profile data can't be changed, and the `CONTACT_INFO_NOT_APPLIED` event (below) makes each case visible to staff.

### Related pre-existing bug, fixed here too

`Guest.email` and `Guest.phone` are both `@unique`. Today, if a sync would write a value that already belongs to a *different* guest, Prisma throws a unique-constraint error. `syncFromReservation()` catches and logs it, and the **whole sync fails silently**: no link and no stats. Two ways to hit it:

- A guest types a new email plus a phone number another guest already has. The new `Guest` is created with that phone, and the create fails.
- A linked guest changes their email to one another guest already has.

The same rule applies to every source (staff, extension and guest form alike): **a phone or email that already belongs to another guest is skipped** rather than written. The rest of the sync goes ahead, and the skipped value is logged as `CONTACT_INFO_NOT_APPLIED`. This is safe for trusted sources too: it replaces a silent total failure with a partial success plus a visible event.

## Data model

One new enum value, no new tables:

```prisma
enum GuestEventType {
  NAME_CHANGED
  PHONE_CHANGED
  EMAIL_CHANGED
  UNSUBSCRIBED
  // A contact value submitted for this guest was deliberately not applied — either the
  // guest check-in form tried to overwrite a non-empty field on a matched profile, or the
  // value already belongs to a different guest. field/oldValue/newValue record which
  // field, what's stored, and what was submitted.
  CONTACT_INFO_NOT_APPLIED
}
```

Migration: `ALTER TYPE "GuestEventType" ADD VALUE 'CONTACT_INFO_NOT_APPLIED';`

The existing `GuestEvent` columns (`field`, `oldValue`, `newValue`, `detail`, `actor`) carry everything needed:

- `oldValue` is the stored value (`null` if the only reason was "belongs to another guest").
- `newValue` is the submitted value.
- `actor` is `"Huésped"` for the check-in form.

## Backend

### `SyncInput` (`api/src/guests/guests.service.ts`)

Add one optional flag:

```ts
// Set only by the guest check-in form (PublicReservationsService.confirmDates). When the
// reservation isn't linked to a guest yet and the submitted email/phone matches an existing
// one, this input may only fill that guest's empty fields — never overwrite them.
fillBlanksOnly?: boolean;
```

`PublicReservationsService.confirmDates()` passes `fillBlanksOnly: true`. No other caller changes.

### `syncFromReservation()` algorithm

Existing normalization is unchanged: email is trimmed and lowercased, phone and name are trimmed, and the sync returns early if there's neither email nor phone.

1. **Resolve the target guest** (unchanged logic):
   - `input.guestId` set → that guest (the **own-linked** path).
   - otherwise → look up by email if one was submitted, else by phone (the **matched** path, or **new** if nothing is found).
2. **Filter out values owned by someone else.** For each of `email` and `phone` in the input, if it's non-null and a `Guest` with a different id already holds it, drop it from the write. Record a `CONTACT_INFO_NOT_APPLIED` event for it once the target guest id is known.
3. **Build the write:**
   - **Own-linked**, or **matched without `fillBlanksOnly`:** overwrite with every remaining value, as today.
   - **Matched with `fillBlanksOnly`:**
     - `name`: never written, because every `Guest` has a non-empty name.
     - `phone`/`email`: written only where the stored value is `null`.
     - Each remaining submitted value that differs from a non-empty stored value → `CONTACT_INFO_NOT_APPLIED` (`oldValue` = stored, `newValue` = submitted).
   - **New:** create with the remaining values. If email was dropped in step 2 and phone is missing or also dropped, nothing identifies the guest, so create nothing. Log a warning and return, the same way the existing "no email and no phone" early return does.
4. **Link, recompute stats, record events** (unchanged): set `reservation.guestId`, then recompute `totalStays`/`lastStayAt`. `recordFieldChanges()` diffs only the values actually written, so `NAME_CHANGED`/`PHONE_CHANGED`/`EMAIL_CHANGED` never claim a change that didn't happen.

Replace the current `upsert` calls with an explicit `findUnique`, then `update` or `create`. The branching above needs to know which path it's on before writing, and step 1 already does the lookup.

A small private helper keeps the ownership check in one place:

```ts
private async isHeldByAnotherGuest(field: 'email' | 'phone', value: string, guestId: string | null): Promise<boolean>
```

### `CONTACT_INFO_NOT_APPLIED` detail text

Spanish, matching the existing event details:

- Overwrite blocked: `Teléfono no aplicado (formulario del huésped): guardado "X", enviado "Y"`
- Belongs to another guest: `Email no aplicado: "Y" ya pertenece a otro huésped`

## Frontend (admin-web)

`admin-web/src/lib/labels.ts`: add `CONTACT_INFO_NOT_APPLIED: 'Dato de contacto no aplicado'` to `GUEST_EVENT_TYPE_LABELS`. `GuestEventsTab` and `GuestDetailPage` already render `detail`, `field`, `oldValue`/`newValue` and `actor` for every event type, so no other UI change is needed.

## Error handling

`syncFromReservation()` stays best-effort. It's called fire-and-forget (`void`) and its existing try/catch still logs unexpected errors. The known unique-constraint failures are now prevented before the write, not caught after it.

There's a race: two concurrent syncs can claim the same email or phone between the ownership check and the write. That still throws a unique-constraint error, which the existing catch logs, exactly as today. Syncs are low-volume, so a transaction isn't warranted.

## Testing

Unit (`api/src/guests/guests.service.spec.ts`):

- Matched with `fillBlanksOnly`: an existing guest with name and phone set and a submission with a different name and phone → guest not updated, reservation linked, stats recomputed, two `CONTACT_INFO_NOT_APPLIED` events (`oldValue` = stored, `newValue` = submitted, `actor` = `"Huésped"`), and no `*_CHANGED` events.
- Matched with `fillBlanksOnly`: an existing guest with no phone → phone filled, and a `PHONE_CHANGED` event recorded.
- Own-linked (`guestId` set) with `fillBlanksOnly` → still overwrites, as today.
- Matched without `fillBlanksOnly` (staff or extension) → still overwrites, as today.
- A new guest whose submitted phone belongs to another guest → created without the phone, linked, and `CONTACT_INFO_NOT_APPLIED` recorded on the new guest.
- An own-linked guest changing email to one another guest holds → email skipped, other fields still updated, and no thrown error.
- A new guest whose email and phone both belong to other guests → no guest created and the reservation not linked.

Unit (`api/src/public-reservations/public-reservations.service.spec.ts`): `confirmDates` passes `fillBlanksOnly: true`.

E2E (`api/test/guests.e2e-spec.ts`): create guest A through a reservation with an email and phone. Then, on a second reservation created with only a name, submit confirm-dates with A's email, a different name and a different phone. Assert that:

- A's `name` and `phone` are unchanged;
- the second reservation's `guestId` is A;
- A has a `CONTACT_INFO_NOT_APPLIED` event.

admin-web: extend the existing label test, if there is one, to cover the new label.

## Versioning

Per CLAUDE.md, bump the patch version of `api` and `admin-web` in the implementing commit.
