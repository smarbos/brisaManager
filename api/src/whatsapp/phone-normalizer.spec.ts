import { normalizePhoneForWhatsapp } from './phone-normalizer';

describe('normalizePhoneForWhatsapp', () => {
  it('accepts an already-correct E.164 WhatsApp number', () => {
    expect(normalizePhoneForWhatsapp('+5491122334455')).toBe('whatsapp:+5491122334455');
  });

  it('inserts the missing 9 after the country code', () => {
    expect(normalizePhoneForWhatsapp('+541122334455')).toBe('whatsapp:+5491122334455');
  });

  it('prepends the country code when missing, and inserts the 9', () => {
    expect(normalizePhoneForWhatsapp('1122334455')).toBe('whatsapp:+5491122334455');
  });

  it('strips a leading trunk 0', () => {
    expect(normalizePhoneForWhatsapp('01122334455')).toBe('whatsapp:+5491122334455');
  });

  it('strips an internal old-style 15 mobile prefix', () => {
    expect(normalizePhoneForWhatsapp('011 15 2233-4455')).toBe('whatsapp:+5491122334455');
  });

  it.each([
    ['+5491155550101', 'Buenos Aires, 11 5...'],
    ['+5491141150101', 'a 15 later in the local number'],
    ['+5492235150101', 'Mar del Plata, 223 515...'],
    ['+5492236150101', 'Mar del Plata, 223 615...'],
    ['+5492215550101', 'La Plata, 221 5...'],
    ['+5493515550101', 'Córdoba, 351 5...'],
    ['+5493415150101', 'Rosario, 341 515...'],
    ['+5492615150101', 'Mendoza, 261 515...'],
  ])('leaves a complete number alone when it merely contains a 15: %s (%s)', (phone) => {
    expect(normalizePhoneForWhatsapp(phone)).toBe(`whatsapp:${phone}`);
  });

  it.each([
    ['11 5555 0101', 'whatsapp:+5491155550101'],
    ['11 15 5555 0101', 'whatsapp:+5491155550101'],
    ['11 15 1555 0101', 'whatsapp:+5491115550101'],
    ['221 15 555 0101', 'whatsapp:+5492215550101'],
    ['351 15 515 0101', 'whatsapp:+5493515150101'],
    ['2966 15 41 0101', 'whatsapp:+5492966410101'],
    ['+54 9 11 15 5555 0101', 'whatsapp:+5491155550101'],
  ])('drops the old-style 15 prefix only when it is an extra prefix: %s', (phone, expected) => {
    expect(normalizePhoneForWhatsapp(phone)).toBe(expected);
  });

  it('strips spaces, dashes, and parentheses', () => {
    expect(normalizePhoneForWhatsapp('+54 9 (11) 2233-4455')).toBe('whatsapp:+5491122334455');
  });

  it('handles the country code with no + prefix and no 9', () => {
    expect(normalizePhoneForWhatsapp('54 11 2233 4455')).toBe('whatsapp:+5491122334455');
  });

  it('returns null for obviously invalid input (too short)', () => {
    expect(normalizePhoneForWhatsapp('12345')).toBeNull();
  });

  it('returns null for input with no digits at all', () => {
    expect(normalizePhoneForWhatsapp('not a phone number')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(normalizePhoneForWhatsapp('')).toBeNull();
  });

  it('formats an explicit foreign number as E.164 instead of rewriting it as Argentine', () => {
    expect(normalizePhoneForWhatsapp('+52 55 1234 5678')).toBe('whatsapp:+525512345678'); // Mexico
    expect(normalizePhoneForWhatsapp('+57 300 1234567')).toBe('whatsapp:+573001234567'); // Colombia
    expect(normalizePhoneForWhatsapp('+1 201 555 0123')).toBe('whatsapp:+12015550123'); // US
    expect(normalizePhoneForWhatsapp('+34 612 34 56 78')).toBe('whatsapp:+34612345678'); // Spain
  });

  it('recognizes a foreign number wrapped in invisible direction marks (as scraped from Airbnb)', () => {
    expect(normalizePhoneForWhatsapp('\u202a+591 75278095\u202c')).toBe('whatsapp:+59175278095'); // Bolivia
  });

  it('returns null for an explicit foreign number that is not a valid number', () => {
    expect(normalizePhoneForWhatsapp('+52 123')).toBeNull();
  });

  it('still applies the Argentine rules to an explicit +54 number', () => {
    expect(normalizePhoneForWhatsapp('+54 11 15 2233-4455')).toBe('whatsapp:+5491122334455');
  });
});
