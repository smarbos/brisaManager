import { describe, expect, it } from 'vitest';
import { COUNTRIES, formatDocument, formatMarketingConsent } from './document';

describe('formatDocument', () => {
  it('shows a full DNI on detail views', () => {
    expect(formatDocument({ document: { type: 'DNI', country: 'AR', number: '12345678' } })).toBe('DNI 12345678');
  });

  it('names the issuing country of a passport', () => {
    expect(formatDocument({ document: { type: 'PASAPORTE', country: 'ES', number: 'XA123456' } })).toBe(
      'Pasaporte XA123456 (España)',
    );
  });

  it('falls back to the masked form, then to a dash', () => {
    expect(formatDocument({ documentMasked: 'DNI ···678' })).toBe('DNI ···678');
    expect(formatDocument({})).toBe('—');
  });

  it('says so when the stored document could not be decrypted', () => {
    expect(formatDocument({ documentUnreadable: true, document: null })).toBe('No se pudo leer el documento');
  });
});

describe('formatMarketingConsent', () => {
  it('reads "Sin consentimiento" without a consent date', () => {
    expect(formatMarketingConsent(null)).toBe('Sin consentimiento');
  });
});

describe('COUNTRIES', () => {
  it('lists real countries by Spanish name, without the unknown region', () => {
    expect(COUNTRIES.find((c) => c.code === 'ES')?.name).toBe('España');
    expect(COUNTRIES.some((c) => c.code === 'ZZ')).toBe(false);
  });
});
