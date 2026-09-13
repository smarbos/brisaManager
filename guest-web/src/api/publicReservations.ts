import { request } from './client';
import { GuestReservation } from '../confirmation/types';

export function getReservationByToken(token: string): Promise<GuestReservation> {
  return request(`/public/reservations/${token}`);
}

export function confirmDates(token: string): Promise<{ datesConfirmedAt: string }> {
  return request(`/public/reservations/${token}/confirm-dates`, { method: 'POST' });
}

export function acceptContract(token: string, fullName: string): Promise<{ contractAcceptedAt: string }> {
  return request(`/public/reservations/${token}/accept-contract`, {
    method: 'POST',
    body: JSON.stringify({ fullName }),
  });
}
