import { Reservation, ReservationSource } from '@prisma/client';

// Which payments a reservation asks the guest to transfer to us. Decided per reservation:
// the channel only sets the starting point, and staff can change it from the admin or from the
// Chrome extension's review panel.
export type PaymentRequests = Pick<Reservation, 'askForPayment' | 'askForDeposit'>;

export function defaultPaymentRequests(source: ReservationSource): PaymentRequests {
  const asked = source === 'BOOKING';
  return { askForPayment: asked, askForDeposit: asked };
}

// Nothing that was asked for is still missing. True when nothing is asked for at all, so on its
// own it never means the guest has done anything — see isOnboardingComplete().
export function paymentsSettled(
  reservation: PaymentRequests & Pick<Reservation, 'confirmationPaymentReceivedAt' | 'depositReceivedAt'>,
): boolean {
  return (
    (!reservation.askForPayment || reservation.confirmationPaymentReceivedAt != null) &&
    (!reservation.askForDeposit || reservation.depositReceivedAt != null)
  );
}

// The guest finished every step: checked in, accepted the rules, and settled what was asked for.
export function isOnboardingComplete(
  reservation: Parameters<typeof paymentsSettled>[0] & Pick<Reservation, 'datesConfirmedAt' | 'contractAcceptedAt'>,
): boolean {
  return Boolean(reservation.datesConfirmedAt && reservation.contractAcceptedAt && paymentsSettled(reservation));
}
