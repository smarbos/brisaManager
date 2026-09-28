# Guest check-in redesign — design

## Goal

Re-skin guest-web's check-in flow (`ConfirmationPage.tsx`) to match a
user-provided mockup's visual language, restructure step 4 into a tabbed
view (Pago / Cómo llegar / La zona / Sensores), and give the ambient sensor
readings a clear "Ideal" / "Alto" status chip so a guest can tell at a
glance whether a reading is good or bad without needing to understand
units or calibration.

## Background

The user shared a claude.ai artifact: a static HTML/CSS/JS mockup of a
redesigned 4-step guest check-in wizard for "La Brisa." It uses its own
color palette (linen/sea/driftwood), Fraunces + Work Sans fonts, and adds
a step-4 tabbed confirmation view with four tabs, one of them a sensor
dashboard using a min/threshold gauge and an "Ideal" status chip.

The real guest-web app already implements the same 4-step flow
(`ConfirmationPage.tsx`) with its own Tailwind v4 `@theme` token system
(Playfair Display + Inter, a similar teal/khaki palette — `--color-accent:
#2c4a45` is close to the mockup's `--sea-deep: #2C4E52`) and already has
working step 1–3 functionality (contact form, house rules acceptance, bank
transfer details with copy buttons, receipt image upload) that closely
mirrors the mockup's steps 1–3. Step 4 today is a flat payment summary with
no tabs; ambient sensor data is a separate always-rendered
`AmbientStatus.tsx` component shown below the wizard card whenever
`debugMode || (isFullyConfirmed && isDuringStay)`.

Separately (already implemented, unrelated to this spec): the firmware,
backend DTOs, and Prisma schema already carry a `threshold` field on every
`AmbientDeviceReading` — sound/CO/smoke report their calibrated alert
threshold; temperature/humidity report `null`. Only guest-web's own
`api/ambient.ts` type hasn't been updated to include it yet.

## Scope

**In scope:**
- Visual token updates (colors, fonts) across guest-web to match the
  mockup's palette as closely as reasonable within the existing Tailwind
  `@theme` system.
- Steps 1–3: re-skin only (via token changes) — no functional changes.
  Receipt upload stays exactly as it works today.
- Step 4: replace the flat summary with a tabbed view: Pago, Cómo llegar,
  La zona, Sensores (last one conditional — see below).
- New hardcoded property content (address, Maps link, WhatsApp contacts,
  nearby places) for the two brand-new tabs.
- Sensor "Ideal"/"Alto" status chip + gauge bar for sound/CO/smoke,
  reusing the already-present `threshold` field.
- A small file-structure cleanup: extract the bank-details markup (used
  in both step 3 and the new Pago tab) into a shared component.

**Explicitly out of scope:**
- Any backend or firmware change (the `threshold` plumbing already
  exists end-to-end; this spec only consumes it from guest-web).
- Admin-editable address/contacts/zone content — hardcoded in a config
  file per the user's explicit choice.
- Any "ideal range" concept for temperature/humidity — per the user's
  explicit choice, those sensors show their bare value with no status
  chip, permanently (not a placeholder to fill in later).
- Dark mode. The mockup defines `prefers-color-scheme: dark` token
  overrides, but guest-web has no dark-mode support today and no toggle
  anywhere in the app; adding it is unrelated new scope. This redesign
  ships light-mode only, using the mockup's light-mode token values.
- Admin-web is untouched — this is a guest-web-only redesign.

## Visual design system

All changes live in `guest-web/src/index.css`'s `@theme` block and
`guest-web/index.html`'s font `<link>`. Existing `ui/` components
(`Button`, `Badge`, `Alert`, `FormField`, `Input`, `Textarea`, `Lightbox`)
consume these tokens already and need no changes themselves.

Font swap: `Playfair Display` → `Fraunces` (heading), `Inter` → `Work
Sans` (body), matching the mockup exactly. `index.html`'s Google Fonts
`<link>` updates to load both new families.

Color token updates (`--color-*` in `@theme`), taking the mockup's exact
light-mode hex values:

| Token | Old value | New value | Mockup source |
|---|---|---|---|
| `--color-bg` | `#ece4d6` | `#F1EDE3` | `--linen` |
| `--color-surface` | `#ffffff` | `#FFFFFF` | `--card` (unchanged) |
| `--color-border` | `#e0d5bf` | `#DCD5C3` | `--line` |
| `--color-text` | `#2b3b38` | `#1C2B30` | `--ink` |
| `--color-text-muted` | `#6b6152` | `#4B5D62` | `--ink-soft` |
| `--color-heading` | `#1f3330` | `#1C2B30` | `--ink` (mockup uses one ink color for both; font-family alone distinguishes headings) |
| `--color-accent` | `#2c4a45` | `#2C4E52` | `--sea-deep` |
| `--color-accent-hover` | `#21403b` | `#214448` | Darkened `--sea-deep` by the same proportion the old accent→accent-hover step used (mockup has no separate hover token — its buttons use `opacity:.92` on hover instead, but this codebase's `Button` component needs a solid hover color) |
| `--color-accent-fg` | `#ffffff` | `#FFFFFF` | unchanged |
| `--color-danger` | `#c0392b` | `#c0392b` | unchanged (mockup has no danger/error state to source from) |
| `--color-danger-bg` | `#fdecea` | `#fdecea` | unchanged |
| `--color-success` | `#2f6b4f` | `#3F6B44` | `--ok-fg` |
| `--color-success-bg` | `#dceedf` | `#E7EFE3` | `--ok-bg` |
| `--color-warning` | `#734519` | `#93672A` | `--pending-fg` |
| `--color-warning-bg` | `#f0dec0` | `#F6EBD9` | `--pending-bg` |

Two new tokens, needed for the sensor gauge and the rules/places icons
(mockup concepts with no existing equivalent):

| New token | Value | Mockup source | Used by |
|---|---|---|---|
| `--color-zone` | `#D6E6E3` | `--zone` | Gauge bar's highlighted "good zone" |
| `--color-driftwood` | `#B0824F` | `--driftwood` | Rule-list bullet icons, "La zona" place icons |

## File structure

**New files:**
- `guest-web/src/confirmation/step4/Step4Confirmation.tsx` — tab bar
  (`role="tablist"`, arrow-key navigation per the mockup's accessible
  pattern) + active-panel switch. Receives `reservation` and `token` as
  props. Tab icons reuse the mockup's own inline SVG path data verbatim
  (the `card`/`pin`/`compass`/`thermometer`-style icons already drawn for
  each of the 4 tabs in the mockup's markup) — no new icons designed.
- `guest-web/src/confirmation/step4/PagoTab.tsx` — payment summary (moved
  from `ConfirmationPage.tsx`'s current step-4 block) + a collapsible
  "Datos de la cuenta para transferir" section using `BankDetails`.
- `guest-web/src/confirmation/step4/ComoLlegarTab.tsx` — address card,
  Maps link, copy-address button, WhatsApp contacts list. Reads from
  `propertyInfo.ts`.
- `guest-web/src/confirmation/step4/LaZonaTab.tsx` — nearby places grouped
  by category. Reads from `propertyInfo.ts`.
- `guest-web/src/confirmation/step4/SensoresTab.tsx` — replaces
  `AmbientStatus.tsx`'s content: sensor cards with gauge + Ideal/Alto chip
  (sound/CO/smoke) or bare value (temperature/humidity). Fetches via the
  existing `getAmbientReadings(token)`.
- `guest-web/src/confirmation/propertyInfo.ts` — hardcoded exported
  constants: property address, Google Maps URL, WhatsApp contacts
  (name+phone pairs), and zone places (grouped by category, each with a
  name/description, using the same category icon keys — `wave`, `anchor`,
  `fork`, `bag`, `bus` — and their SVG path data as the mockup's `ICONS`
  object). Plain data, no component logic. **Initial content is the
  mockup's own `CONFIG` values verbatim** (address "Formosa 259, Depto L",
  the Maps URL, the Johanna/Marta contacts, and the zone groups/places) —
  this is the property's real information as already given in the
  mockup, not placeholder example text to be filled in later.
- `guest-web/src/confirmation/BankDetails.tsx` — the CBU/alias/titular/
  account-number/bank-name rows with copy buttons, extracted from step
  3's current inline JSX so step 3's card and the new Pago tab's
  accordion share one implementation. Owns its own copy-status state
  internally (not lifted to a parent). Props: `accountHolder: string`,
  `cuil: string`, `accountNumber: string`, `cbu: string`, `alias: string`,
  `bankName: string` — mapping directly from `GuestReservation.bankAccountHolder`,
  `.bankCuil`, `.bankAccountNumber`, `.bankCbu`, `.bankAlias`, `.bankName`.

**Modified files:**
- `guest-web/src/index.css` — token updates above.
- `guest-web/index.html` — font `<link>` swap.
- `guest-web/src/confirmation/ConfirmationPage.tsx` — steps 1–3 unchanged
  functionally (token-driven reskin only); step 3's bank-details block
  now renders `<BankDetails ... />` instead of inline JSX, and the
  `CopyButton` component plus `copyStatus`/`handleCopy` state/logic are
  deleted from this file entirely (they move into `BankDetails.tsx`,
  which becomes self-contained); step 4's block is replaced with
  `<Step4Confirmation reservation={reservation} token={token!}
  showAmbient={showAmbient} />`; `AmbientStatus` import and its
  standalone rendering below `PageShell`'s children are removed
  (superseded by `SensoresTab`, see Behavior changes below).
- `guest-web/src/api/ambient.ts` — add `threshold: number | null` to
  `AmbientDeviceReadingEntry`, matching the backend's existing shape and
  admin-web's already-updated copy of this same type.
- `guest-web/src/confirmation/AmbientStatus.tsx` — deleted; its logic
  moves into `SensoresTab.tsx`.

## Sensor status logic (`SensoresTab.tsx`)

For each reading:
- `threshold == null` (temperature, humidity, or any future sensor with
  no calibration concept): render the sensor name and bare value only,
  no chip, no gauge. This is permanent behavior, not a gap to fill later.
- `threshold != null` (sound, CO, smoke): render a gauge bar and a status
  chip.
  - Chip: `level < threshold` → `<Badge tone="success">Ideal</Badge>`;
    `level >= threshold` → `<Badge tone="warning">Alto</Badge>`. No
    sensor-name-specific logic — this is purely a function of `level` vs
    `threshold`.
  - Gauge: a horizontal bar from `0` to `threshold * 2` (the same
    multiplier the firmware's emergency-buzzer tier already uses for
    smoke/CO — applied here uniformly to sound too, purely as a display
    scale, introducing no new "emergency" concept in the UI). The
    `0 → threshold` span is highlighted using `--color-zone` (the "good
    zone"); a dot marks the current `level`'s position, clamped to 100%
    if `level > threshold * 2`.

## Behavior changes

**Debug-mode ambient preview scope (confirmed with the user):** today,
`ConfirmationPage.tsx` renders `AmbientStatus` below the wizard card on
*any* step when `debugMode` is true, independent of `isDuringStay`. After
this change, ambient data is only reachable via the Sensores tab, which
only exists inside step 4. Since step 4 is only reached once both
payments are marked received (a condition debug mode does not bypass),
the practical effect is: debug mode still bypasses the *stay-date window*
check, but a tester now needs a reservation with both payments already
marked received (an admin-panel edit) to reach step 4 and see the tab,
rather than being able to preview sensor data from step 1. This is an
accepted, intentional narrowing, not an oversight.

`showAmbient`'s formula in `ConfirmationPage.tsx` is unchanged (`debugMode
|| (isFullyConfirmed && isDuringStay)`) — it's passed into
`Step4Confirmation` as a prop and used only to decide whether the
Sensores tab exists at all.

## Testing

- `guest-web/src/confirmation/step4/*.test.tsx` — one test file per new
  tab component, following `AmbientStatus.test.tsx`'s existing pattern
  (render with mock reservation/props data, assert key content and
  interactions — e.g. `PagoTab` shows the right amounts, `ComoLlegarTab`'s
  copy button works, `SensoresTab` shows "Ideal" vs "Alto" chips for
  readings above/below threshold and no chip for temperature/humidity).
- `guest-web/src/confirmation/BankDetails.test.tsx` — copy-button
  behavior, extracted from whatever step-3 test coverage exists for it
  today.
- `ConfirmationPage.test.tsx` — update existing step-4 assertions that
  expect the flat summary to instead expect the tab bar with Pago as the
  default active tab; existing step 1–3 tests need no behavioral changes
  since those steps are visual-only changes.
- No backend or firmware tests are affected — nothing outside guest-web
  changes.
