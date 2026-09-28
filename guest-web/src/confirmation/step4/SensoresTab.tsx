import { useEffect, useState } from 'react';
import { getAmbientReadings, AmbientDeviceEntry, AmbientDeviceReadingEntry } from '../../api/ambient';
import { Badge } from '../../ui';

// guest-web-local, deliberately not imported from admin-web's lib/labels.ts — this codebase's
// convention is per-app duplication of small UI bits, not a shared package.
const AMBIENT_SENSOR_LABELS: Record<string, string> = {
  sound: 'Sonido',
  co: 'Monóxido de carbono',
  smoke: 'Humo',
  temperature: 'Temperatura',
  humidity: 'Humedad',
};

const AMBIENT_SENSOR_UNITS: Record<string, string> = {
  temperature: '°C',
  humidity: '%',
};

// The gauge has no natural symmetric range for these sensors (a single "don't cross this"
// threshold, not a min/max comfort band) - threshold * GAUGE_MAX_MULTIPLIER sets how wide to
// draw the bar, reusing the same multiplier the firmware's buzzer emergency tier already uses
// for smoke/CO (ambient-control/include/config.h's EMERGENCY_THRESHOLD_MULTIPLIER), applied
// here uniformly to sound too purely as a display scale - no new "emergency" concept in the UI.
const GAUGE_MAX_MULTIPLIER = 2;

function ambientSensorLabel(sensor: string): string {
  return AMBIENT_SENSOR_LABELS[sensor] ?? sensor;
}

function SensorGauge({ level, threshold }: { level: number; threshold: number }) {
  const max = threshold * GAUGE_MAX_MULTIPLIER;
  const zonePercent = Math.min(100, (threshold / max) * 100);
  const dotPercent = Math.min(100, (level / max) * 100);

  return (
    <div className="relative mt-2 h-1.5 rounded-full bg-border">
      <div className="absolute inset-y-0 left-0 rounded-full bg-zone" style={{ width: `${zonePercent}%` }} />
      <div
        className="absolute top-1/2 h-3 w-3 rounded-full border-2 border-surface bg-accent"
        style={{ left: `${dotPercent}%`, transform: 'translate(-50%, -50%)' }}
      />
    </div>
  );
}

function SensorCard({ reading }: { reading: AmbientDeviceReadingEntry }) {
  const hasThreshold = reading.threshold != null;
  const isIdeal = hasThreshold && reading.level < reading.threshold!;
  const unit = AMBIENT_SENSOR_UNITS[reading.sensor];

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <p className="text-xs text-text-muted">{ambientSensorLabel(reading.sensor)}</p>
      <p className="font-heading text-2xl font-medium text-heading">
        {reading.level}
        {unit && <span className="ml-1 text-sm font-normal text-text-muted">{unit}</span>}
      </p>
      {hasThreshold && (
        <>
          <SensorGauge level={reading.level} threshold={reading.threshold!} />
          <div className="mt-2">
            <Badge tone={isIdeal ? 'success' : 'warning'}>{isIdeal ? 'Ideal' : 'Alto'}</Badge>
          </div>
        </>
      )}
    </div>
  );
}

export function SensoresTab({ token }: { token: string }) {
  const [devices, setDevices] = useState<AmbientDeviceEntry[] | null>(null);

  useEffect(() => {
    getAmbientReadings(token)
      .then(setDevices)
      .catch(() => setDevices(null));
  }, [token]);

  if (!devices || devices.length === 0) {
    return (
      <div>
        <h3 className="font-heading text-lg font-semibold text-heading">Sensores de ambiente</h3>
        <p className="mt-1 text-sm text-text-muted">Todavía no hay datos de los sensores disponibles.</p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="font-heading text-lg font-semibold text-heading">Sensores de ambiente</h3>
      <p className="mt-1 text-sm text-text-muted">Cómo está el departamento en este momento.</p>

      {devices.map((device) => (
        <div key={device.id} className="mt-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-heading">{device.name || device.id}</p>
            <Badge tone={device.online ? 'success' : 'danger'}>{device.online ? 'En línea' : 'Sin conexión'}</Badge>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-3">
            {device.readings.map((reading) => (
              <SensorCard key={reading.id} reading={reading} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
