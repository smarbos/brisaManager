import { normalizeArgentinePhoneForWhatsapp } from './phone-normalizer';

describe('normalizeArgentinePhoneForWhatsapp', () => {
  it('accepts an already-correct E.164 WhatsApp number', () => {
    expect(normalizeArgentinePhoneForWhatsapp('+5491122334455')).toBe('whatsapp:+5491122334455');
  });

  it('inserts the missing 9 after the country code', () => {
    expect(normalizeArgentinePhoneForWhatsapp('+541122334455')).toBe('whatsapp:+5491122334455');
  });

  it('prepends the country code when missing, and inserts the 9', () => {
    expect(normalizeArgentinePhoneForWhatsapp('1122334455')).toBe('whatsapp:+5491122334455');
  });

  it('strips a leading trunk 0', () => {
    expect(normalizeArgentinePhoneForWhatsapp('01122334455')).toBe('whatsapp:+5491122334455');
  });

  it('strips an internal old-style 15 mobile prefix', () => {
    expect(normalizeArgentinePhoneForWhatsapp('011 15 2233-4455')).toBe('whatsapp:+5491122334455');
  });

  it('strips spaces, dashes, and parentheses', () => {
    expect(normalizeArgentinePhoneForWhatsapp('+54 9 (11) 2233-4455')).toBe('whatsapp:+5491122334455');
  });

  it('handles the country code with no + prefix and no 9', () => {
    expect(normalizeArgentinePhoneForWhatsapp('54 11 2233 4455')).toBe('whatsapp:+5491122334455');
  });

  it('returns null for obviously invalid input (too short)', () => {
    expect(normalizeArgentinePhoneForWhatsapp('12345')).toBeNull();
  });

  it('returns null for input with no digits at all', () => {
    expect(normalizeArgentinePhoneForWhatsapp('not a phone number')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(normalizeArgentinePhoneForWhatsapp('')).toBeNull();
  });

  it('rejects an explicit non-Argentine country code rather than guessing', () => {
    expect(normalizeArgentinePhoneForWhatsapp('+52 55 1234 5678')).toBeNull(); // Mexico
  });

  it('rejects another explicit non-Argentine country code', () => {
    expect(normalizeArgentinePhoneForWhatsapp('+57 300 1234567')).toBeNull(); // Colombia
  });
});
