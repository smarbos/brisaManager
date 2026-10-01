import { WhatsappMessageKind } from '@prisma/client';
import { isProblemStatus } from './whatsapp-message-status';

export interface LatestWhatsappMessage {
  kind: WhatsappMessageKind;
  status: string;
  errorCode: string | null;
  createdAt: Date;
}

export interface WhatsappIssue {
  kind: WhatsappMessageKind;
  status: string;
  errorCode: string | null;
}

interface ReservationForIssues {
  checkIn: Date;
  datesConfirmedAt: Date | null;
  confirmationPaymentReceivedAt: Date | null;
}

// Whether a failed message no longer needs the guest to receive it — what it asked for
// already happened, so flagging it would only be noise.
function isMoot(
  kind: WhatsappMessageKind,
  reservation: ReservationForIssues,
  now: Date,
): boolean {
  switch (kind) {
    case 'CHECKIN_LINK':
      // The link's whole purpose is getting the guest to the check-in form.
      return reservation.datesConfirmedAt != null;
    case 'DEPOSIT_REMINDER':
      // Despite its name, this reminder chases the confirmation payment — it's only sent
      // while confirmationPaymentReceivedAt is null (see WhatsappReminderSchedulerService).
      return reservation.confirmationPaymentReceivedAt != null;
    case 'RESERVATION_REMINDER':
      return reservation.checkIn <= now;
  }
}

// One issue per message kind whose *latest* send failed, so a later successful resend of
// the same kind clears it automatically. `latest` must hold at most one message per kind.
export function computeWhatsappIssues(
  reservation: ReservationForIssues,
  latest: LatestWhatsappMessage[],
  now: Date = new Date(),
): WhatsappIssue[] {
  return latest
    .filter(
      (message) =>
        isProblemStatus(message.status) &&
        !isMoot(message.kind, reservation, now),
    )
    .map(({ kind, status, errorCode }) => ({ kind, status, errorCode }));
}
