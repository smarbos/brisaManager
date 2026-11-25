import { request } from './client';

export interface AppConfig {
  debugMode: boolean;
  // Off: no Sensores tab (the API's sensor endpoint answers 404 anyway).
  ambientControlEnabled: boolean;
}

export function getConfig(): Promise<AppConfig> {
  return request('/config');
}
