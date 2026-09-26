import { apiClient } from './client';

export type NotificationType =
  | 'CALENDAR_MISMATCH'
  | 'PAYMENT_RECEIPT_UPLOADED'
  | 'GUEST_MESSAGE'
  | 'AMBIENT_ALERT'
  | 'DEVICE_OFFLINE';

export interface Notification {
  id: string;
  type: NotificationType;
  message: string;
  reservationId: string | null;
  reservation: { id: string; guestName: string } | null;
  readAt: string | null;
  createdAt: string;
}

export function listNotifications(): Promise<Notification[]> {
  return apiClient.request('/notifications');
}

export function getUnreadNotificationCount(): Promise<{ count: number }> {
  return apiClient.request('/notifications/unread-count');
}

export function markNotificationRead(id: string): Promise<Notification> {
  return apiClient.request(`/notifications/${id}/read`, { method: 'POST' });
}
