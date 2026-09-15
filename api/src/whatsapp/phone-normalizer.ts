// Argentine mobile numbers need a `9` inserted right after the `54` country code for
// WhatsApp addressing specifically — this is not how anyone writes or dials the number
// locally, and getting it wrong is a silent failure (the message just never arrives).
// See the design spec's "Argentina phone number normalization" section.
export function normalizeArgentinePhoneForWhatsapp(raw: string): string | null {
  const hasPlus = raw.trim().startsWith('+');
  let digits = raw.replace(/\D/g, '');

  if (digits.length === 0) {
    return null;
  }

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

  const national = `9${withoutFifteen}`;
  const result = `54${national}`;

  // A real Argentine WhatsApp number is 54 + 9 + 10 digits = 13 digits total.
  if (result.length !== 13) {
    return null;
  }

  return `whatsapp:+${result}`;
}
