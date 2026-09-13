import { apiClient } from './client';

export interface Settings {
  houseRulesText: string;
  paymentInstructions: string;
}

export function getSettings(): Promise<Settings> {
  return apiClient.request('/settings');
}

export function updateSettings(settings: Settings): Promise<Settings> {
  return apiClient.request('/settings', { method: 'PUT', body: JSON.stringify(settings) });
}
