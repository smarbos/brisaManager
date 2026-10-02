import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { DocumentCryptoService } from './document-crypto.service';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// Registered globally (see GuestDocumentsModule). Any response object that still carries the
// raw document columns — a Reservation or Guest row returned as-is by create/update/cancel and
// friends — is reduced to the masked list view, so ciphertext and hash never leave the API no
// matter which endpoint returns the row. Detail endpoints that should show the decrypted
// document convert explicitly with DocumentCryptoService.toDetailView, which this leaves alone.
@Injectable()
export class DocumentRedactionInterceptor implements NestInterceptor {
  constructor(private readonly documentCrypto: DocumentCryptoService) {}

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((body) => this.redact(body)));
  }

  redact(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.redact(item));
    }
    if (!isPlainObject(value)) {
      // Dates, Decimals, Buffers, StreamableFiles: returned untouched.
      return value;
    }
    const source =
      'documentNumberEncrypted' in value || 'documentHash' in value
        ? (this.documentCrypto.toListView({
            documentType: null,
            documentCountry: null,
            documentNumberEncrypted: null,
            documentHash: null,
            ...value,
          } as never) as Record<string, unknown>)
        : value;
    return Object.fromEntries(Object.entries(source).map(([key, item]) => [key, this.redact(item)]));
  }
}
