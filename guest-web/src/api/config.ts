import { request } from './client';

export interface AppConfig {
  emailDebugMode: boolean;
}

export function getConfig(): Promise<AppConfig> {
  return request('/config');
}
