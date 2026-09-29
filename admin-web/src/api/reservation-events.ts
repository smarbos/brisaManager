import { apiClient } from './client';

export interface ActivityLogEntry {
  id: string;
  reservationId: string;
  type: string;
  detail: string | null;
  actor?: string | null;
  createdAt: string;
  reservation: {
    guestName: string;
    source: string;
  };
}

export function listActivityLog(): Promise<ActivityLogEntry[]> {
  return apiClient.request('/reservation-events');
}
