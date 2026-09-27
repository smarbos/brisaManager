import { useEffect, useState } from 'react';
import { getAmbientReadings, AmbientDeviceEntry } from '../api/ambient';
import { Badge } from '../ui';
import { formatDateTime } from '../lib/date';

// guest-web-local, deliberately not imported from admin-web's lib/labels.ts —
// this codebase's convention is per-app duplication of small UI bits, not a shared package.
const AMBIENT_SENSOR_LABELS: Record<string, string> = {
  sound: 'Sonido',
  co: 'Monóxido de carbono',
  smoke: 'Humo',
  temperature: 'Temperatura',
  humidity: 'Humedad',
};

function ambientSensorLabel(sensor: string): string {
  return AMBIENT_SENSOR_LABELS[sensor] ?? sensor;
}

// Supplementary information on a page whose primary job is the check-in wizard — a failed
// fetch (e.g. the eligibility gate rejecting a request the caller thought was eligible) hides
// this section entirely rather than showing an alert that would compete with the wizard's own.
export function AmbientStatus({ token }: { token: string }) {
  const [devices, setDevices] = useState<AmbientDeviceEntry[] | null>(null);

  useEffect(() => {
    getAmbientReadings(token)
      .then(setDevices)
      .catch(() => setDevices(null));
  }, [token]);

  if (!devices || devices.length === 0) {
    return null;
  }

  return (
    <div className="mx-auto mt-4 max-w-md rounded-xl bg-surface p-4 shadow-sm">
      <h3 className="font-heading text-sm font-semibold text-heading">Estado del alojamiento</h3>
      <div className="mt-3 flex flex-col gap-3">
        {devices.map((device) => (
          <div key={device.id}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-heading">{device.name || device.id}</p>
              <Badge tone={device.online ? 'success' : 'danger'}>{device.online ? 'En línea' : 'Sin conexión'}</Badge>
            </div>
            {device.lastSeenAt && (
              <p className="text-xs text-text-muted">Última conexión: {formatDateTime(device.lastSeenAt)}</p>
            )}
            {device.readings.length > 0 && (
              <p className="mt-1 text-sm text-text">
                {device.readings.map((reading) => `${ambientSensorLabel(reading.sensor)}: ${reading.level}`).join(' · ')}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
