import { apiClient } from './client';

export interface Settings {
  houseRulesText: string;
  paymentInstructions: string;
  bookingIcalUrl: string | null;
  airbnbIcalUrl: string | null;
  lastChannelSyncAt: string | null;
  lastChannelSyncError: string | null;
}

export function getSettings(): Promise<Settings> {
  return apiClient.request('/settings');
}

export function updateSettings(settings: Settings): Promise<Settings> {
  return apiClient.request('/settings', { method: 'PUT', body: JSON.stringify(settings) });
}

export function runChannelSync(): Promise<{ triggeredAt: string }> {
  return apiClient.request('/channel-sync/run', { method: 'POST' });
}
