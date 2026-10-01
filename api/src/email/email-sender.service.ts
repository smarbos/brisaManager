import { Injectable } from '@nestjs/common';
import { OutboundEmail } from '@prisma/client';

// Performs one send of an outbox entry and applies its effects — see Task 3.
@Injectable()
export class EmailSenderService {
  async send(entry: OutboundEmail): Promise<OutboundEmail> {
    throw new Error(`EmailSenderService.send not implemented (${entry.id})`);
  }

  async applyEffects(entry: OutboundEmail, outcome: 'SENT' | 'FAILED' | 'ABORTED'): Promise<void> {
    throw new Error(`EmailSenderService.applyEffects not implemented (${entry.id}, ${outcome})`);
  }
}
