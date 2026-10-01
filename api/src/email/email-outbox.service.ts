import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OutboundEmail, OutboundEmailKind, OutboundEmailStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailSenderService } from './email-sender.service';

const DEFAULT_SEND_DELAY_MS = 5 * 60 * 1000;
const PAGE_SIZE = 50;

export interface EnqueueInput {
  kind: OutboundEmailKind;
  to: string;
  subject: string;
  html?: string;
  replyTo?: string | null;
  reservationId?: string | null;
  campaignRecipientId?: string | null;
  inboundEmailId?: string | null;
  resentFromId?: string | null;
  sendAt?: Date;
}

// Read at call time so EMAIL_SEND_DELAY_MS can be changed per environment (and per test).
export function sendDelayMs(): number {
  const configured = Number(process.env.EMAIL_SEND_DELAY_MS);
  return Number.isFinite(configured) && configured >= 0 && process.env.EMAIL_SEND_DELAY_MS
    ? configured
    : DEFAULT_SEND_DELAY_MS;
}

// Every outgoing email waits here before it's sent — see
// docs/superpowers/specs/2026-10-01-email-outbox-design.md. This service creates entries and
// moves them between states on the operator's request; EmailDispatcherService sends the ones
// that are due, and EmailSenderService performs each send.
@Injectable()
export class EmailOutboxService {
  private readonly logger = new Logger(EmailOutboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: EmailSenderService,
  ) {}

  enqueue(input: EnqueueInput): Promise<OutboundEmail> {
    const { sendAt, ...rest } = input;
    return this.prisma.outboundEmail.create({
      data: { ...rest, sendAt: sendAt ?? new Date(Date.now() + sendDelayMs()) },
    });
  }

  async get(id: string): Promise<OutboundEmail> {
    const entry = await this.prisma.outboundEmail.findUnique({ where: { id } });
    if (!entry) {
      throw new NotFoundException(`Email ${id} not found`);
    }
    return entry;
  }

  list(filter: { status?: OutboundEmailStatus; reservationId?: string; page?: number }): Promise<OutboundEmail[]> {
    const page = filter.page && filter.page > 1 ? filter.page : 1;
    return this.prisma.outboundEmail.findMany({
      where: {
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.reservationId ? { reservationId: filter.reservationId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    });
  }

  // An email received by Resend (webhook email.received) is forwarded to the staff mailbox
  // right away — no 5-minute wait — but still through the outbox, so a failed forward can be
  // retried from the admin. A repeated delivery of the same email (Resend retries webhooks) is
  // ignored.
  async forwardInbound(email: { email_id: string; from: string; subject: string }): Promise<OutboundEmail | null> {
    const forwardTo = process.env.EMAIL_FORWARD_TO;
    if (!forwardTo) {
      this.logger.warn(`Received email ${email.email_id} but EMAIL_FORWARD_TO is not set — not forwarded.`);
      return null;
    }
    const existing = await this.prisma.outboundEmail.findFirst({ where: { inboundEmailId: email.email_id } });
    if (existing) {
      return existing;
    }

    const entry = await this.enqueue({
      kind: 'INBOUND_FORWARD',
      to: forwardTo,
      subject: `Fwd: ${email.subject} (de ${email.from})`,
      inboundEmailId: email.email_id,
      sendAt: new Date(),
    });
    const { count } = await this.prisma.outboundEmail.updateMany({
      where: { id: entry.id, status: 'SCHEDULED' },
      data: { status: 'SENDING' },
    });
    // Otherwise the dispatcher claimed it first and is sending it.
    return count === 1 ? this.sender.send(await this.get(entry.id)) : entry;
  }

  // Only a still-waiting email can be aborted. The conditional update makes this safe against
  // the dispatcher claiming the same entry at the same moment: exactly one of them wins.
  async abort(id: string): Promise<OutboundEmail> {
    await this.get(id);
    const { count } = await this.prisma.outboundEmail.updateMany({
      where: { id, status: 'SCHEDULED' },
      data: { status: 'ABORTED', abortedAt: new Date() },
    });
    if (count === 0) {
      throw new ConflictException('Este email ya no está programado: no se puede abortar.');
    }
    const aborted = await this.get(id);
    await this.sender.applyEffects(aborted, 'ABORTED');
    return aborted;
  }

  // A failed email is re-attempted right away, without a new delay — the operator decided.
  async retry(id: string): Promise<OutboundEmail> {
    await this.get(id);
    const { count } = await this.prisma.outboundEmail.updateMany({
      where: { id, status: 'FAILED' },
      data: { status: 'SENDING' },
    });
    if (count === 0) {
      throw new ConflictException('Solo se puede reintentar un email que falló.');
    }
    return this.sender.send(await this.get(id));
  }

  // A new copy that waits the full delay again, so it can still be aborted. The campaign link
  // isn't copied: a campaign recipient has exactly one outbox entry (unique), its original.
  async resend(id: string): Promise<OutboundEmail> {
    const original = await this.get(id);
    if (original.status === 'SCHEDULED' || original.status === 'SENDING') {
      throw new ConflictException('Este email todavía no terminó: abortalo o esperá a que se envíe.');
    }
    return this.enqueue({
      kind: original.kind,
      to: original.to,
      subject: original.subject,
      html: original.html,
      replyTo: original.replyTo,
      reservationId: original.reservationId,
      campaignRecipientId: null,
      inboundEmailId: original.inboundEmailId,
      resentFromId: original.id,
    });
  }
}
