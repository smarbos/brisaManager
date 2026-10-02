import { DocumentCryptoService } from './document-crypto.service';

describe('DocumentCryptoService', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  function withKeys(encryption: string | undefined, hash: string | undefined) {
    process.env = { ...originalEnv, DOCUMENT_ENCRYPTION_KEY: encryption, DOCUMENT_HASH_KEY: hash };
  }

  it('refuses to construct without keys, which fails the API at boot', () => {
    withKeys(undefined, '22'.repeat(32));
    expect(() => new DocumentCryptoService()).toThrow('DOCUMENT_ENCRYPTION_KEY');
  });

  it('encodes a document into the four stored columns and decodes it back', () => {
    withKeys('11'.repeat(32), '22'.repeat(32));
    const service = new DocumentCryptoService();
    const document = service.normalize({ type: 'DNI', number: '12.345.678' });

    const encoded = service.encode(document);

    expect(encoded.documentType).toBe('DNI');
    expect(encoded.documentCountry).toBe('AR');
    expect(encoded.documentHash).toBe(service.hash(document));
    expect(encoded.documentNumberEncrypted).not.toContain('12345678');
    expect(service.decode(encoded)).toEqual(document);
  });

  it('decodes a row with no document to null', () => {
    withKeys('11'.repeat(32), '22'.repeat(32));
    const service = new DocumentCryptoService();
    expect(service.decode({ documentType: null, documentCountry: null, documentNumberEncrypted: null })).toBeNull();
  });
});

describe('DocumentCryptoService views', () => {
  const originalEnv = process.env;
  let service: DocumentCryptoService;

  beforeEach(() => {
    process.env = { ...originalEnv, DOCUMENT_ENCRYPTION_KEY: '11'.repeat(32), DOCUMENT_HASH_KEY: '22'.repeat(32) };
    service = new DocumentCryptoService();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function row() {
    return { id: 'g1', name: 'Jane', ...service.encode(service.normalize({ type: 'DNI', number: '12345678' })) };
  }

  it('list view carries only the masked document, never ciphertext or hash', () => {
    const view = service.toListView(row());
    expect(view).toEqual({
      id: 'g1',
      name: 'Jane',
      documentType: 'DNI',
      documentCountry: 'AR',
      documentMasked: 'DNI ···678',
      documentUnreadable: false,
    });
    expect(JSON.stringify(view)).not.toContain('12345678');
  });

  it('detail view adds the decrypted document', () => {
    expect(service.toDetailView(row()).document).toEqual({ type: 'DNI', country: 'AR', number: '12345678' });
  });

  it('flags an undecryptable document instead of throwing', () => {
    const broken = { ...row(), documentNumberEncrypted: 'v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA==:AAAA' };
    const view = service.toDetailView(broken);
    expect(view.document).toBeNull();
    expect(view.documentUnreadable).toBe(true);
    expect(view).not.toHaveProperty('documentNumberEncrypted');
  });

  it('a row without a document is simply null, not unreadable', () => {
    const view = service.toDetailView({
      id: 'g1',
      documentType: null,
      documentCountry: null,
      documentNumberEncrypted: null,
      documentHash: null,
    });
    expect(view).toEqual({ id: 'g1', documentType: null, documentCountry: null, document: null, documentMasked: null, documentUnreadable: false });
  });
});
