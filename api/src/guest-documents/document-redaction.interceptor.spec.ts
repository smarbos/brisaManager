import { DocumentCryptoService } from './document-crypto.service';
import { DocumentRedactionInterceptor } from './document-redaction.interceptor';

describe('DocumentRedactionInterceptor', () => {
  const originalEnv = process.env;
  let crypto: DocumentCryptoService;
  let interceptor: DocumentRedactionInterceptor;

  beforeEach(() => {
    process.env = { ...originalEnv, DOCUMENT_ENCRYPTION_KEY: '11'.repeat(32), DOCUMENT_HASH_KEY: '22'.repeat(32) };
    crypto = new DocumentCryptoService();
    interceptor = new DocumentRedactionInterceptor(crypto);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('masks rows nested anywhere in a response and drops ciphertext and hash', () => {
    const row = { id: 'r1', checkIn: new Date('2026-01-01'), ...crypto.encode(crypto.normalize({ type: 'DNI', number: '12345678' })) };

    const result = interceptor.redact({ sent: true, reservation: row, list: [row] }) as Record<string, any>;

    expect(result.reservation).toMatchObject({ id: 'r1', documentMasked: 'DNI ···678' });
    expect(result.reservation.checkIn).toBeInstanceOf(Date);
    expect(result.list[0].documentMasked).toBe('DNI ···678');
    expect(JSON.stringify(result)).not.toMatch(/documentHash|documentNumberEncrypted|12345678/);
  });

  it('leaves already-converted detail views and unrelated values alone', () => {
    const detail = crypto.toDetailView({ id: 'g1', ...crypto.encode(crypto.normalize({ type: 'DNI', number: '12345678' })) });
    const buffer = Buffer.from('x');

    expect(interceptor.redact(detail)).toEqual(detail);
    expect(interceptor.redact(buffer)).toBe(buffer);
    expect(interceptor.redact(null)).toBeNull();
  });
});
