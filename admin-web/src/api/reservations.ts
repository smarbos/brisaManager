import { apiClient } from './client';
import { Reservation, ReservationSource, ReservationStatus } from '../reservations/types';

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

export type ReservationInput = Omit<Reservation, 'id' | 'status'> & { status?: Reservation['status'] };

export function getReservation(id: string): Promise<Reservation> {
  return apiClient.request(`/reservations/${id}`);
}

export function createReservation(input: ReservationInput): Promise<Reservation> {
  return apiClient.request('/reservations', { method: 'POST', body: JSON.stringify(input) });
}

export function updateReservation(id: string, input: Partial<ReservationInput>): Promise<Reservation> {
  return apiClient.request(`/reservations/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}
