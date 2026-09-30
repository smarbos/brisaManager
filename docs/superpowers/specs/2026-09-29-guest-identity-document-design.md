# Design: Guest Identity Document, Privacy Notice & Data Retention

Status: Approved (design), pending spec review
Date: 2026-09-29
Supersedes: `2026-09-29-guest-identity-takeover-design.md` (its "fill blanks only" rule is folded into section 4 below)

## Purpose

Guests are identified today by email, or by phone for Airbnb guests. Both are weak identity keys: people change emails, Booking.com hands out per-reservation relay addresses, and one person can have several phones. This adds a required identity document (DNI or passport) at check-in and makes it the primary way a guest is recognized across stays. It also:

- counts a guest's previous stays correctly (completed, non-cancelled stays only);
- closes the guest-profile takeover hole from the 2026-09-29 security review (TODO.md section 10);
- adds the privacy notice and marketing consent that Ley 25.326 art. 6 requires at the point of collection. Collecting document numbers makes this unavoidable;
- stops keeping payment receipts forever.

## Decisions (all confirmed with the owner)

| Question | Decision |
|---|---|
| Identity key | **Document is the key.** Same type + country + number means the same person, regardless of email/phone. Email/phone matching remains only as a fallback for reservations that have no document yet (imports and staff-created before check-in). |
| Which stays count | **Completed and not cancelled:** check-out already passed, `status !== CANCELLED`. |
| Passports | **Issuing country is part of the key.** DNI is implicitly `AR`. |
| Admin use | Staff can **see** the document on guest and reservation pages, **enter/edit** it in the reservation form, and **search** guests by it. |
| Storage | **Encrypted + keyed hash.** The number is stored AES-256-GCM encrypted; matching and search use an HMAC. A DB dump or backup alone reveals no document numbers. |
| Guest-form takeover protection | **Link, fill blanks only** (from the superseded spec), applied to document matches. |
| Marketing | **Opt-in checkbox**, unchecked by default. Campaigns only reach guests who opted in; existing guests are excluded until they opt in. |
| Retention | **Receipts deleted after the stay** (details in section 6). **Documents and contact data kept** to recognize returning guests, until the guest asks for deletion. |

## 1. Data model

### New enum

```prisma
enum DocumentType {
  DNI
  PASAPORTE
}
```

### `Guest`

| Field | Type | Notes |
|---|---|---|
| `documentType` | `DocumentType?` | |
| `documentCountry` | `String?` | ISO 3166-1 alpha-2. Always `AR` for DNI. |
| `documentNumberEncrypted` | `String?` | See section 2. |
| `documentHash` | `String? @unique` | See section 2. The uniqueness guarantee that one document is one guest. |
| `marketingConsentAt` | `DateTime?` | Set when the guest ticks the opt-in. `null` means no consent. |

All nullable: existing guests and pre-check-in imports have no document.

**Removed:** `totalStays` and `lastStayAt`. They're computed on read (section 5), so no data is lost.

### `Reservation`

Same four document fields (`documentType`, `documentCountry`, `documentNumberEncrypted`, `documentHash`, no unique constraint). They record which document this reservation was checked in with, and they're what staff edit in the reservation form.

### `ReservationImage`

- `deletedAt DateTime?`: set by the retention job (section 6). The row is kept so staff see that a receipt existed.

### `GuestEventType`

- `CONTACT_INFO_NOT_APPLIED`: a submitted email/phone/name was deliberately not written. Either the guest form tried to overwrite a non-empty field on a matched profile, or the value already belongs to another guest.
- `DOCUMENT_CHANGED`: `oldValue`/`newValue` hold **masked** values only (`DNI ···678`), never full numbers. The event log isn't encrypted.

## 2. Document normalization and cryptography

New unit `api/src/guest-documents/` (pure functions plus one injectable service), used by every write path:

- **`normalizeDocument({ type, country, number })`**:
  - DNI: strip everything but digits, require 7–8 digits, force country `AR`.
  - PASAPORTE: uppercase, strip everything but `A–Z0–9`, require 5–15 characters. Country must be a valid ISO alpha-2 code (`/^[A-Z]{2}$/` and recognized by `Intl.DisplayNames(['es'], { type: 'region' })`).
  - Throws a validation error with a Spanish message on failure.
- **`hashDocument(normalized)`**: `HMAC-SHA256(DOCUMENT_HASH_KEY, "${type}|${country}|${number}")`, hex. Stable across formatting, since it runs after normalization.
- **`encryptDocumentNumber(number)` / `decryptDocumentNumber(stored)`**:
  - AES-256-GCM with `DOCUMENT_ENCRYPTION_KEY` and a random 12-byte IV per value.
  - Stored as `v1:<iv b64>:<tag b64>:<ciphertext b64>`. The `v1` prefix leaves room for key rotation later.
- **`maskDocument(normalized)`**: `DNI ···678` / `PASAPORTE (ES) ···321`.

**Keys:** `DOCUMENT_ENCRYPTION_KEY` and `DOCUMENT_HASH_KEY` are separate 32-byte keys, each given as 64 hex chars in `.env`.
- The API refuses to boot if either is missing or the wrong length.
- They are distinct so a leaked hash key can't decrypt, and vice versa.
- Losing `DOCUMENT_ENCRYPTION_KEY` makes every stored number permanently unreadable, so both must be kept in the password manager (see the TODO checklist).

**Exposure rules:**
- No public (`/public/*`) response ever contains a document number, hash or ciphertext. That includes the guest's own check-in page after submission.
- Staff endpoints return the decrypted number only on guest and reservation *detail* responses. List responses carry the masked form only.

## 3. Check-in form (guest-web, step 1)

Fields, in order:

1. Name, phone, email (unchanged).
2. **Tipo de documento**: select with `DNI` (default) and `Pasaporte`.
3. **País emisor**: only shown for Pasaporte. A searchable select of countries, names from `Intl.DisplayNames(['es'])`.
4. **Número de documento**.
5. **Marketing opt-in**, unchecked by default: "Quiero recibir novedades y promociones de La Brisa por email."
6. **Short privacy note** directly above the submit button: *"Usamos tus datos para gestionar tu reserva y registrar tu estadía. Tu número de documento se guarda cifrado."* A **"Cómo tratamos tus datos"** link toggles an inline expandable panel with the full notice below.

Document type, country (for passports) and number are **required**, both client-side and in `ConfirmDatesDto`. The API validates with `normalizeDocument` and returns a 400 with the Spanish message on failure.

### Full privacy notice (panel text)

> **Responsable:** Damian Mantuano, Formosa 259, depto L. Contacto: contacto@labrisa.com.ar.
>
> **Qué datos pedimos:** nombre, teléfono, email, tipo y número de documento y, si los enviás, comprobantes de pago.
>
> **Para qué:** gestionar tu reserva y el check-in, identificarte como huésped y reconocerte en futuras estadías, y comunicarnos con vos sobre tu estadía por email y WhatsApp. Solo si lo aceptás, para enviarte novedades y promociones.
>
> **Obligatorios:** nombre, teléfono, email y documento son necesarios para completar el check-in. Recibir promociones es opcional.
>
> **Con quién los compartimos:** proveedores que nos ayudan a operar: DigitalOcean (alojamiento de datos), Resend (emails), Twilio (WhatsApp) y Google (calendario de reservas, solo tu nombre). Algunos procesan datos fuera de Argentina. No vendemos tus datos.
>
> **Cómo los protegemos:** conexión cifrada (HTTPS), número de documento cifrado y acceso restringido al personal.
>
> **Cuánto tiempo:** los comprobantes de pago se eliminan al cerrar tu estadía. Tus datos de contacto y documento se conservan para reconocerte en futuras estadías, hasta que pidas su eliminación.
>
> **Tus derechos:** podés acceder, rectificar o suprimir tus datos escribiendo a contacto@labrisa.com.ar. El acceso es gratuito en intervalos no inferiores a seis meses, salvo interés legítimo (art. 14 inc. 3, Ley 25.326).
>
> La AGENCIA DE ACCESO A LA INFORMACIÓN PÚBLICA, en su carácter de Órgano de Control de la Ley N° 25.326, tiene la atribución de atender las denuncias y reclamos que interpongan quienes resulten afectados en sus derechos por incumplimiento de las normas vigentes en materia de protección de datos personales.

The text lives in one guest-web constant (`guest-web/src/confirmation/privacyNotice.ts`), next to the existing `propertyInfo.ts`, so legal review edits one file. Every claim above must stay true of the system (see "Keeping the notice true" below).

## 4. Identity resolution and linking

`GuestsService.syncFromReservation()` gains two inputs:
- `document?: NormalizedDocument`;
- `fillBlanksOnly?: boolean`, set only by the guest check-in form.

It also accepts `marketingConsent?: boolean`: when `true` and the guest has no `marketingConsentAt`, it's set. The flag is never cleared by a later form submission, since withdrawing consent is the unsubscribe link's job.

When a `document` is present, resolution runs in this order (`R` = the reservation's currently linked guest, `D` = the guest whose `documentHash` matches):

1. **`D` exists:** link the reservation to `D`.
   - With `fillBlanksOnly`: write only fields that are empty on `D`. Never overwrite `D`'s name, phone or email. Each differing submitted value → `CONTACT_INFO_NOT_APPLIED` (`oldValue` = stored, `newValue` = submitted, actor `"Huésped"`).
   - Without `fillBlanksOnly` (staff): overwrite, as today.
2. **No `D`, and `R` exists with no document:** set the document on `R`. `R` is the guest's own profile, so contact updates apply as today (`fillBlanksOnly` doesn't restrict this case).
3. **No `D`, and `R` exists with a different document:** this is a different person. Create a new guest with the document and relink the reservation.
4. **No `D`, no `R`:** create a new guest with the document.

When no `document` is present (imports, staff reservations without one): today's email → phone fallback, unchanged except for the rule below.

**Everywhere:** an email or phone that already belongs to a *different* guest is dropped from the write and logged as `CONTACT_INFO_NOT_APPLIED`. Today that case makes Prisma throw a unique-constraint error, which fails the whole sync silently.

**Left-behind profiles are kept, not merged or deleted.** For example, a guest created from a Booking.com relay email whose reservation moved to the document-matched guest in case 1. The old profile keeps its history and unsubscribe status and now shows 0 stays. Profile merging is out of scope.

**The reservation's own copy:** `PublicReservationsService.confirmDates()` also stores the encrypted document and hash on the `Reservation`, next to `guestName`/`guestPhone`/`guestEmail`. A `FIELD_CHANGED` reservation event records it with masked values.

**Staff edits** in the admin reservation form (`ReservationsService.update`) run the same resolution without `fillBlanksOnly`. Changing a reservation's document can move it to a different guest.

**Accepted residual risk:** someone who knows a stranger's DNI can have their stay linked to the stranger's profile. They can't read or change that profile, and the stay only counts once it has happened and wasn't cancelled. `CONTACT_INFO_NOT_APPLIED` events make such cases visible when the contact details differ.

## 5. Stay counting (computed, not cached)

A *completed stay* is a reservation with `status !== 'CANCELLED'` and `checkOut < now`.

- **Guest list and detail:** `totalStays` = count of the guest's completed stays; `lastStayAt` = the latest `checkOut` among them (or `null`). Computed in `GuestsService` with a filtered relation count and aggregate. The response shape is unchanged, so admin-web types stay the same.
- **Guest list ordering** (`lastStayAt desc`): sorted in the service after computing. The guest table is small (one property).
- **Campaign eligibility** (`findEligibleForCampaign`): base filter `unsubscribedAt: null, email: { not: null }, marketingConsentAt: { not: null }`.
  - `STAYED_WITHIN_MONTHS` → `reservations: { some: completedStay AND checkOut >= cutoff }`.
  - `NOT_STAYED_WITHIN_MONTHS` → `reservations: { none: completedStay AND checkOut >= cutoff }`. This keeps today's meaning, "no stay since cutoff, including never stayed".
- The per-sync stats recompute in `syncFromReservation()` is deleted.

## 6. Receipt retention

A daily scheduled job (`ReservationImagesRetentionService`, `@Cron` like the existing schedulers) deletes receipt files for reservations where either:
- `depositReturnedAt` is set **and** `checkOut < now`, or
- `checkOut` is more than **30 days** ago (the same window as guest-link expiry, `TOKEN_VALID_DAYS_AFTER_CHECKOUT`).

For each matching `ReservationImage` with `deletedAt: null`, it deletes the file (`FileStorageService.delete`) and sets `deletedAt`. Failures are per-file: logged, then the job continues.

- Staff list/detail responses include `deletedAt`. The admin gallery shows "Comprobante eliminado (política de retención)" instead of fetching the file.
- The file endpoints return 404 for deleted images.
- The guest-facing image list omits deleted images.

## 7. Admin app

- **Reservation form:** a "Documento" group with type / country (passport only) / number, all optional for staff. It's validated with the same rules as check-in. For an existing reservation, it shows the decrypted current value.
- **Reservation detail and guest detail:** full document, plus the marketing consent date or "Sin consentimiento".
- **Guest list:** a "Documento" column showing the masked value, and a search box that sends the full number (+ type/country) to `GET /guests?document=...`. The API hashes it and matches exactly.
- **Guest history:** labels for the new event types in `admin-web/src/lib/labels.ts`: `CONTACT_INFO_NOT_APPLIED: 'Dato de contacto no aplicado'`, `DOCUMENT_CHANGED: 'Documento modificado'`.
- **Campaigns:** the preview also shows how many otherwise-eligible guests are excluded for lack of consent.

## 8. Error handling

- Missing or malformed keys: the API fails at boot with a clear message.
- Invalid document on check-in or in the staff form: 400 with a Spanish message, shown inline by the form.
- A stored value that fails decryption (wrong key, corrupt data): the response carries `document: null` plus `documentUnreadable: true`. The UI shows "No se pudo leer el documento". An error is logged without the ciphertext.
- `syncFromReservation()` stays best-effort (fire-and-forget, logged). A race on the unique `documentHash` / `email` / `phone` between the pre-check and the write still throws and is logged, same as today.
- Retention job: per-file failure isolation (section 6).

## 9. Testing

**Unit (api):**
- `normalizeDocument`: dots/spaces/case; DNI 7–8 digits; passport character set and length; country validation; DNI forced to `AR`.
- Crypto: encrypt→decrypt round trip; ciphertext differs per call (random IV); the stored string never contains the plain number; hash identical across formatting variants and different across type/country.
- `syncFromReservation`, every case in section 4:
  - a stranger's DNI with `fillBlanksOnly` links but doesn't overwrite, and logs `CONTACT_INFO_NOT_APPLIED`;
  - an own profile gets the document attached;
  - a different document creates a new guest and relinks;
  - an email/phone owned by another guest is skipped, not thrown;
  - staff paths still overwrite;
  - marketing consent is set once and never cleared.
- Stay counting: cancelled, future and in-progress reservations don't count; `lastStayAt` uses completed stays only.
- Campaign eligibility: consent required; both month filters keep their meaning.
- Retention job: both timing rules, already-deleted rows skipped, per-file failure isolation.

**E2E (api):**
- A full check-in with a DNI. Then a second reservation, created with only a name, checks in with the same DNI and a different email. It links to the same guest, the first guest's name/phone/email are unchanged, and the guest shows 1 stay once the first stay's check-out has passed.
- No `/public/*` response body contains the document number, hash or ciphertext.
- Check-in without a document → 400.

**guest-web:** the document fields render with DNI as default; Pasaporte reveals the country select; submit is blocked without a document; the marketing checkbox is unchecked by default and its value is sent; the privacy panel opens and shows the notice.

**admin-web:** document fields in the reservation form; masked column and search in the guest list; deleted-receipt placeholder; new event labels.

## 10. Rollout

1. **Before deploying:** generate the two keys (`openssl rand -hex 32` each), add `DOCUMENT_ENCRYPTION_KEY` and `DOCUMENT_HASH_KEY` to the droplet's `.env`, and store both in the password manager. The API won't boot without them. See the TODO checklist.
2. **Migrations:** add the enum, the new columns and event types; add `marketingConsentAt` and `ReservationImage.deletedAt`; drop `Guest.totalStays` / `Guest.lastStayAt`.
3. **Day-one behavior change:** campaigns reach **nobody** until guests start opting in at check-in. Previously, everyone who hadn't unsubscribed was eligible.
4. **First retention run** deletes receipts of all reservations that already meet the rule (anything checked out more than 30 days ago). Staff should download any receipt they still need before deploying.
5. **Version bumps** (per CLAUDE.md): `api` and `admin-web` patch or minor. `guest-web` is identified by commit hash.

## Keeping the notice true

These notice claims depend on the system and must be revisited if it changes:
- the document number is encrypted (section 2);
- receipts are deleted after the stay (section 6);
- the list of providers (DigitalOcean, Resend, Twilio, Google);
- Google receives only the guest's name (`GoogleCalendarPushService` event summary);
- marketing only with consent (section 5).

## Out of scope

Tracked in TODO.md's "Personal-data protection" list:
- a self-service or staff tool for ARCO requests (access/rectification/deletion) — handled manually via contacto@labrisa.com.ar until then;
- guest profile merging;
- per-staff admin accounts and MFA;
- read-access audit logging;
- encrypting other personal fields;
- key rotation (the `v1:` prefix makes it possible later);
- documents for every person in the party (only the person filling in the form is collected).

## Open items

- **Postal address city/province:** the owner gave "Formosa 259, depto L". Confirm whether the notice should add the city and province, e.g. "Mar del Plata, Buenos Aires".
- **Legal review:** the notice text, and especially the AAIP legend (reproduced from memory), should be checked by a lawyer against the current official wording before going live.
- **AAIP registration:** registering the database with the Registro Nacional de Bases de Datos is an owner task, outside this codebase.
