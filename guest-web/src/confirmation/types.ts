export interface GuestReservation {
  guestName: string;
  checkIn: string;
  checkOut: string;
  paxCount: number;
  totalAmount: number;
  confirmationPaymentAmount: number;
  currency: string;
  datesConfirmedAt: string | null;
  contractAcceptedAt: string | null;
  contractAcceptedName: string | null;
  confirmationPaymentReceivedAt: string | null;
  depositReceivedAt: string | null;
  houseRulesText: string;
  paymentInstructions: string;
}
