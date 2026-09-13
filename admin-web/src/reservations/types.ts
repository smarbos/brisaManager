export type ReservationSource = 'BOOKING' | 'AIRBNB' | 'DIRECT' | 'OTHER';
export type ReservationStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED';

export interface Reservation {
  id: string;
  guestName: string;
  guestPhone?: string;
  guestEmail?: string;
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
}

export interface ReservationEvent {
  id: string;
  type: string;
  detail?: string | null;
  createdAt: string;
}
