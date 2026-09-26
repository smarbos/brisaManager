import { apiClient } from './client';

export interface AmbientDeviceReadingEntry {
  id: string;
  sensor: string;
  level: number;
  updatedAt: string;
}

export interface AmbientDeviceEntry {
  id: string;
  name: string;
  lastSeenAt: string | null;
  online: boolean;
  readings: AmbientDeviceReadingEntry[];
}

export function listAmbientDevices(): Promise<AmbientDeviceEntry[]> {
  return apiClient.request('/ambient-devices');
}
