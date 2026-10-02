import { Injectable, Logger } from '@nestjs/common';
import {
  DocumentInput,
  DocumentKeys,
  NormalizedDocument,
  decryptDocumentNumber,
  encryptDocumentNumber,
  hashDocument,
  maskDocument,
  normalizeDocument,
  parseDocumentKeys,
} from './guest-documents';

export interface EncodedDocument {
  documentType: NormalizedDocument['type'];
  documentCountry: string;
  documentNumberEncrypted: string;
  documentHash: string;
}

interface StoredDocumentColumns {
  documentType: NormalizedDocument['type'] | null;
  documentCountry: string | null;
  documentNumberEncrypted: string | null;
  documentHash: string | null;
}

type WithoutSecrets<T> = Omit<T, 'documentNumberEncrypted' | 'documentHash'>;

export type DocumentListView<T> = WithoutSecrets<T> & { documentMasked: string | null; documentUnreadable: boolean };

export type DocumentDetailView<T> = DocumentListView<T> & { document: NormalizedDocument | null };

// Holds the two document keys. Parsed in the constructor, so a missing or malformed key fails
// Nest's module initialization — the API refuses to boot rather than storing documents it
// could never read back.
@Injectable()
export class DocumentCryptoService {
  private readonly logger = new Logger(DocumentCryptoService.name);
  private readonly keys: DocumentKeys;

  constructor() {
    this.keys = parseDocumentKeys(process.env);
  }

  normalize(input: DocumentInput): NormalizedDocument {
    return normalizeDocument(input);
  }

  hash(document: NormalizedDocument): string {
    return hashDocument(document, this.keys.hashKey);
  }

  // The four columns Guest and Reservation both store.
  encode(document: NormalizedDocument): EncodedDocument {
    return {
      documentType: document.type,
      documentCountry: document.country,
      documentNumberEncrypted: encryptDocumentNumber(document.number, this.keys.encryptionKey),
      documentHash: this.hash(document),
    };
  }

  // null when the stored value can't be decrypted (wrong key, corrupt data) — the caller
  // reports `documentUnreadable` instead.
  decode(stored: {
    documentType: NormalizedDocument['type'] | null;
    documentCountry: string | null;
    documentNumberEncrypted: string | null;
  }): NormalizedDocument | null {
    if (!stored.documentType || !stored.documentCountry || !stored.documentNumberEncrypted) {
      return null;
    }
    const number = decryptDocumentNumber(stored.documentNumberEncrypted, this.keys.encryptionKey);
    return { type: stored.documentType, country: stored.documentCountry, number };
  }

  mask(document: NormalizedDocument): string {
    return maskDocument(document);
  }

  // For change logs: the stored document's masked form, null when there's none, and a fixed
  // label (never the ciphertext) when it can't be decrypted.
  maskStored(row: Omit<StoredDocumentColumns, 'documentHash'>): string | null {
    try {
      const stored = this.decode(row);
      return stored ? this.mask(stored) : null;
    } catch {
      return 'documento ilegible';
    }
  }

  // Staff responses go through one of these two views, never the raw row: they drop the
  // ciphertext and hash. Lists only ever carry the masked form; detail views also carry the
  // decrypted document.
  toListView<T extends StoredDocumentColumns>(row: T): DocumentListView<T> {
    const { document: _document, ...view } = this.toDetailView(row);
    return view as unknown as DocumentListView<T>;
  }

  toDetailView<T extends StoredDocumentColumns>(row: T): DocumentDetailView<T> {
    const { documentNumberEncrypted: _encrypted, documentHash: _hash, ...rest } = row;
    let document: NormalizedDocument | null = null;
    let documentUnreadable = false;
    try {
      document = this.decode(row);
    } catch (error) {
      // Never log the ciphertext itself.
      this.logger.error(`Stored document could not be decrypted: ${(error as Error).message}`);
      documentUnreadable = true;
    }
    return { ...rest, document, documentMasked: document ? this.mask(document) : null, documentUnreadable };
  }
}
