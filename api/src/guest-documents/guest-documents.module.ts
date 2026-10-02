import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DocumentCryptoService } from './document-crypto.service';
import { DocumentRedactionInterceptor } from './document-redaction.interceptor';

// Global so every write path (guests, check-in, staff reservations) and every staff response
// shares one instance — and so a missing key fails boot once, wherever it's first needed.
@Global()
@Module({
  providers: [DocumentCryptoService, { provide: APP_INTERCEPTOR, useClass: DocumentRedactionInterceptor }],
  exports: [DocumentCryptoService],
})
export class GuestDocumentsModule {}
