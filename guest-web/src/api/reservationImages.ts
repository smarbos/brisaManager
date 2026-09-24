import { request, upload } from './client';

const API_URL = import.meta.env.VITE_API_URL as string;

export interface ReservationImage {
  id: string;
  reservationId: string;
  originalName: string | null;
  mimeType: string;
  sizeBytes: number;
  message: string | null;
  createdAt: string;
}

export function listReceiptImages(token: string): Promise<ReservationImage[]> {
  return request(`/public/reservations/${token}/images`);
}

// A single submission from the payment step's "Actualizar datos de pagos" form: zero or more
// receipt images, an optional shared note, or both. The backend rejects neither being
// present — the caller (the disabled submit button) is what actually prevents that case.
export function submitPaymentUpdate(
  token: string,
  files: File[],
  message?: string,
): Promise<{ images: ReservationImage[] }> {
  const formData = new FormData();
  for (const file of files) {
    formData.append('files', file);
  }
  if (message) {
    formData.append('message', message);
  }
  return upload(`/public/reservations/${token}/images`, formData);
}

// No auth needed to build this — the token in the path is what scopes access, same as
// every other public reservation endpoint. Used directly as an <img src>.
export function receiptImageUrl(token: string, imageId: string): string {
  return `${API_URL}/public/reservations/${token}/images/${imageId}/file`;
}
