import { apiClient } from './client';
import { DocumentFields, DocumentType, Reservation } from '../reservations/types';

export interface Guest {
  id: string;
  email: string | null;
  name: string;
  phone: string | null;
  totalStays: number;
  lastStayAt: string | null;
  unsubscribedAt: string | null;
  // When the guest ticked the check-in form's marketing opt-in; null means no consent.
  marketingConsentAt?: string | null;
}

export type GuestWithDocument = Guest & DocumentFields;

export interface GuestWithReservations extends GuestWithDocument {
  reservations: Reservation[];
}

export interface GuestDocumentSearch {
  documentType: DocumentType;
  documentCountry?: string;
  document: string;
}

// With a search, the API hashes the document and returns only the exact match.
export function listGuests(search?: GuestDocumentSearch): Promise<GuestWithDocument[]> {
  if (!search) {
    return apiClient.request('/guests');
  }
  const params = new URLSearchParams({ documentType: search.documentType, document: search.document });
  if (search.documentCountry) {
    params.set('documentCountry', search.documentCountry);
  }
  return apiClient.request(`/guests?${params.toString()}`);
}

export function getGuest(id: string): Promise<GuestWithReservations> {
  return apiClient.request(`/guests/${id}`);
}

export interface GuestEvent {
  id: string;
  guestId: string;
  type: string;
  detail: string | null;
  field?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  actor?: string | null;
  createdAt: string;
}

export function listGuestEvents(id: string): Promise<GuestEvent[]> {
  return apiClient.request(`/guests/${id}/events`);
}
