# WhatsApp Check-in Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send the guest check-in link over WhatsApp (Meta-approved template) automatically and on demand, move the two daily reminders to approved templates, and accept foreign phone numbers.

**Architecture:** A new `whatsapp-templates.ts` builds each message (template SID from env, numbered variables, freeform fallback text). `WhatsappService.sendTemplate` sends it via Twilio's Content API, falling back to freeform text when no SID is configured. `ReservationsService.sendInitialWhatsapp` mirrors `sendInitialEmail` (timestamp column + reservation events) and is triggered from manual creation, channel import, and a new staff endpoint used by an admin button.

**Tech Stack:** NestJS 11, Prisma (PostgreSQL), Twilio Node SDK 6 (`contentSid`/`contentVariables`), `libphonenumber-js`, Jest + Supertest (api), React + Vitest + Testing Library (admin-web).

**Spec:** `docs/superpowers/specs/2026-09-30-whatsapp-checkin-link-design.md`

## Global Constraints

- Template SIDs: `checkin_link` = `HX75515c3d86147b823a36c766588c45da`, `reservation_reminder` = `HX70607aae1fe5be825d36018e26ff9095`, `deposit_reminder` = `HX1e26678753855e9df9cd58783b4ad771`.
- Env var names: `TWILIO_TEMPLATE_CHECKIN_LINK`, `TWILIO_TEMPLATE_RESERVATION_REMINDER`, `TWILIO_TEMPLATE_DEPOSIT_REMINDER`.
- Template variables are string-keyed and 1-based: `checkin_link` and `reservation_reminder` = `{1: guestName, 2: checkIn, 3: checkOut, 4: confirmationToken}`; `deposit_reminder` = `{1: guestName, 2: checkIn, 3: confirmationToken}`. Dates are `dd/mm/yyyy` in UTC (existing `formatDateOnly`).
- WhatsApp never blocks anything and never throws to callers: every send path resolves to a boolean.
- A foreign number must never be rewritten into an Argentine one.
- Per `CLAUDE.md`: every commit that touches `api/` bumps `api/package.json` `version` (patch); every commit that touches `admin-web/` bumps `admin-web/package.json` `version` (patch). Current: api `0.0.6`, admin-web `0.1.4`.
- Work on a branch in the **main checkout** (not a git worktree): the dev Docker containers bind-mount `./api` and `./admin-web` from this directory, and every test command below runs inside them.
- Staff-facing copy is Spanish (Argentina, voseo), matching the existing admin UI.

## Review Focus

1. **E2E tests sending real WhatsApp messages.** `test/reservations.e2e-spec.ts` creates a reservation with `guestPhone` against the real `AppModule`; with real Twilio credentials in `.env` it would message a stranger. Expected: no e2e test ever reaches Twilio — pinned in Task 4 (override `WhatsappService`).
2. **Channel-import e2e stub missing the new method.** `test/channel-import.e2e-spec.ts` replaces `ReservationsService` with `{ sendInitialEmail }` only; calling `sendInitialWhatsapp` on it throws and fails every import with a phone. Expected: imports still succeed — pinned in Task 5.
3. **Imported reservations with placeholder data.** A channel import with no scraped name/dates stores "Huésped de Booking.com (pendiente de completar)" and today's date; a WhatsApp saying "Tu estadía del 30/09 al 01/10" would be wrong. Expected: the import auto-send only fires when `guest_name`, `check_in` and `check_out` were all scraped — pinned in Task 5.
4. **Phones with invisible direction marks.** Airbnb-scraped phones can arrive as `‪+591 75278095‬` (U+202A/U+202C around them). Expected: still recognized as a foreign number and sent — pinned in Task 1.
5. **Fire-and-forget rejection.** `channel-import` calls `void this.reservationsService.sendInitialWhatsapp(...)`; if it rejected (e.g. the event insert fails) Node would log an unhandled rejection. Expected: `sendInitialWhatsapp` itself never rejects — pinned in Task 4.

---

### Task 1: International phone normalization

**Files:**
- Modify: `api/src/whatsapp/phone-normalizer.ts`
- Modify: `api/src/whatsapp/whatsapp.service.ts` (import rename only)
- Test: `api/src/whatsapp/phone-normalizer.spec.ts`
- Modify: `api/package.json` (version `0.0.6` → `0.0.7`)

**Interfaces:**
- Produces: `normalizePhoneForWhatsapp(raw: string): string | null` — returns `whatsapp:+<E.164>` or `null`. Replaces `normalizeArgentinePhoneForWhatsapp` (only caller: `whatsapp.service.ts`).

- [ ] **Step 1: Create the branch**

```bash
cd /home/smarbos/dev/brisaManager
git checkout -b whatsapp-checkin-link
```

- [ ] **Step 2: Update the tests**

In `api/src/whatsapp/phone-normalizer.spec.ts`:
1. Replace every `normalizeArgentinePhoneForWhatsapp` with `normalizePhoneForWhatsapp` (import line, `describe` name, all calls):
   `sed -i 's/normalizeArgentinePhoneForWhatsapp/normalizePhoneForWhatsapp/g' api/src/whatsapp/phone-normalizer.spec.ts`
2. Replace the last two tests (`rejects an explicit non-Argentine country code rather than guessing` and `rejects another explicit non-Argentine country code`) with:

```ts
  it('formats an explicit foreign number as E.164 instead of rewriting it as Argentine', () => {
    expect(normalizePhoneForWhatsapp('+52 55 1234 5678')).toBe('whatsapp:+525512345678'); // Mexico
    expect(normalizePhoneForWhatsapp('+57 300 1234567')).toBe('whatsapp:+573001234567'); // Colombia
    expect(normalizePhoneForWhatsapp('+1 201 555 0123')).toBe('whatsapp:+12015550123'); // US
    expect(normalizePhoneForWhatsapp('+34 612 34 56 78')).toBe('whatsapp:+34612345678'); // Spain
  });

  it('recognizes a foreign number wrapped in invisible direction marks (as scraped from Airbnb)', () => {
    expect(normalizePhoneForWhatsapp('‪+591 75278095‬')).toBe('whatsapp:+59175278095'); // Bolivia
  });

  it('returns null for an explicit foreign number that is not a valid number', () => {
    expect(normalizePhoneForWhatsapp('+52 123')).toBeNull();
  });

  it('still applies the Argentine rules to an explicit +54 number', () => {
    expect(normalizePhoneForWhatsapp('+54 11 15 2233-4455')).toBe('whatsapp:+5491122334455');
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `docker compose exec api npx jest src/whatsapp/phone-normalizer.spec.ts`
Expected: FAIL — `normalizePhoneForWhatsapp` is not exported.

- [ ] **Step 4: Implement**

Replace the whole of `api/src/whatsapp/phone-normalizer.ts` with:

```ts
import { parsePhoneNumberFromString } from 'libphonenumber-js';

// Returns the `whatsapp:+<E.164>` address Twilio expects, or null if the input can't be
// turned into one. Argentine numbers (no country code, or +54) get the Argentina-specific
// rules below; any other explicit country code is validated as-is with libphonenumber.
export function normalizePhoneForWhatsapp(raw: string): string | null {
  // Keep only digits and "+": also drops invisible Unicode direction marks that wrap
  // phones scraped from Airbnb's page, which would otherwise hide the leading "+".
  const cleaned = raw.replace(/[^\d+]/g, '');
  const hasPlus = cleaned.startsWith('+');
  const digits = cleaned.replace(/\D/g, '');

  if (digits.length === 0) {
    return null;
  }

  // Never guess a country code when the guest gave one explicitly: a foreign number is
  // validated in its own country's format, never rewritten into a plausible Argentine one
  // (which would send a guest's reservation details to an unrelated stranger).
  if (hasPlus && !digits.startsWith('54')) {
    const parsed = parsePhoneNumberFromString(`+${digits}`);
    return parsed?.isValid() ? `whatsapp:${parsed.number}` : null;
  }

  return normalizeArgentineDigits(digits, hasPlus);
}

// Argentine mobile numbers need a `9` inserted right after the `54` country code for
// WhatsApp addressing specifically — this is not how anyone writes or dials the number
// locally, and getting it wrong is a silent failure (the message just never arrives).
// See 2026-09-15-twilio-whatsapp-integration-design.md's "Argentina phone number
// normalization" section.
function normalizeArgentineDigits(input: string, hasPlus: boolean): string | null {
  let digits = input;

  // Strip a leading trunk 0, used when dialing locally without a country code
  // (e.g. "011 2233-4455" for a Buenos Aires-area number).
  if (!hasPlus && digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  // Assume Argentina when no country code is present.
  if (!digits.startsWith('54')) {
    digits = `54${digits}`;
  }

  // Strip an internal old-style "15" mobile prefix, which appears right after the area
  // code in locally-dialed numbers (e.g. "011 15 2233-4455") and must not appear in the
  // WhatsApp-addressable form.
  const afterCountryCode = digits.slice(2);
  const withoutNineIfPresent = afterCountryCode.startsWith('9') ? afterCountryCode.slice(1) : afterCountryCode;
  const fifteenIndex = withoutNineIfPresent.indexOf('15');
  // Only strip "15" when it appears early (area codes here run 2-4 digits), to avoid
  // accidentally eating "15" if it happens to appear later inside a local number.
  const withoutFifteen =
    fifteenIndex >= 0 && fifteenIndex <= 4
      ? withoutNineIfPresent.slice(0, fifteenIndex) + withoutNineIfPresent.slice(fifteenIndex + 2)
      : withoutNineIfPresent;

  const result = `549${withoutFifteen}`;

  // A real Argentine WhatsApp number is 54 + 9 + 10 digits = 13 digits total.
  if (result.length !== 13) {
    return null;
  }

  return `whatsapp:+${result}`;
}
```

In `api/src/whatsapp/whatsapp.service.ts`, change the import and the one call:

```ts
import { normalizePhoneForWhatsapp } from './phone-normalizer';
```
```ts
    const to = normalizePhoneForWhatsapp(rawPhone);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `docker compose exec api npx jest src/whatsapp`
Expected: PASS (all normalizer, service and scheduler specs).

- [ ] **Step 6: Bump version and commit**

Set `"version": "0.0.7"` in `api/package.json`.

```bash
git add api/src/whatsapp/phone-normalizer.ts api/src/whatsapp/phone-normalizer.spec.ts api/src/whatsapp/whatsapp.service.ts api/package.json
git commit -m "WhatsApp: accept foreign phone numbers instead of rejecting them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Template messages and `WhatsappService.sendTemplate`

**Files:**
- Create: `api/src/whatsapp/whatsapp-templates.ts`
- Test: `api/src/whatsapp/whatsapp-templates.spec.ts`
- Modify: `api/src/whatsapp/whatsapp.service.ts`
- Test: `api/src/whatsapp/whatsapp.service.spec.ts`
- Modify: `.env.example`
- Modify: `api/package.json` (version → `0.0.8`)

**Interfaces:**
- Consumes: `normalizePhoneForWhatsapp` (Task 1).
- Produces:
  - `interface TemplateMessage { templateSid: string | undefined; variables: Record<string, string>; fallbackBody: string }`
  - `formatDateOnly(date: Date): string` (`dd/mm/yyyy`, UTC — moved here from the scheduler)
  - `checkinLinkMessage(r: Pick<Reservation, 'guestName' | 'checkIn' | 'checkOut' | 'confirmationToken'>): TemplateMessage`
  - `reservationReminderMessage(r: Pick<Reservation, 'guestName' | 'checkIn' | 'checkOut' | 'confirmationToken'>): TemplateMessage`
  - `depositReminderMessage(r: Pick<Reservation, 'guestName' | 'checkIn' | 'confirmationToken'>): TemplateMessage`
  - `WhatsappService.sendTemplate(rawPhone: string, message: TemplateMessage): Promise<boolean>` — the spec's `(phone, sid, variables, fallback)` parameters, grouped into one object.

- [ ] **Step 1: Write the template-builder tests**

Create `api/src/whatsapp/whatsapp-templates.spec.ts`:

```ts
import { checkinLinkMessage, depositReminderMessage, reservationReminderMessage } from './whatsapp-templates';

describe('whatsapp templates', () => {
  const reservation = {
    guestName: 'María',
    checkIn: new Date('2026-12-12T00:00:00Z'),
    checkOut: new Date('2026-12-15T00:00:00Z'),
    confirmationToken: 'tok-123',
  };
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.GUEST_WEB_ORIGIN = 'https://reservas.example';
    process.env.TWILIO_TEMPLATE_CHECKIN_LINK = 'HXcheckin';
    process.env.TWILIO_TEMPLATE_RESERVATION_REMINDER = 'HXreminder';
    process.env.TWILIO_TEMPLATE_DEPOSIT_REMINDER = 'HXdeposit';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('builds the check-in link message with numbered variables and the token last', () => {
    expect(checkinLinkMessage(reservation)).toEqual({
      templateSid: 'HXcheckin',
      variables: { '1': 'María', '2': '12/12/2026', '3': '15/12/2026', '4': 'tok-123' },
      fallbackBody: expect.stringContaining('https://reservas.example/r/tok-123'),
    });
  });

  it('builds the reservation reminder with the same variable layout', () => {
    expect(reservationReminderMessage(reservation)).toEqual({
      templateSid: 'HXreminder',
      variables: { '1': 'María', '2': '12/12/2026', '3': '15/12/2026', '4': 'tok-123' },
      fallbackBody: expect.stringContaining('https://reservas.example/r/tok-123'),
    });
  });

  it('builds the deposit reminder with the token as variable 3', () => {
    expect(depositReminderMessage(reservation)).toEqual({
      templateSid: 'HXdeposit',
      variables: { '1': 'María', '2': '12/12/2026', '3': 'tok-123' },
      fallbackBody: expect.stringContaining('https://reservas.example/r/tok-123'),
    });
  });

  it('leaves templateSid undefined when its env var is unset or empty', () => {
    delete process.env.TWILIO_TEMPLATE_CHECKIN_LINK;
    process.env.TWILIO_TEMPLATE_DEPOSIT_REMINDER = '';

    expect(checkinLinkMessage(reservation).templateSid).toBeUndefined();
    expect(depositReminderMessage(reservation).templateSid).toBeUndefined();
  });

  it('includes the guest name and dates in the fallback text', () => {
    expect(checkinLinkMessage(reservation).fallbackBody).toBe(
      'Hola María, ¡gracias por reservar en La Brisa de Mar del Plata! Tu estadía del 12/12/2026 al 15/12/2026 ya está registrada. Para completar el check-in, entrá acá: https://reservas.example/r/tok-123',
    );
  });
});
```

- [ ] **Step 2: Add `sendTemplate` tests**

Append inside the `describe('WhatsappService', ...)` block of `api/src/whatsapp/whatsapp.service.spec.ts`:

```ts
  describe('sendTemplate', () => {
    const message = {
      templateSid: 'HX123',
      variables: { '1': 'María', '2': 'tok-1' },
      fallbackBody: 'Hola María, entrá acá: https://x/r/tok-1',
    };

    it('sends the approved template with stringified variables and no body', async () => {
      createMock.mockResolvedValue({ sid: 'SM123' });

      const result = await service.sendTemplate('+5491122334455', message);

      expect(result).toBe(true);
      expect(createMock).toHaveBeenCalledWith({
        from: 'whatsapp:+14155238886',
        to: 'whatsapp:+5491122334455',
        contentSid: 'HX123',
        contentVariables: JSON.stringify({ '1': 'María', '2': 'tok-1' }),
      });
    });

    it('falls back to the freeform body when no template SID is configured', async () => {
      createMock.mockResolvedValue({ sid: 'SM123' });

      const result = await service.sendTemplate('+5491122334455', { ...message, templateSid: undefined });

      expect(result).toBe(true);
      expect(createMock).toHaveBeenCalledWith({
        from: 'whatsapp:+14155238886',
        to: 'whatsapp:+5491122334455',
        body: 'Hola María, entrá acá: https://x/r/tok-1',
      });
    });

    it('returns false when the phone cannot be normalized', async () => {
      const result = await service.sendTemplate('not a phone number', message);

      expect(result).toBe(false);
      expect(createMock).not.toHaveBeenCalled();
    });

    it('returns false when Twilio rejects the template send', async () => {
      createMock.mockRejectedValue(new Error('Content SID not found'));

      const result = await service.sendTemplate('+5491122334455', message);

      expect(result).toBe(false);
    });
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `docker compose exec api npx jest src/whatsapp/whatsapp-templates.spec.ts src/whatsapp/whatsapp.service.spec.ts`
Expected: FAIL — cannot find module `./whatsapp-templates`; `service.sendTemplate is not a function`.

- [ ] **Step 4: Implement the template builders**

Create `api/src/whatsapp/whatsapp-templates.ts`:

```ts
import { Reservation } from '@prisma/client';

// One WhatsApp message, ready for WhatsappService.sendTemplate(): the Meta-approved
// template to send (Twilio Content SID, from env) with its numbered variables, plus the
// equivalent freeform text sent instead when no SID is configured (local dev, Twilio
// Sandbox). The approved templates' wording lives in Twilio — see
// docs/superpowers/specs/2026-09-30-whatsapp-checkin-link-design.md.
export interface TemplateMessage {
  templateSid: string | undefined;
  variables: Record<string, string>;
  fallbackBody: string;
}

export function formatDateOnly(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC' }).format(date);
}

// Read at call time (not module load) so a changed .env applies on restart without code
// changes, and tests can set it per case. An empty value counts as unset.
function templateSid(envVar: string): string | undefined {
  return process.env[envVar] || undefined;
}

// Only used in fallback text: the approved templates carry the guest link as a URL button
// with the domain fixed inside the template, so only the token is a variable there.
function guestLink(token: string): string {
  return `${process.env.GUEST_WEB_ORIGIN}/r/${token}`;
}

type StayReservation = Pick<Reservation, 'guestName' | 'checkIn' | 'checkOut' | 'confirmationToken'>;

// Template `checkin_link`.
export function checkinLinkMessage(reservation: StayReservation): TemplateMessage {
  const checkIn = formatDateOnly(reservation.checkIn);
  const checkOut = formatDateOnly(reservation.checkOut);
  return {
    templateSid: templateSid('TWILIO_TEMPLATE_CHECKIN_LINK'),
    variables: { '1': reservation.guestName, '2': checkIn, '3': checkOut, '4': reservation.confirmationToken },
    fallbackBody:
      `Hola ${reservation.guestName}, ¡gracias por reservar en La Brisa de Mar del Plata! ` +
      `Tu estadía del ${checkIn} al ${checkOut} ya está registrada. ` +
      `Para completar el check-in, entrá acá: ${guestLink(reservation.confirmationToken)}`,
  };
}

// Template `reservation_reminder`.
export function reservationReminderMessage(reservation: StayReservation): TemplateMessage {
  const checkIn = formatDateOnly(reservation.checkIn);
  const checkOut = formatDateOnly(reservation.checkOut);
  return {
    templateSid: templateSid('TWILIO_TEMPLATE_RESERVATION_REMINDER'),
    variables: { '1': reservation.guestName, '2': checkIn, '3': checkOut, '4': reservation.confirmationToken },
    fallbackBody:
      `Hola ${reservation.guestName}! Te recordamos tu reserva en La Brisa de Mar del Plata ` +
      `del ${checkIn} al ${checkOut}. En el link de tu reserva tenés la dirección y cómo llegar: ` +
      guestLink(reservation.confirmationToken),
  };
}

// Template `deposit_reminder`. Links to the guest page's payment step rather than carrying
// Settings.paymentInstructions: those are multi-line bank details, and Meta doesn't allow
// newlines inside template variables.
export function depositReminderMessage(
  reservation: Pick<Reservation, 'guestName' | 'checkIn' | 'confirmationToken'>,
): TemplateMessage {
  const checkIn = formatDateOnly(reservation.checkIn);
  return {
    templateSid: templateSid('TWILIO_TEMPLATE_DEPOSIT_REMINDER'),
    variables: { '1': reservation.guestName, '2': checkIn, '3': reservation.confirmationToken },
    fallbackBody:
      `Hola ${reservation.guestName}, todavía no registramos el pago de tu reserva del ${checkIn}. ` +
      `Encontrás los datos para transferir acá: ${guestLink(reservation.confirmationToken)}`,
  };
}
```

- [ ] **Step 5: Implement `sendTemplate`**

In `api/src/whatsapp/whatsapp.service.ts`, add the import:

```ts
import { TemplateMessage } from './whatsapp-templates';
```

and replace the existing `sendMessage` method (comment included) with:

```ts
  // Never throws: every caller gets a plain boolean, matching this feature's "log it
  // silently, never block anything else" failure-handling decision (see the design spec).
  // Freeform text only delivers within 24h of the guest's last message to us — anything
  // business-initiated goes through sendTemplate() instead.
  async sendMessage(rawPhone: string, body: string): Promise<boolean> {
    return this.send(rawPhone, { body });
  }

  // Sends a Meta-approved template (Twilio Content API). Without a configured template SID,
  // sends the message's equivalent freeform text instead, which is what works on the Twilio
  // Sandbox and in local dev.
  async sendTemplate(rawPhone: string, message: TemplateMessage): Promise<boolean> {
    if (!message.templateSid) {
      return this.sendMessage(rawPhone, message.fallbackBody);
    }
    return this.send(rawPhone, {
      contentSid: message.templateSid,
      contentVariables: JSON.stringify(message.variables),
    });
  }

  private async send(
    rawPhone: string,
    content: { body: string } | { contentSid: string; contentVariables: string },
  ): Promise<boolean> {
    const to = normalizePhoneForWhatsapp(rawPhone);
    if (!to) {
      this.logger.warn(`Could not normalize phone number for WhatsApp: ${rawPhone}`);
      return false;
    }

    const client = this.getClient();
    if (!client) {
      return false;
    }

    try {
      await client.messages.create({ from: this.from, to, ...content });
      return true;
    } catch (error) {
      this.logger.error(`Failed to send WhatsApp message to ${to}: ${(error as Error).message}`);
      return false;
    }
  }
```

- [ ] **Step 6: Document the env vars**

In `.env.example`, replace the Twilio block's `TWILIO_WHATSAPP_FROM` comment and line with:

```
# The Sandbox number while testing (each recipient must first text the Sandbox's join
# code to this number); in production, the approved WhatsApp Business sender number.
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
# Meta-approved message templates (Twilio Content SIDs, Content Template Builder). Leave a
# value empty to send that message as freeform text instead — only delivers on the Sandbox
# or within 24h of the guest's last message.
TWILIO_TEMPLATE_CHECKIN_LINK=
TWILIO_TEMPLATE_RESERVATION_REMINDER=
TWILIO_TEMPLATE_DEPOSIT_REMINDER=
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `docker compose exec api npx jest src/whatsapp`
Expected: PASS.

- [ ] **Step 8: Bump version and commit**

Set `"version": "0.0.8"` in `api/package.json`.

```bash
git add api/src/whatsapp/whatsapp-templates.ts api/src/whatsapp/whatsapp-templates.spec.ts api/src/whatsapp/whatsapp.service.ts api/src/whatsapp/whatsapp.service.spec.ts .env.example api/package.json
git commit -m "WhatsApp: send Meta-approved templates via Twilio's Content API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Reminders use templates; drop the Settings text fields

**Files:**
- Modify: `api/src/whatsapp/whatsapp-reminder.scheduler.ts`
- Test: `api/src/whatsapp/whatsapp-reminder.scheduler.spec.ts`
- Modify: `api/prisma/schema.prisma` (Settings model, lines ~127-128)
- Create: `api/prisma/migrations/20260930120000_remove_whatsapp_text_templates/migration.sql`
- Modify: `api/src/settings/settings.service.ts`, `api/src/settings/dto/update-settings.dto.ts`
- Test: `api/src/settings/settings.service.spec.ts`, `api/test/settings.e2e-spec.ts`
- Modify: `api/package.json` (version → `0.0.9`)

**Interfaces:**
- Consumes: `WhatsappService.sendTemplate`, `reservationReminderMessage`, `depositReminderMessage` (Task 2).
- Produces: `Settings` no longer has `reservationReminderWhatsappTemplate` / `depositReminderWhatsappTemplate` (Task 6 removes them from admin-web).

- [ ] **Step 1: Rewrite the scheduler tests for templates**

In `api/src/whatsapp/whatsapp-reminder.scheduler.spec.ts`:
1. Change `let whatsappService: { sendMessage: jest.Mock };` to `let whatsappService: { sendTemplate: jest.Mock };` and `whatsappService = { sendMessage: jest.fn() };` to `whatsappService = { sendTemplate: jest.fn() };`.
2. Replace `baseSettings` with:

```ts
  const baseSettings = {
    reservationReminderDaysBefore: 3,
    depositReminderDaysAfter: 3,
  };
```

3. Replace every remaining `whatsappService.sendMessage` with `whatsappService.sendTemplate`:
   `sed -i 's/whatsappService.sendMessage/whatsappService.sendTemplate/g' api/src/whatsapp/whatsapp-reminder.scheduler.spec.ts`
4. Add `confirmationToken` to every reservation fixture: `confirmationToken: 'tok-1'` on `res-1` objects, `'tok-2'` on `res-2`.
5. In `sends a reservation reminder ...`, replace the `sendTemplate` expectation with:

```ts
    expect(whatsappService.sendTemplate).toHaveBeenCalledWith(
      '+5491122334455',
      expect.objectContaining({
        variables: { '1': 'Jane', '2': '18/09/2026', '3': '20/09/2026', '4': 'tok-1' },
      }),
    );
```

6. In `sends a deposit reminder ...`, replace the `sendTemplate` expectation with:

```ts
    expect(whatsappService.sendTemplate).toHaveBeenCalledWith(
      '+5491122334455',
      expect.objectContaining({
        variables: { '1': 'John', '2': '18/09/2026', '3': 'tok-2' },
      }),
    );
```

- [ ] **Step 2: Run the scheduler tests to verify they fail**

Run: `docker compose exec api npx jest src/whatsapp/whatsapp-reminder.scheduler.spec.ts`
Expected: FAIL — `sendTemplate` never called (scheduler still calls `sendMessage`).

- [ ] **Step 3: Switch the scheduler to templates**

In `api/src/whatsapp/whatsapp-reminder.scheduler.ts`:
1. Replace the `renderTemplate` import and the local `formatDateOnly` function with:

```ts
import { depositReminderMessage, reservationReminderMessage } from './whatsapp-templates';
```

(keep `startOfUtcDayOffset`).
2. Change the two method signatures to:

```ts
  private async sendReservationReminders(settings: { reservationReminderDaysBefore: number }): Promise<void> {
```
```ts
  private async sendDepositReminders(settings: { depositReminderDaysAfter: number }): Promise<void> {
```

3. In the reservation-reminder loop, replace the `renderTemplate(...)` + `sendMessage(...)` lines with:

```ts
        const sent = await this.whatsappService.sendTemplate(
          reservation.guestPhone as string,
          reservationReminderMessage(reservation),
        );
```

4. In the deposit-reminder loop, likewise:

```ts
        const sent = await this.whatsappService.sendTemplate(
          reservation.guestPhone as string,
          depositReminderMessage(reservation),
        );
```

- [ ] **Step 4: Run the scheduler tests to verify they pass**

Run: `docker compose exec api npx jest src/whatsapp/whatsapp-reminder.scheduler.spec.ts`
Expected: PASS.

- [ ] **Step 5: Drop the two Settings columns**

In `api/prisma/schema.prisma`, delete the two `Settings` lines `reservationReminderWhatsappTemplate String @default(...)` and `depositReminderWhatsappTemplate String @default(...)`.

Create `api/prisma/migrations/20260930120000_remove_whatsapp_text_templates/migration.sql`:

```sql
-- WhatsApp reminder wording now lives in Meta-approved Twilio templates, not Settings.
ALTER TABLE "Settings" DROP COLUMN "depositReminderWhatsappTemplate",
DROP COLUMN "reservationReminderWhatsappTemplate";
```

Apply and regenerate the client:

```bash
docker compose exec api npx prisma migrate deploy
docker compose exec api npx prisma generate
```

Expected: `Applying migration 20260930120000_remove_whatsapp_text_templates`, then `Generated Prisma Client`.

- [ ] **Step 6: Remove the fields from the Settings service, DTO and tests**

- `api/src/settings/settings.service.ts`: delete the `DEFAULT_RESERVATION_REMINDER_WHATSAPP_TEMPLATE` and `DEFAULT_DEPOSIT_REMINDER_WHATSAPP_TEMPLATE` constants and their two lines in `get()`'s `create` data.
- `api/src/settings/dto/update-settings.dto.ts`: delete both decorated properties (`@IsString() @MinLength(1) reservationReminderWhatsappTemplate: string;` and the `depositReminderWhatsappTemplate` one).
- Tests — delete every line mentioning either field:

```bash
sed -i '/reservationReminderWhatsappTemplate\|depositReminderWhatsappTemplate/d' api/src/settings/settings.service.spec.ts api/test/settings.e2e-spec.ts
```

- In `api/test/settings.e2e-spec.ts`, test `persists the WhatsApp reminder settings through PUT /settings`: after `expect(response.body.depositReminderDaysAfter).toBe(4);` add:

```ts
    expect(response.body).not.toHaveProperty('reservationReminderWhatsappTemplate');
    expect(response.body).not.toHaveProperty('depositReminderWhatsappTemplate');
```

- [ ] **Step 7: Run the full API unit suite and the settings e2e**

Run:
```bash
docker compose exec api npx tsc --noEmit -p tsconfig.json
docker compose exec api npx jest
docker compose exec api npx jest --config ./test/jest-e2e.json test/settings.e2e-spec.ts
grep -rn "reservationReminderWhatsappTemplate\|depositReminderWhatsappTemplate" api/src api/test
```
Expected: no type errors; all unit tests PASS; settings e2e PASS; the grep prints nothing.

- [ ] **Step 8: Bump version and commit**

Set `"version": "0.0.9"` in `api/package.json`.

```bash
git add api/src/whatsapp api/prisma api/src/settings api/test/settings.e2e-spec.ts api/package.json
git commit -m "WhatsApp reminders: send approved templates; drop Settings text fields

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `sendInitialWhatsapp`, automatic send on creation, staff endpoint

**Files:**
- Modify: `api/prisma/schema.prisma` (`ReservationEventType` enum; `Reservation` model)
- Create: `api/prisma/migrations/20260930130000_add_whatsapp_checkin_link/migration.sql`
- Modify: `api/src/reservations/reservations.service.ts`, `reservations.controller.ts`, `reservations.module.ts`
- Test: `api/src/reservations/reservations.service.spec.ts`, `api/test/reservations.e2e-spec.ts`
- Modify: `api/package.json` (version → `0.0.10`)

**Interfaces:**
- Consumes: `WhatsappService.sendTemplate`, `checkinLinkMessage` (Task 2), `normalizePhoneForWhatsapp` (Task 1).
- Produces:
  - `Reservation.confirmationWhatsappSentAt: Date | null`
  - `ReservationEventType` values `INITIAL_WHATSAPP_SENT`, `INITIAL_WHATSAPP_FAILED`
  - `ReservationsService.sendInitialWhatsapp(reservation: Reservation): Promise<boolean>` — never rejects.
  - `ReservationsService.sendInitialWhatsappById(id: string): Promise<{ sent: boolean; reservation: Reservation }>` — 404 unknown id, 400 no phone.
  - `POST /reservations/:id/send-initial-whatsapp` → `{ sent, reservation }`.

- [ ] **Step 1: Schema and migration**

In `api/prisma/schema.prisma`, add to `enum ReservationEventType` after `CANCELLATION_EMAIL_FAILED`:

```prisma
  INITIAL_WHATSAPP_SENT
  INITIAL_WHATSAPP_FAILED
```

and to `model Reservation`, right after `confirmationEmailSentAt       DateTime?`:

```prisma
  confirmationWhatsappSentAt    DateTime?
```

Create `api/prisma/migrations/20260930130000_add_whatsapp_checkin_link/migration.sql`:

```sql
-- AlterEnum
ALTER TYPE "ReservationEventType" ADD VALUE 'INITIAL_WHATSAPP_SENT';
ALTER TYPE "ReservationEventType" ADD VALUE 'INITIAL_WHATSAPP_FAILED';

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN "confirmationWhatsappSentAt" TIMESTAMP(3);
```

Apply:

```bash
docker compose exec api npx prisma migrate deploy
docker compose exec api npx prisma generate
```

- [ ] **Step 2: Write the service tests**

In `api/src/reservations/reservations.service.spec.ts`:
1. Add imports: `import { WhatsappService } from '../whatsapp/whatsapp.service';`
2. Add `let whatsappService: { sendTemplate: jest.Mock };`, set `whatsappService = { sendTemplate: jest.fn().mockResolvedValue(true) };` in `beforeEach`, and register `{ provide: WhatsappService, useValue: whatsappService },` in `providers`.
3. Add these tests at the end of the top-level `describe`:

```ts
  describe('sendInitialWhatsapp', () => {
    const reservation = {
      id: 'res-1',
      guestName: 'Jane Doe',
      guestPhone: '+5491122334455',
      checkIn: new Date('2026-12-12T00:00:00Z'),
      checkOut: new Date('2026-12-15T00:00:00Z'),
      confirmationToken: 'tok-1',
    } as never;

    it('sends the check-in link template, stamps confirmationWhatsappSentAt and records the event', async () => {
      const result = await service.sendInitialWhatsapp(reservation);

      expect(result).toBe(true);
      expect(whatsappService.sendTemplate).toHaveBeenCalledWith(
        '+5491122334455',
        expect.objectContaining({
          variables: { '1': 'Jane Doe', '2': '12/12/2026', '3': '15/12/2026', '4': 'tok-1' },
        }),
      );
      expect(prisma.reservation.update).toHaveBeenCalledWith({
        where: { id: 'res-1' },
        data: { confirmationWhatsappSentAt: expect.any(Date) },
      });
      expect(eventsService.record).toHaveBeenCalledWith('res-1', 'INITIAL_WHATSAPP_SENT');
    });

    it('records a failure without stamping when Twilio does not accept the message', async () => {
      whatsappService.sendTemplate.mockResolvedValue(false);

      const result = await service.sendInitialWhatsapp(reservation);

      expect(result).toBe(false);
      expect(prisma.reservation.update).not.toHaveBeenCalled();
      expect(eventsService.record).toHaveBeenCalledWith('res-1', 'INITIAL_WHATSAPP_FAILED', expect.any(String));
    });

    it('records an invalid phone as the failure reason and never calls Twilio', async () => {
      const result = await service.sendInitialWhatsapp({ ...(reservation as object), guestPhone: '12345' } as never);

      expect(result).toBe(false);
      expect(whatsappService.sendTemplate).not.toHaveBeenCalled();
      expect(eventsService.record).toHaveBeenCalledWith(
        'res-1',
        'INITIAL_WHATSAPP_FAILED',
        expect.stringContaining('12345'),
      );
    });

    it('resolves to false instead of rejecting when recording the event fails', async () => {
      eventsService.record.mockRejectedValue(new Error('db down'));

      await expect(service.sendInitialWhatsapp(reservation)).resolves.toBe(false);
    });
  });

  describe('WhatsApp on create', () => {
    it('sends the check-in link when the new reservation has a phone', async () => {
      const created = { id: '1', ...validDto, guestPhone: '+5491122334455', confirmationToken: 'tok-1', checkIn: new Date('2026-01-10'), checkOut: new Date('2026-01-15') };
      prisma.reservation.create.mockResolvedValue(created);

      await service.create({ ...validDto, guestPhone: '+5491122334455' });

      expect(whatsappService.sendTemplate).toHaveBeenCalledWith('+5491122334455', expect.anything());
    });

    it('does not send when the new reservation has no phone', async () => {
      prisma.reservation.create.mockResolvedValue({ id: '1', ...validDto });

      await service.create(validDto);

      expect(whatsappService.sendTemplate).not.toHaveBeenCalled();
    });
  });

  describe('sendInitialWhatsappById', () => {
    it('rejects a reservation with no phone', async () => {
      prisma.reservation.findUnique.mockResolvedValue({ id: '1', guestPhone: null });

      await expect(service.sendInitialWhatsappById('1')).rejects.toBeInstanceOf(BadRequestException);
      expect(whatsappService.sendTemplate).not.toHaveBeenCalled();
    });

    it('sends even if one was already sent, and returns the refreshed reservation', async () => {
      const existing = {
        id: '1',
        guestName: 'Jane Doe',
        guestPhone: '+5491122334455',
        checkIn: new Date('2026-12-12T00:00:00Z'),
        checkOut: new Date('2026-12-15T00:00:00Z'),
        confirmationToken: 'tok-1',
        confirmationWhatsappSentAt: new Date('2026-09-01'),
      };
      prisma.reservation.findUnique.mockResolvedValue(existing);

      const result = await service.sendInitialWhatsappById('1');

      expect(whatsappService.sendTemplate).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ sent: true, reservation: existing });
    });
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `docker compose exec api npx jest src/reservations/reservations.service.spec.ts`
Expected: FAIL — `service.sendInitialWhatsapp is not a function` (and `ReservationsService` doesn't inject `WhatsappService` yet).

- [ ] **Step 4: Implement in the service**

In `api/src/reservations/reservations.service.ts`:
1. Add imports:

```ts
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { checkinLinkMessage } from '../whatsapp/whatsapp-templates';
import { normalizePhoneForWhatsapp } from '../whatsapp/phone-normalizer';
```

2. Add `private readonly whatsappService: WhatsappService,` as the last constructor parameter.
3. In `create()`, right after the `if (reservation.guestEmail) { await this.sendInitialEmail(reservation); }` block, add:

```ts
    // Awaited like the email above (rather than fire-and-forget), so its event row is
    // written before the response — same reason the email is.
    if (reservation.guestPhone) {
      await this.sendInitialWhatsapp(reservation);
    }
```

4. After `resendInitialEmail()`, add:

```ts
  // The same guest link as sendInitialEmail(), over WhatsApp, using the Meta-approved
  // `checkin_link` template (see whatsapp-templates.ts). Public so ChannelImportService can
  // send it for imported reservations and sendInitialWhatsappById() can retry on demand.
  // Never rejects — channel-import calls it fire-and-forget — and returns whether it sent.
  // A failure is recorded as a reservation event, without a staff alert email: WhatsApp is
  // an additional channel, same handling as the daily reminders.
  async sendInitialWhatsapp(reservation: Reservation): Promise<boolean> {
    try {
      const phone = reservation.guestPhone as string;
      if (!normalizePhoneForWhatsapp(phone)) {
        await this.eventsService.record(
          reservation.id,
          'INITIAL_WHATSAPP_FAILED',
          `El teléfono "${phone}" no es un número válido para WhatsApp`,
        );
        return false;
      }

      const sent = await this.whatsappService.sendTemplate(phone, checkinLinkMessage(reservation));
      if (!sent) {
        await this.eventsService.record(
          reservation.id,
          'INITIAL_WHATSAPP_FAILED',
          'Twilio no aceptó el mensaje (ver los logs del API)',
        );
        return false;
      }

      await this.prisma.reservation.update({
        where: { id: reservation.id },
        data: { confirmationWhatsappSentAt: new Date() },
      });
      await this.eventsService.record(reservation.id, 'INITIAL_WHATSAPP_SENT');
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to send the check-in link over WhatsApp for ${reservation.id}: ${(error as Error).message}`,
      );
      return false;
    }
  }

  // Explicit staff-triggered send/resend — always attempts it, even if one already went out.
  async sendInitialWhatsappById(id: string): Promise<{ sent: boolean; reservation: Reservation }> {
    const reservation = await this.findOne(id);
    if (!reservation.guestPhone) {
      throw new BadRequestException('This reservation has no guest phone to send to');
    }

    const sent = await this.sendInitialWhatsapp(reservation);
    return { sent, reservation: await this.findOne(id) };
  }
```

5. `ReservationsService` has no logger yet: add `Logger` to the `@nestjs/common` import and, as the first line inside the class, `private readonly logger = new Logger(ReservationsService.name);`.

In `api/src/reservations/reservations.module.ts`, add `import { WhatsappModule } from '../whatsapp/whatsapp.module';` and add `WhatsappModule` to `imports`.

In `api/src/reservations/reservations.controller.ts`, after `resendInitialEmail`:

```ts
  @Post(':id/send-initial-whatsapp')
  sendInitialWhatsapp(@Param('id') id: string) {
    return this.reservationsService.sendInitialWhatsappById(id);
  }
```

- [ ] **Step 5: Run the unit tests to verify they pass**

Run: `docker compose exec api npx jest src/reservations`
Expected: PASS.

- [ ] **Step 6: Stub WhatsApp in the reservations e2e and add endpoint tests**

In `api/test/reservations.e2e-spec.ts`:
1. Add `import { WhatsappService } from '../src/whatsapp/whatsapp.service';` and a module-level `const sendTemplate = jest.fn().mockResolvedValue(true);`.
2. Replace `const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();` with:

```ts
    // This file creates reservations with a guestPhone, which now sends the check-in link
    // over WhatsApp — stub it so no test ever messages a real number through Twilio.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WhatsappService)
      .useValue({ sendTemplate, sendMessage: jest.fn().mockResolvedValue(true) })
      .compile();
```

3. Add these tests before the final `});`:

```ts
  describe('POST /reservations/:id/send-initial-whatsapp', () => {
    async function createReservation(guestPhone?: string) {
      const response = await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          guestName: 'E2E Guest',
          ...(guestPhone ? { guestPhone } : {}),
          checkIn: '2026-11-01',
          checkOut: '2026-11-05',
          paxCount: 2,
          source: 'DIRECT',
          totalAmount: 100000,
          currency: 'ARS',
        })
        .expect(201);
      return response.body as { id: string; confirmationWhatsappSentAt: string | null };
    }

    it('sends the link on creation when there is a phone', async () => {
      sendTemplate.mockClear();

      const created = await createReservation('+54 9 223 555-1234');

      expect(sendTemplate).toHaveBeenCalledTimes(1);
      const events = await prisma.reservationEvent.findMany({ where: { reservationId: created.id } });
      expect(events.map((e) => e.type)).toContain('INITIAL_WHATSAPP_SENT');
    });

    it('resends on demand and returns { sent, reservation }', async () => {
      const created = await createReservation('+54 9 223 555-1234');
      sendTemplate.mockClear();

      const response = await request(app.getHttpServer())
        .post(`/reservations/${created.id}/send-initial-whatsapp`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(201);

      expect(sendTemplate).toHaveBeenCalledTimes(1);
      expect(response.body.sent).toBe(true);
      expect(response.body.reservation.confirmationWhatsappSentAt).not.toBeNull();
    });

    it('returns 400 for a reservation without a phone', async () => {
      const created = await createReservation();

      await request(app.getHttpServer())
        .post(`/reservations/${created.id}/send-initial-whatsapp`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(400);
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer()).post('/reservations/any-id/send-initial-whatsapp').expect(401);
    });
  });
```

(The existing `afterAll` already deletes reservations named `E2E Guest` and their events.)

- [ ] **Step 7: Run the e2e tests**

Run: `docker compose exec api npx jest --config ./test/jest-e2e.json test/reservations.e2e-spec.ts`
Expected: PASS.

- [ ] **Step 8: Bump version and commit**

Set `"version": "0.0.10"` in `api/package.json`.

```bash
git add api/prisma api/src/reservations api/test/reservations.e2e-spec.ts api/package.json
git commit -m "Send the guest check-in link over WhatsApp on creation and on demand

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Send the link for channel imports

**Files:**
- Modify: `api/src/channel-import/channel-import.service.ts` (create path, after the `sendInitialEmail` block ~line 229)
- Test: `api/src/channel-import/channel-import.service.spec.ts`, `api/test/channel-import.e2e-spec.ts`
- Modify: `api/package.json` (version → `0.0.11`)

**Interfaces:**
- Consumes: `ReservationsService.sendInitialWhatsapp(reservation): Promise<boolean>` (Task 4).

- [ ] **Step 1: Write the tests**

In `api/src/channel-import/channel-import.service.spec.ts`:
1. Change `let reservationsService: { sendInitialEmail: jest.Mock };` to `let reservationsService: { sendInitialEmail: jest.Mock; sendInitialWhatsapp: jest.Mock };` and the `beforeEach` assignment to `reservationsService = { sendInitialEmail: jest.fn(), sendInitialWhatsapp: jest.fn() };`.
2. Add at the end of the top-level `describe`:

```ts
  describe('WhatsApp check-in link', () => {
    const scrapedDto: ImportReservationDto = {
      ...baseDto,
      source: 'airbnb',
      hotel_id: undefined,
      res_id: '1000000484',
      guest_name: 'María Laura',
      guest_phone: '+591 75278095',
      check_in: '2026-12-12',
      check_out: '2026-12-15',
    };

    beforeEach(() => {
      prisma.reservation.findUnique.mockResolvedValue(null);
      prisma.reservation.create.mockImplementation(({ data }) => Promise.resolve({ id: 'res-wa', ...data }));
    });

    it('sends it for a new import with a phone, name and dates', async () => {
      const { reservation } = await service.import(scrapedDto);

      expect(reservationsService.sendInitialWhatsapp).toHaveBeenCalledWith(reservation);
    });

    it('does not send it when the name or dates were not scraped (placeholders would be wrong)', async () => {
      await service.import({ ...scrapedDto, guest_name: null });
      await service.import({ ...scrapedDto, check_in: null });
      await service.import({ ...scrapedDto, check_out: null });

      expect(reservationsService.sendInitialWhatsapp).not.toHaveBeenCalled();
    });

    it('does not send it without a phone', async () => {
      await service.import({ ...scrapedDto, guest_phone: null });

      expect(reservationsService.sendInitialWhatsapp).not.toHaveBeenCalled();
    });

    it('does not send it when re-importing an existing reservation', async () => {
      const existing = { id: 'res-existing', status: 'PENDING', guestName: 'María Laura', guestEmail: null, guestPhone: null, guestId: null };
      prisma.reservation.findUnique.mockResolvedValue(existing);
      prisma.reservation.update.mockResolvedValue({ ...existing, guestPhone: '+59175278095' });

      await service.import(scrapedDto);

      expect(reservationsService.sendInitialWhatsapp).not.toHaveBeenCalled();
    });
  });
```


- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker compose exec api npx jest src/channel-import/channel-import.service.spec.ts`
Expected: FAIL — `sendInitialWhatsapp` never called in the first new test.

- [ ] **Step 3: Implement**

In `api/src/channel-import/channel-import.service.ts`, right after the `if (guestEmail) { void this.reservationsService.sendInitialEmail(reservation); }` block, add:

```ts
    // The check-in link also goes out over WhatsApp whenever we have a phone — but only
    // once the name and both dates were actually scraped: unlike the email, the WhatsApp
    // template states them ("Tu estadía del ... al ..."), and the placeholders used above
    // when they're missing (today's date, "Huésped de ... (pendiente de completar)") would
    // tell the guest something wrong. Staff can still send it from the reservation page
    // once they've filled those in.
    if (guestPhone && dto.guest_name?.trim() && dto.check_in && dto.check_out) {
      void this.reservationsService.sendInitialWhatsapp(reservation);
    }
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `docker compose exec api npx jest src/channel-import`
Expected: PASS.

- [ ] **Step 5: Fix the e2e stub**

In `api/test/channel-import.e2e-spec.ts`, change

```ts
      .useValue({ sendInitialEmail: jest.fn().mockResolvedValue(undefined) })
```

to

```ts
      .useValue({
        sendInitialEmail: jest.fn().mockResolvedValue(undefined),
        sendInitialWhatsapp: jest.fn().mockResolvedValue(true),
      })
```

and extend the comment above it: `sendInitialWhatsapp` is stubbed for the same reason (its own Prisma writes, and no real Twilio send).

Run: `docker compose exec api npx jest --config ./test/jest-e2e.json test/channel-import.e2e-spec.ts`
Expected: PASS.

- [ ] **Step 6: Bump version and commit**

Set `"version": "0.0.11"` in `api/package.json`.

```bash
git add api/src/channel-import api/test/channel-import.e2e-spec.ts api/package.json
git commit -m "Send the WhatsApp check-in link for Booking/Airbnb imports

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Admin web — WhatsApp button, event labels, Settings cleanup

**Files:**
- Modify: `admin-web/src/api/reservations.ts`, `admin-web/src/reservations/types.ts`, `admin-web/src/lib/labels.ts`
- Modify: `admin-web/src/reservations/ReservationFormPage.tsx`
- Test: `admin-web/src/reservations/ReservationFormPage.test.tsx`
- Modify: `admin-web/src/api/settings.ts`, `admin-web/src/settings/SettingsPage.tsx`
- Test: `admin-web/src/settings/SettingsPage.test.tsx`
- Modify: `admin-web/package.json` (version `0.1.4` → `0.1.5`)

**Interfaces:**
- Consumes: `POST /reservations/:id/send-initial-whatsapp` → `{ sent: boolean, reservation }` (Task 4); `Reservation.confirmationWhatsappSentAt` (Task 4); Settings without the two text fields (Task 3).
- Produces: `sendInitialWhatsapp(id: string): Promise<ResendEmailResult>` in `admin-web/src/api/reservations.ts`.

- [ ] **Step 1: Write the reservation page tests**

Append to the top-level `describe` in `admin-web/src/reservations/ReservationFormPage.test.tsx` (same mocks/render pattern as the existing `resends the initial confirmation email` test):

```tsx
  const reservationWithPhone = {
    id: '1',
    guestName: 'Jane Doe',
    guestPhone: '+5491122334455',
    checkIn: '2026-01-10',
    checkOut: '2026-01-15',
    paxCount: 2,
    source: 'DIRECT',
    totalAmount: 100000,
    currency: 'ARS',
    status: 'PENDING',
    confirmationToken: 'tok-1',
  };

  function renderReservationPage() {
    render(
      <MemoryRouter initialEntries={['/reservations/1']}>
        <Routes>
          <Route path="/reservations/:id" element={<ReservationFormPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('sends the check-in link over WhatsApp', async () => {
    vi.spyOn(reservationsApi, 'getReservation').mockResolvedValue(reservationWithPhone as never);
    vi.spyOn(reservationsApi, 'listReservationEvents').mockResolvedValue([]);
    vi.spyOn(reservationImagesApi, 'listReservationImages').mockResolvedValue([]);
    const sendSpy = vi
      .spyOn(reservationsApi, 'sendInitialWhatsapp')
      .mockResolvedValue({ sent: true, reservation: {} as never });

    renderReservationPage();

    fireEvent.click(await screen.findByRole('button', { name: /enviar link por whatsapp/i }));

    await waitFor(() => expect(sendSpy).toHaveBeenCalledWith('1'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows an error when the WhatsApp could not be sent', async () => {
    vi.spyOn(reservationsApi, 'getReservation').mockResolvedValue(reservationWithPhone as never);
    vi.spyOn(reservationsApi, 'listReservationEvents').mockResolvedValue([]);
    vi.spyOn(reservationImagesApi, 'listReservationImages').mockResolvedValue([]);
    vi.spyOn(reservationsApi, 'sendInitialWhatsapp').mockResolvedValue({ sent: false, reservation: {} as never });

    renderReservationPage();

    fireEvent.click(await screen.findByRole('button', { name: /enviar link por whatsapp/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/el whatsapp no pudo enviarse/i);
  });

  it('hides the WhatsApp button when the reservation has no phone', async () => {
    vi.spyOn(reservationsApi, 'getReservation').mockResolvedValue({
      ...reservationWithPhone,
      guestPhone: undefined,
    } as never);
    vi.spyOn(reservationsApi, 'listReservationEvents').mockResolvedValue([]);
    vi.spyOn(reservationImagesApi, 'listReservationImages').mockResolvedValue([]);

    renderReservationPage();

    expect(await screen.findByText(/la reserva no tiene un teléfono de huésped/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /enviar link por whatsapp/i })).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker compose exec admin-web npx vitest run src/reservations/ReservationFormPage.test.tsx`
Expected: FAIL — `sendInitialWhatsapp` doesn't exist on the API module; button not found.

- [ ] **Step 3: Implement the API client, type and labels**

`admin-web/src/api/reservations.ts`, after `resendInitialEmail`:

```ts
export function sendInitialWhatsapp(id: string): Promise<ResendEmailResult> {
  return apiClient.request(`/reservations/${id}/send-initial-whatsapp`, { method: 'POST' });
}
```

`admin-web/src/reservations/types.ts`, after `confirmationEmailSentAt?: string | null;`:

```ts
  confirmationWhatsappSentAt?: string | null;
```

`admin-web/src/lib/labels.ts`, in `EVENT_TYPE_LABELS` after `INITIAL_EMAIL_FAILED`:

```ts
  INITIAL_WHATSAPP_SENT: 'WhatsApp con el link enviado',
  INITIAL_WHATSAPP_FAILED: 'Falló el WhatsApp con el link',
```

- [ ] **Step 4: Implement the button**

In `admin-web/src/reservations/ReservationFormPage.tsx`:
1. Add `sendInitialWhatsapp,` to the `../api/reservations` import list.
2. Add `| 'sendWhatsapp'` to `type ActionKey`.
3. After `handleResendInitialEmail`, add:

```tsx
  async function handleSendInitialWhatsapp() {
    if (!id) return;
    setActionError(null);
    setActionLoading('sendWhatsapp');
    try {
      const { sent } = await sendInitialWhatsapp(id);
      loadReservation();
      if (!sent) {
        setActionError('El WhatsApp no pudo enviarse. Revisá el historial de eventos para más detalles.');
      }
    } catch {
      setActionError('No se pudo enviar el link por WhatsApp. Por favor, intentá de nuevo.');
    } finally {
      setActionLoading(null);
    }
  }
```

4. Right after the closing `</li>` of the "Email inicial" item, add:

```tsx
              <li className="flex items-start justify-between gap-4 py-3">
                <div className="flex items-start gap-3">
                  <StepIcon done={Boolean(reservationRecord.confirmationWhatsappSentAt)} />
                  <div>
                    <p className="font-medium text-text">WhatsApp con el link</p>
                    <p className="text-sm text-text-muted">
                      {!reservationRecord.guestPhone
                        ? 'La reserva no tiene un teléfono de huésped'
                        : reservationRecord.confirmationWhatsappSentAt
                          ? `Enviado el ${formatDateTime(reservationRecord.confirmationWhatsappSentAt)}`
                          : 'No enviado'}
                    </p>
                  </div>
                </div>
                {reservationRecord.guestPhone && (
                  <Button
                    type="button"
                    variant="secondary"
                    loading={actionLoading === 'sendWhatsapp'}
                    onClick={handleSendInitialWhatsapp}
                  >
                    Enviar link por WhatsApp
                  </Button>
                )}
              </li>
```

- [ ] **Step 5: Run the reservation page tests to verify they pass**

Run: `docker compose exec admin-web npx vitest run src/reservations/ReservationFormPage.test.tsx`
Expected: PASS.

- [ ] **Step 6: Update the Settings test**

In `admin-web/src/settings/SettingsPage.test.tsx`:
1. Delete the two `baseSettings` lines `reservationReminderWhatsappTemplate: ...` and `depositReminderWhatsappTemplate: ...`.
2. In `it('loads and saves the WhatsApp reminder settings', ...)`, delete the two `expect(screen.getByLabelText(/mensaje de recordatorio de .../i)).toHaveValue(...)` assertions and replace the `fireEvent.change(... /mensaje de recordatorio de reserva/ ...)` + final `updateSpy` expectation with:

```tsx
    expect(screen.queryByLabelText(/mensaje de recordatorio/i)).not.toBeInTheDocument();
    expect(screen.getByText(/se edita en la consola de twilio/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/días antes del check-in/i), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }));

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ reservationReminderDaysBefore: 5 })),
    );
```

Run: `docker compose exec admin-web npx vitest run src/settings/SettingsPage.test.tsx`
Expected: FAIL — the text boxes still render; the Twilio note doesn't exist.

- [ ] **Step 7: Remove the text fields from Settings**

- `admin-web/src/api/settings.ts`: delete `reservationReminderWhatsappTemplate: string;` and `depositReminderWhatsappTemplate: string;`.
- `admin-web/src/settings/SettingsPage.tsx`:
  - delete the two `useState('')` lines for `reservationReminderWhatsappTemplate` / `depositReminderWhatsappTemplate` (lines ~34-35);
  - delete their two setter calls in the load effect (lines ~81-82);
  - delete the two shorthand properties in the save payload (lines ~155-156);
  - in the "Recordatorios de WhatsApp" card, delete both `<FormField label="Mensaje de recordatorio de ...">…</FormField>` blocks and both `<p className="-mt-2 text-xs text-text-muted">Variables: …</p>` lines that follow them;
  - replace that card's description paragraph text with:

```tsx
          <p className="mb-4 text-sm text-text-muted">
            Se envían automáticamente por WhatsApp (vía Twilio) cuando el huésped tiene un número de teléfono
            cargado. El texto de cada mensaje es una plantilla aprobada por WhatsApp y se edita en la consola de
            Twilio, no acá.
          </p>
```

- [ ] **Step 8: Run the admin-web suite and type check**

Run:
```bash
docker compose exec admin-web npx vitest run
docker compose exec admin-web npx tsc --noEmit -p tsconfig.app.json
grep -rn "WhatsappTemplate" admin-web/src
```
Expected: all tests PASS; no type errors (if `tsconfig.app.json` doesn't exist, use the project's `npm run build` instead); the grep prints nothing.

- [ ] **Step 9: Bump version and commit**

Set `"version": "0.1.5"` in `admin-web/package.json`.

```bash
git add admin-web/src admin-web/package.json
git commit -m "Admin: send the check-in link over WhatsApp; Settings drops WhatsApp text boxes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Full verification and a real send

**Files:** none (verification only).

- [ ] **Step 1: Run every suite**

```bash
docker compose exec api npx tsc --noEmit -p tsconfig.json
docker compose exec api npx jest
docker compose exec api npm run test:e2e
docker compose exec admin-web npx vitest run
```
Expected: all PASS. Any e2e file that newly fails because it creates a reservation with a phone needs the same `WhatsappService` override as Task 4 Step 6 — never let it reach Twilio.

- [ ] **Step 2: One real send (manual, with the owner)**

With the owner's go-ahead, set the three `TWILIO_TEMPLATE_*` values and the approved `TWILIO_WHATSAPP_FROM` in the local `.env`, restart the API container (`docker compose restart api`), create a reservation in the local admin with the **owner's own** phone, and confirm the `checkin_link` message arrives with a working "Completar check-in" button. If the sender number isn't live yet, leave the template vars empty and use the Sandbox (freeform fallback) instead.

- [ ] **Step 3: Production configuration (owner)**

Before deploying: add the three `TWILIO_TEMPLATE_*` lines to the production `.env` and set `TWILIO_WHATSAPP_FROM=whatsapp:+54…` once the number is live. Run `npx prisma migrate deploy` in production as part of the deploy (two new migrations).
