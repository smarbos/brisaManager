import { apiClient } from './client';

export interface ReservationImage {
  id: string;
  reservationId: string;
  originalName: string | null;
  mimeType: string;
  sizeBytes: number;
  message: string | null;
  createdAt: string;
}

export function listReservationImages(reservationId: string): Promise<ReservationImage[]> {
  return apiClient.request(`/reservations/${reservationId}/images`);
}

export function getReservationImageBlob(reservationId: string, imageId: string): Promise<Blob> {
  return apiClient.fetchBlob(`/reservations/${reservationId}/images/${imageId}/file`);
}
