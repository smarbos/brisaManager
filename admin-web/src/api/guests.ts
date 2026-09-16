import { apiClient } from './client';
import { Reservation } from '../reservations/types';

export interface Guest {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  totalStays: number;
  lastStayAt: string | null;
  unsubscribedAt: string | null;
}

export interface GuestWithReservations extends Guest {
  reservations: Reservation[];
}

export function listGuests(): Promise<Guest[]> {
  return apiClient.request('/guests');
}

export function getGuest(id: string): Promise<GuestWithReservations> {
  return apiClient.request(`/guests/${id}`);
}
