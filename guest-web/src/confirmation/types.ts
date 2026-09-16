export interface GuestReservation {
  guestName: string;
  checkIn: string;
  checkOut: string;
  paxCount: number;
  totalAmount: number;
  confirmationPaymentAmount: number;
  confirmationPaymentPercentage: number;
  currency: string;
  datesConfirmedAt: string | null;
  contractAcceptedAt: string | null;
  contractAcceptedName: string | null;
  contractSnapshot: string | null;
  confirmationPaymentReceivedAt: string | null;
  depositReceivedAt: string | null;
  houseRulesText: string;
  paymentInstructions: string;
  depositInstructions: string;
  confirmationStepText: string;
  bankAccountHolder: string;
  bankCuil: string;
  bankAccountNumber: string;
  bankCbu: string;
  bankAlias: string;
  bankName: string;
  securityDepositAmount: number;
}
