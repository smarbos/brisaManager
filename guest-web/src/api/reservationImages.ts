import { request, upload } from './client';

const API_URL = import.meta.env.VITE_API_URL as string;

export interface ReservationImage {
  id: string;
  reservationId: string;
  originalName: string | null;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export function listReceiptImages(token: string): Promise<ReservationImage[]> {
  return request(`/public/reservations/${token}/images`);
}

export function uploadReceiptImage(token: string, file: File): Promise<ReservationImage> {
  const formData = new FormData();
  formData.append('file', file);
  return upload(`/public/reservations/${token}/images`, formData);
}

// No auth needed to build this — the token in the path is what scopes access, same as
// every other public reservation endpoint. Used directly as an <img src>.
export function receiptImageUrl(token: string, imageId: string): string {
  return `${API_URL}/public/reservations/${token}/images/${imageId}/file`;
}
