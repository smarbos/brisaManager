import { apiClient } from './client';

export interface GuestEventEntry {
  id: string;
  guestId: string;
  type: string;
  detail: string | null;
  field?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  actor?: string | null;
  createdAt: string;
  guest: {
    name: string;
    email: string | null;
  };
}

export function listGuestActivityLog(): Promise<GuestEventEntry[]> {
  return apiClient.request('/guest-events');
}
