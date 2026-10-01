import { apiClient } from './client';
import { Reservation, ReservationEvent, ReservationSource, ReservationStatus } from '../reservations/types';

export interface ReservationFilters {
  source?: ReservationSource;
  status?: ReservationStatus;
}

export function listReservations(filters: ReservationFilters = {}): Promise<Reservation[]> {
  const params = new URLSearchParams();
  if (filters.source) params.set('source', filters.source);
  if (filters.status) params.set('status', filters.status);
  const query = params.toString();
  return apiClient.request(`/reservations${query ? `?${query}` : ''}`);
}

export type ReservationInput = Omit<Reservation, 'id' | 'status' | 'confirmationToken'> & {
  status?: Reservation['status'];
};

export function getReservation(id: string): Promise<Reservation> {
  return apiClient.request(`/reservations/${id}`);
}

export function createReservation(input: ReservationInput): Promise<Reservation> {
  return apiClient.request('/reservations', { method: 'POST', body: JSON.stringify(input) });
}

export function updateReservation(id: string, input: Partial<ReservationInput>): Promise<Reservation> {
  return apiClient.request(`/reservations/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function markPaymentReceived(id: string): Promise<Reservation> {
  return apiClient.request(`/reservations/${id}/mark-payment-received`, { method: 'POST' });
}

export function markDepositReceived(id: string): Promise<Reservation> {
  return apiClient.request(`/reservations/${id}/mark-deposit-received`, { method: 'POST' });
}

export function markDepositReturned(id: string): Promise<Reservation> {
  return apiClient.request(`/reservations/${id}/mark-deposit-returned`, { method: 'POST' });
}

export function cancelReservation(id: string): Promise<Reservation> {
  return apiClient.request(`/reservations/${id}/cancel`, { method: 'POST' });
}

export interface ResendEmailResult {
  sent: boolean;
  reservation: Reservation;
}

export function resendInitialEmail(id: string): Promise<ResendEmailResult> {
  return apiClient.request(`/reservations/${id}/resend-initial-email`, { method: 'POST' });
}

export function sendInitialWhatsapp(id: string): Promise<ResendEmailResult> {
  return apiClient.request(`/reservations/${id}/send-initial-whatsapp`, { method: 'POST' });
}

export function resendFinalEmail(id: string): Promise<ResendEmailResult> {
  return apiClient.request(`/reservations/${id}/resend-final-email`, { method: 'POST' });
}

export function resendCancellationEmail(id: string): Promise<ResendEmailResult> {
  return apiClient.request(`/reservations/${id}/resend-cancellation-email`, { method: 'POST' });
}

export function listReservationEvents(id: string): Promise<ReservationEvent[]> {
  return apiClient.request(`/reservations/${id}/events`);
}

export function checkOverlap(checkIn: string, checkOut: string, excludeId?: string): Promise<Reservation[]> {
  const params = new URLSearchParams({ checkIn, checkOut });
  if (excludeId) {
    params.set('excludeId', excludeId);
  }
  return apiClient.request(`/reservations/check-overlap?${params.toString()}`);
}
