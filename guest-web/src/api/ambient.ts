import { request } from './client';

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

export function getAmbientReadings(token: string): Promise<AmbientDeviceEntry[]> {
  return request(`/public/reservations/${token}/ambient`);
}
