import { Injectable, Logger } from '@nestjs/common';
import { WhatsappMessageKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReservationEventsService } from '../reservation-events/reservation-events.service';
import { LatestWhatsappMessage } from './whatsapp-issues';
import {
  REJECTED_STATUS,
  isUndeliveredStatus,
  shouldApplyStatus,
} from './whatsapp-message-status';

// Which reservation a send is for, and which of its messages it is — passed by every
// caller of WhatsappService.sendTemplate() so the attempt can be tracked.
export interface WhatsappSendContext {
  reservationId: string;
  kind: WhatsappMessageKind;
}

export type WhatsappSendOutcome =
  | { accepted: true; twilioSid: string; status: string }
  | { accepted: false; errorCode: string | null; errorMessage: string };

const KIND_LABELS: Record<WhatsappMessageKind, string> = {
  CHECKIN_LINK: 'Link de check-in',
  RESERVATION_REMINDER: 'Recordatorio de reserva',
  DEPOSIT_REMINDER: 'Recordatorio de depósito',
};

@Injectable()
export class WhatsappDeliveryService {
  private readonly logger = new Logger(WhatsappDeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: ReservationEventsService,
  ) {}

  // Best-effort: tracking a send must never block or fail the send itself.
  async recordSend(
    context: WhatsappSendContext,
    outcome: WhatsappSendOutcome,
  ): Promise<void> {
    try {
      await this.prisma.whatsappMessage.create({
        data: outcome.accepted
          ? {
              reservationId: context.reservationId,
              kind: context.kind,
              twilioSid: outcome.twilioSid,
              status: outcome.status,
            }
          : {
              reservationId: context.reservationId,
              kind: context.kind,
              status: REJECTED_STATUS,
              errorCode: outcome.errorCode,
              errorMessage: outcome.errorMessage,
            },
      });
    } catch (error) {
      this.logger.error(
        `Failed to record WhatsApp ${context.kind} send for ${context.reservationId}: ${(error as Error).message}`,
      );
    }
  }

  // Applies one Twilio status callback (already signature-verified by the controller).
  // Unknown SIDs — messages sent before tracking existed, or not ours — are ignored, and so
  // is any status that wouldn't move the message forward (see shouldApplyStatus), which is
  // what makes duplicate and out-of-order callbacks harmless.
  async applyStatus(
    twilioSid: string,
    status: string,
    errorCode: string | null,
  ): Promise<void> {
    const message = await this.prisma.whatsappMessage.findUnique({
      where: { twilioSid },
    });
    if (!message || !shouldApplyStatus(message.status, status)) {
      return;
    }

    // Conditional on the status we just read, so two concurrent callbacks can't both apply
    // (and both log an undelivered event) — the loser updates nothing.
    const { count } = await this.prisma.whatsappMessage.updateMany({
      where: { id: message.id, status: message.status },
      data: { status, errorCode: errorCode ?? message.errorCode },
    });
    if (count === 0 || !isUndeliveredStatus(status)) {
      return;
    }

    const codeSuffix = errorCode ? ` (error Twilio ${errorCode})` : '';
    await this.eventsService.record(
      message.reservationId,
      'WHATSAPP_UNDELIVERED',
      `${KIND_LABELS[message.kind]}: WhatsApp no entregado${codeSuffix}`,
    );
  }

  // The most recent send of each kind, per reservation — what the admin's warnings and the
  // reservation detail page are computed from. One query for any number of reservations.
  async latestByReservation(
    reservationIds: string[],
  ): Promise<Map<string, LatestWhatsappMessage[]>> {
    const result = new Map<string, LatestWhatsappMessage[]>();
    if (reservationIds.length === 0) {
      return result;
    }

    const messages = await this.prisma.whatsappMessage.findMany({
      where: { reservationId: { in: reservationIds } },
      orderBy: { createdAt: 'desc' },
      select: {
        reservationId: true,
        kind: true,
        status: true,
        errorCode: true,
        createdAt: true,
      },
    });

    for (const { reservationId, ...message } of messages) {
      const latest = result.get(reservationId) ?? [];
      if (!latest.some((existing) => existing.kind === message.kind)) {
        latest.push(message);
      }
      result.set(reservationId, latest);
    }
    return result;
  }
}
