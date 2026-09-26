import { apiClient } from './client';

export interface AmbientEventEntry {
  id: string;
  deviceId: string;
  sensor: string;
  level: number | null;
  message: string;
  createdAt: string;
}

export function listAmbientEvents(): Promise<AmbientEventEntry[]> {
  return apiClient.request('/ambient-alerts');
}
