# Guest Identity Document Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the guest's identity document the primary guest key, close the guest-profile takeover hole, add the Ley 25.326 privacy notice + marketing opt-in, compute stay counts on read, and delete receipts after the stay.

**Architecture:** A pure `api/src/guest-documents/` unit (normalize / hash / encrypt / mask) plus a `DocumentCryptoService` that reads the keys and refuses to boot without them. `GuestsService.syncFromReservation()` gains document-first resolution with "fill blanks only" for the guest form. Stays are computed from reservations. A daily cron deletes receipt files.

**Tech Stack:** NestJS 11, Prisma 6 / Postgres 16, Node `crypto` (AES-256-GCM, HMAC-SHA256), React 19 + Vite + Vitest (admin-web, guest-web).

**Spec:** `docs/superpowers/specs/2026-09-29-guest-identity-document-design.md`

## Global Constraints

- `DOCUMENT_ENCRYPTION_KEY`, `DOCUMENT_HASH_KEY`: 64 hex chars each, distinct; API fails at boot otherwise.
- Ciphertext format `v1:<iv b64>:<tag b64>:<ciphertext b64>`, 12-byte random IV.
- Hash: hex `HMAC-SHA256(DOCUMENT_HASH_KEY, "${type}|${country}|${number}")` over the normalized document.
- Mask: `DNI ···678` / `PASAPORTE (ES) ···321`.
- DNI: digits only, 7–8, country forced `AR`. Passport: `A–Z0–9`, 5–15, ISO alpha-2 country.
- No `/public/*` response contains a document number, hash or ciphertext.
- Staff list responses: masked only. Staff detail responses: decrypted (`document: null, documentUnreadable: true` on failure).
- Completed stay = `status !== 'CANCELLED'` and `checkOut < now`.
- Version bumps: `api`, `admin-web` (patch/minor). guest-web: none.

## Review Focus

1. Staff `GET /reservations` / `GET /reservations/:id` / `GET /guests/:id` (which includes reservations) leaking `documentNumberEncrypted`/`documentHash` raw — every staff response goes through one serializer.
2. `ReservationsService.update` spreading `...dto` into Prisma — document fields must be stripped and handled separately.
3. Email/phone owned by another guest during sync → skipped + `CONTACT_INFO_NOT_APPLIED`, never a thrown unique-constraint error.
4. Retention job removing a file but failing the DB update (or vice versa) → per-file try/catch; a missing file still marks the row deleted.
5. Guest form re-submission (already `datesConfirmedAt`) must not change identity.

---

### Task 1: Schema + migration
- [ ] `DocumentType` enum, Guest/Reservation document fields, `Guest.marketingConsentAt`, `ReservationImage.deletedAt`, `GuestEventType` += `CONTACT_INFO_NOT_APPLIED`, `DOCUMENT_CHANGED`; drop `Guest.totalStays`/`lastStayAt`.
- [ ] Hand-written migration `20261001220000_guest_identity_document`, applied with `prisma migrate deploy`.

### Task 2: `guest-documents` unit (TDD)
- [ ] `normalizeDocument`, `hashDocument`, `encryptDocumentNumber`, `decryptDocumentNumber`, `maskDocument`, `parseDocumentKeys`.
- [ ] `DocumentCryptoService` (global module) validating keys in its constructor → boot failure.
- [ ] `.env.example` + local `.env` dev keys.

### Task 3: Identity resolution in `syncFromReservation` (TDD)
- [ ] Cases 1–4 of spec §4, `fillBlanksOnly`, `marketingConsent`, foreign email/phone skipped, `DOCUMENT_CHANGED` masked events.
- [ ] Remove the stats recompute.

### Task 4: Stay counting + campaign eligibility (TDD)
- [ ] `findAll`/`findOne` computed `totalStays`/`lastStayAt`; `?document=` search; masked/decrypted document; consent fields.
- [ ] `findEligibleForCampaign` consent + relation filters; preview's `excludedForConsent`.

### Task 5: Check-in (`confirmDates`) + staff reservation writes (TDD)
- [ ] `ConfirmDatesDto` document + marketing fields; 400 on invalid; reservation copy + masked `FIELD_CHANGED`.
- [ ] Create/update DTO optional document group; staff serializer for reservation list/detail.

### Task 6: Receipt retention (TDD)
- [ ] `ReservationImagesRetentionService` daily cron; 404 for deleted; guest list omits deleted.

### Task 7: guest-web step 1
- [ ] Document type/country/number, marketing opt-in, privacy note + panel (`privacyNotice.ts`).

### Task 8: admin-web
- [ ] Reservation form document group; detail + guest detail document & consent; guest list column + search; deleted-receipt placeholder; event labels; campaign excluded count.

### Task 9: E2E, docs, versions
- [ ] E2E per spec §9; TODO.md updates; version bumps.
