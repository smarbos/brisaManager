import { apiClient } from './client';

export interface AmbientDeviceReadingEntry {
  id: string;
  sensor: string;
  level: number;
  // The device's own calibrated alert threshold for this sensor - null for sensors with no
  // threshold concept (temperature, humidity).
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

export function listAmbientDevices(): Promise<AmbientDeviceEntry[]> {
  return apiClient.request('/ambient-devices');
}

// Queues a TEST_BUZZER command for the device - delivered on its next heartbeat (up to 5
// minutes later, see AmbientService.recordHeartbeat), not applied instantly.
export function testAmbientDeviceBuzzer(deviceId: string): Promise<AmbientDeviceEntry> {
  return apiClient.request(`/ambient-devices/${deviceId}/test-buzzer`, { method: 'POST' });
}
