import { apiClient } from './client';

export interface ExtractedReservationFields {
  guestName: string | null;
  checkIn: string | null;
  checkOut: string | null;
  paxCount: number | null;
  externalReference: string | null;
}

export function parseScreenshot(file: File): Promise<ExtractedReservationFields> {
  const formData = new FormData();
  formData.append('file', file);
  return apiClient.upload('/reservation-import/parse-screenshot', formData);
}
