import { apiClient } from './client';

export interface Guest {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  totalStays: number;
  lastStayAt: string | null;
  unsubscribedAt: string | null;
}

export function listGuests(): Promise<Guest[]> {
  return apiClient.request('/guests');
}
