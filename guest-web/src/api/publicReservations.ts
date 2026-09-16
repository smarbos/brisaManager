import { request } from './client';
import { GuestReservation } from '../confirmation/types';

export function getReservationByToken(token: string): Promise<GuestReservation> {
  return request(`/public/reservations/${token}`);
}

export function confirmDates(
  token: string,
  fullName: string,
  phone: string,
  email: string,
): Promise<{ datesConfirmedAt: string }> {
  return request(`/public/reservations/${token}/confirm-dates`, {
    method: 'POST',
    body: JSON.stringify({ fullName, phone, email }),
  });
}

export function acceptContract(token: string): Promise<{ contractAcceptedAt: string }> {
  return request(`/public/reservations/${token}/accept-contract`, { method: 'POST' });
}
