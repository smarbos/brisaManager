import { apiClient } from './client';

export interface AppConfig {
  debugMode: boolean;
  ambientControlEnabled: boolean;
  version: string;
}

export function getConfig(): Promise<AppConfig> {
  return apiClient.request('/config');
}
