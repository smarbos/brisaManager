import { request } from './client';
import { GuestReservation } from '../confirmation/types';

export function getReservationByToken(token: string): Promise<GuestReservation> {
  return request(`/public/reservations/${token}`);
}

export interface ConfirmDatesInput {
  fullName: string;
  phone: string;
  email: string;
  documentType: 'DNI' | 'PASAPORTE';
  // Only sent for PASAPORTE — a DNI is always Argentine.
  documentCountry?: string;
  documentNumber: string;
  marketingConsent: boolean;
}

export function confirmDates(token: string, input: ConfirmDatesInput): Promise<{ datesConfirmedAt: string }> {
  return request(`/public/reservations/${token}/confirm-dates`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function acceptContract(token: string): Promise<{ contractAcceptedAt: string }> {
  return request(`/public/reservations/${token}/accept-contract`, { method: 'POST' });
}
