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

  const afterCountryCode = digits.slice(2);
  const national = strip15Prefix(afterCountryCode.startsWith('9') ? afterCountryCode.slice(1) : afterCountryCode);

  const result = `549${national}`;

  // A real Argentine WhatsApp number is 54 + 9 + 10 digits = 13 digits total.
  if (result.length !== 13) {
    return null;
  }

  return `whatsapp:+${result}`;
}

// An Argentine number is 10 digits (area code + local number). The old-style "15" mobile prefix,
// dialed right after the 2-4 digit area code ("011 15 2233-4455"), makes it 12 — so it's only
// removed from a 12-digit number. Plenty of complete numbers merely contain a "15" (11 5555...,
// 351 5..., 223 515...), and those must be left alone.
function strip15Prefix(national: string): string {
  if (national.length !== 12) {
    return national;
  }
  const index = [2, 3, 4].find((areaCodeLength) => national.startsWith('15', areaCodeLength));
  return index === undefined ? national : national.slice(0, index) + national.slice(index + 2);
}
