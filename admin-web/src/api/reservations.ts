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
