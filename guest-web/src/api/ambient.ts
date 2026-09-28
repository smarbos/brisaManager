import { request } from './client';

export interface AmbientDeviceReadingEntry {
  id: string;
  sensor: string;
  level: number;
  // The device's own calibrated alert threshold for this sensor, if it has one (sound, co,
  // smoke do; temperature/humidity report null) - see SensoresTab for how this drives the
  // Ideal/Alto status chip.
  threshold: number | null;
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
