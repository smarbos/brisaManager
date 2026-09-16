import { apiClient } from './client';

export interface AppConfig {
  emailDebugMode: boolean;
}

export function getConfig(): Promise<AppConfig> {
  return apiClient.request('/config');
}
