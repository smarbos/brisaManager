import { apiClient } from './client';

export interface GoogleCalendarStatus {
  connected: boolean;
  lastSyncAt: string | null;
  lastSyncError: string | null;
}

export function getGoogleCalendarStatus(): Promise<GoogleCalendarStatus> {
  return apiClient.request('/google-calendar/status');
}

export function getGoogleCalendarConnectUrl(): Promise<{ url: string }> {
  return apiClient.request('/google-calendar/oauth/connect-url');
}

export function disconnectGoogleCalendar(): Promise<{ disconnected: boolean }> {
  return apiClient.request('/google-calendar/disconnect', { method: 'POST' });
}

export function runGoogleCalendarSync(): Promise<{ triggeredAt: string }> {
  return apiClient.request('/google-calendar/sync-now', { method: 'POST' });
}
