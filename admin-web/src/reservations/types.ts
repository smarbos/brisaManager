export type ReservationSource = 'BOOKING' | 'AIRBNB' | 'DIRECT' | 'OTHER';
export type ReservationStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED';

export type WhatsappMessageKind = 'CHECKIN_LINK' | 'RESERVATION_REMINDER' | 'DEPOSIT_REMINDER';

// The latest send of one WhatsApp message kind. `status` is a Twilio MessageStatus, or
// "rejected" when Twilio refused it outright (or it never reached Twilio).
export interface WhatsappMessageStatus {
  kind: WhatsappMessageKind;
  status: string;
  errorCode: string | null;
  createdAt?: string;
}

export interface Reservation {
  id: string;
  guestName: string;
  guestPhone?: string | null;
  guestEmail?: string | null;
  checkIn: string;
  checkOut: string;
  paxCount: number;
  source: ReservationSource;
  externalReference?: string;
  totalAmount: number;
  currency: string;
  status: ReservationStatus;
  notes?: string;
  confirmationToken: string;
  datesConfirmedAt?: string | null;
  contractAcceptedAt?: string | null;
  contractAcceptedName?: string | null;
  confirmationPaymentReceivedAt?: string | null;
  depositReceivedAt?: string | null;
  depositReturnedAt?: string | null;
  confirmationEmailSentAt?: string | null;
  confirmationWhatsappSentAt?: string | null;
  finalConfirmationEmailSentAt?: string | null;
  cancellationEmailSentAt?: string | null;
  missingFromChannelAt?: string | null;
  // Computed by the API (list and detail): messages whose latest send was rejected or
  // undelivered and still matter.
  whatsappIssues?: WhatsappMessageStatus[];
  // Detail only: the latest send of each message kind.
  whatsappMessages?: WhatsappMessageStatus[];
}

export interface ReservationEvent {
  id: string;
  type: string;
  detail?: string | null;
  field?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  actor?: string | null;
  createdAt: string;
}
