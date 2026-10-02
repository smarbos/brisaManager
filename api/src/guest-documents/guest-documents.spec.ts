import { BadRequestException } from '@nestjs/common';
import {
  decryptDocumentNumber,
  encryptDocumentNumber,
  hashDocument,
  maskDocument,
  normalizeDocument,
  parseDocumentKeys,
} from './guest-documents';

const ENCRYPTION_KEY = Buffer.from('11'.repeat(32), 'hex');
const HASH_KEY = Buffer.from('22'.repeat(32), 'hex');

describe('normalizeDocument', () => {
  it('strips dots and spaces from a DNI and forces country AR', () => {
    expect(normalizeDocument({ type: 'DNI', country: 'UY', number: ' 12.345.678 ' })).toEqual({
      type: 'DNI',
      country: 'AR',
      number: '12345678',
    });
  });

  it('accepts a 7-digit DNI', () => {
    expect(normalizeDocument({ type: 'DNI', number: '1.234.567' }).number).toBe('1234567');
  });

  it.each(['123456', '123456789', 'abc', ''])('rejects DNI %p', (number) => {
    expect(() => normalizeDocument({ type: 'DNI', number })).toThrow(BadRequestException);
  });

  it('uppercases a passport and strips everything but A-Z0-9', () => {
    expect(normalizeDocument({ type: 'PASAPORTE', country: 'es', number: 'xa-123 456' })).toEqual({
      type: 'PASAPORTE',
      country: 'ES',
      number: 'XA123456',
    });
  });

  it.each(['A123', 'A'.repeat(16)])('rejects passport number %p by length', (number) => {
    expect(() => normalizeDocument({ type: 'PASAPORTE', country: 'ES', number })).toThrow(BadRequestException);
  });

  it.each([undefined, '', 'ESP', 'E1', 'XX'])('rejects passport country %p', (country) => {
    expect(() => normalizeDocument({ type: 'PASAPORTE', country, number: 'XA123456' })).toThrow(BadRequestException);
  });

  it('rejects an unknown document type', () => {
    expect(() => normalizeDocument({ type: 'CUIT' as never, number: '12345678' })).toThrow(BadRequestException);
  });

  it('gives a Spanish message', () => {
    expect(() => normalizeDocument({ type: 'DNI', number: '12' })).toThrow('El DNI debe tener 7 u 8 dígitos.');
  });
});

describe('hashDocument', () => {
  it('is stable across formatting variants', () => {
    const a = hashDocument(normalizeDocument({ type: 'DNI', number: '12.345.678' }), HASH_KEY);
    const b = hashDocument(normalizeDocument({ type: 'DNI', number: '12345678' }), HASH_KEY);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs across type and country for the same number', () => {
    const dni = hashDocument({ type: 'DNI', country: 'AR', number: '12345678' }, HASH_KEY);
    const passportAr = hashDocument({ type: 'PASAPORTE', country: 'AR', number: '12345678' }, HASH_KEY);
    const passportEs = hashDocument({ type: 'PASAPORTE', country: 'ES', number: '12345678' }, HASH_KEY);
    expect(new Set([dni, passportAr, passportEs]).size).toBe(3);
  });
});

describe('encryptDocumentNumber / decryptDocumentNumber', () => {
  it('round-trips', () => {
    const stored = encryptDocumentNumber('12345678', ENCRYPTION_KEY);
    expect(decryptDocumentNumber(stored, ENCRYPTION_KEY)).toBe('12345678');
  });

  it('uses a random IV, so ciphertext differs per call', () => {
    expect(encryptDocumentNumber('12345678', ENCRYPTION_KEY)).not.toBe(encryptDocumentNumber('12345678', ENCRYPTION_KEY));
  });

  it('stores v1:<iv>:<tag>:<ciphertext> without the plain number', () => {
    const stored = encryptDocumentNumber('12345678', ENCRYPTION_KEY);
    const parts = stored.split(':');
    expect(parts[0]).toBe('v1');
    expect(parts).toHaveLength(4);
    expect(Buffer.from(parts[1], 'base64')).toHaveLength(12);
    expect(stored).not.toContain('12345678');
  });

  it('throws on the wrong key or tampered data', () => {
    const stored = encryptDocumentNumber('12345678', ENCRYPTION_KEY);
    expect(() => decryptDocumentNumber(stored, HASH_KEY)).toThrow();
    const [v, iv, tag, data] = stored.split(':');
    const flipped = Buffer.from(data, 'base64');
    flipped[0] ^= 1;
    expect(() => decryptDocumentNumber([v, iv, tag, flipped.toString('base64')].join(':'), ENCRYPTION_KEY)).toThrow();
    expect(() => decryptDocumentNumber('v2:a:b:c', ENCRYPTION_KEY)).toThrow();
  });
});

describe('maskDocument', () => {
  it('masks a DNI to its last three digits', () => {
    expect(maskDocument({ type: 'DNI', country: 'AR', number: '12345678' })).toBe('DNI ···678');
  });

  it('includes the issuing country for a passport', () => {
    expect(maskDocument({ type: 'PASAPORTE', country: 'ES', number: 'XA987654321' })).toBe('PASAPORTE (ES) ···321');
  });
});

describe('parseDocumentKeys', () => {
  const valid = { DOCUMENT_ENCRYPTION_KEY: '11'.repeat(32), DOCUMENT_HASH_KEY: '22'.repeat(32) };

  it('parses two 64-hex keys', () => {
    const keys = parseDocumentKeys(valid);
    expect(keys.encryptionKey).toEqual(ENCRYPTION_KEY);
    expect(keys.hashKey).toEqual(HASH_KEY);
  });

  it.each([
    [{ ...valid, DOCUMENT_ENCRYPTION_KEY: undefined }, 'DOCUMENT_ENCRYPTION_KEY'],
    [{ ...valid, DOCUMENT_HASH_KEY: 'abc' }, 'DOCUMENT_HASH_KEY'],
    [{ ...valid, DOCUMENT_HASH_KEY: 'zz'.repeat(32) }, 'DOCUMENT_HASH_KEY'],
  ])('refuses a missing or malformed key', (env, name) => {
    expect(() => parseDocumentKeys(env)).toThrow(name);
  });

  it('refuses the same value for both keys', () => {
    expect(() => parseDocumentKeys({ ...valid, DOCUMENT_HASH_KEY: valid.DOCUMENT_ENCRYPTION_KEY })).toThrow('distinct');
  });
});
