import { request } from './client';

export interface AppConfig {
  debugMode: boolean;
}

export function getConfig(): Promise<AppConfig> {
  return request('/config');
}
