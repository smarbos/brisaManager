import { useEffect, useState } from 'react';
import {
  listAmbientDevices,
  testAmbientDeviceBuzzer,
  AmbientDeviceEntry,
  AmbientDeviceReadingEntry,
} from '../api/ambient-devices';
import { Alert, Badge, Button, Card, EmptyState, LoadingState, PageContainer, PageHeader, useTwoStepConfirm } from '../ui';
import { formatDateTime, formatRelativeTime } from '../lib/date';
import { ambientSensorLabel } from '../lib/labels';

// Polled rather than pushed, same reasoning as AppNav's unread-count badge - no
// websocket/SSE channel, and devices heartbeat every 5 minutes anyway so a short staleness
// window here doesn't hide anything meaningful.
const REFRESH_POLL_MS = 30_000;

// Real, calibrated units — only for the two sensors that actually have them (DHT22 is a real
// digital temp/humidity sensor). sound/co/smoke are uncalibrated raw ADC counts (see
// ambient-control's README "Note on MQ-7/MQ-2 accuracy") — showing a fake unit like "ppm" or
// "dB" for those would misrepresent them as calibrated measurements, so they stay unitless.
const SENSOR_UNITS: Record<string, string> = { temperature: '°C', humidity: '%' };

// co/smoke crossing their threshold is a real safety concern (danger); sound crossing its
// threshold just means "loud right now" (warning) — matches the severity ambient-control's
// own firmware already assigns each sensor's alert.
const CRITICAL_SENSORS = new Set(['co', 'smoke']);

function SensorIcon({ sensor }: { sensor: string }) {
  const paths: Record<string, string> = {
    co: 'M12 12m-8.5 0a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0 -17 0|M9 10.5a2.5 2.5 0 1 0 0 3M15.5 10.2v3.6',
    humidity: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z',
    smoke: 'M4 18c3-1 3-4 6-4s3 3 6 3M6 12c2-1 2-3.5 4.5-3.5S13 11 15 11M8 6.5c1.5-1 3-.5 4 .5',
    sound: 'M4 10v4h3l5 4V6L7 10H4z|M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11',
    temperature: 'M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0z',
  };
  const d = paths[sensor];
  if (!d) return null;
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-accent">
      {d.split('|').map((piece, i) => (
        <path key={i} d={piece} />
      ))}
    </svg>
  );
}

interface ReadingTone {
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  label: string;
}

// Only sound/co/smoke carry a calibrated threshold (see AmbientDeviceReading.threshold's own
// schema comment) — that's what turns a bare ADC count into something with a reference point.
// temperature/humidity never have one, so they just get a neutral "sin umbral" read here.
function readingTone(reading: AmbientDeviceReadingEntry, online: boolean): ReadingTone {
  if (!online) return { tone: 'neutral', label: 'Sin dato' };
  if (!reading.threshold) return { tone: 'neutral', label: 'Sin umbral' };
  if (reading.level <= reading.threshold) return { tone: 'success', label: 'Normal' };
  return { tone: CRITICAL_SENSORS.has(reading.sensor) ? 'danger' : 'warning', label: 'Alto' };
}

// Gauge range: 0 → 1.5x the calibrated threshold, with the "safe" zone shaded from 0 to the
// threshold itself — gives a reading past its threshold visible headroom on the bar instead
// of just pinning at the far edge.
function GaugeBar({ level, threshold }: { level: number; threshold: number }) {
  const max = threshold * 1.5;
  const pct = (value: number) => Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="relative my-1 h-1.5 rounded-full bg-border" aria-hidden="true">
      <div className="absolute inset-y-0 left-0 rounded-full bg-zone" style={{ width: `${pct(threshold)}%` }} />
      <div
        className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-accent shadow"
        style={{ left: `${pct(level)}%` }}
      />
    </div>
  );
}

function ReadingTile({ reading, online }: { reading: AmbientDeviceReadingEntry; online: boolean }) {
  const unit = SENSOR_UNITS[reading.sensor];
  const { tone, label } = readingTone(reading, online);
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 rounded-xl border border-border bg-surface p-3 ${online ? '' : 'opacity-40'}`}>
      <div className="flex items-center justify-between gap-2 text-xs text-text-muted">
        <span>{ambientSensorLabel(reading.sensor)}</span>
        <SensorIcon sensor={reading.sensor} />
      </div>
      <div className="font-heading text-2xl font-medium leading-none tabular-nums text-heading">
        {reading.level}
        {unit && <small className="ml-0.5 font-sans text-xs font-medium text-text-muted">{unit}</small>}
      </div>
      {reading.threshold ? (
        <GaugeBar level={reading.level} threshold={reading.threshold} />
      ) : (
        <div className="h-1.5" />
      )}
      <div>
        <Badge tone={tone}>{label}</Badge>
      </div>
    </div>
  );
}

function TestBuzzerButton({ testing, onTest }: { testing: boolean; onTest: () => void }) {
  const { armed, armedLabel, handleClick } = useTwoStepConfirm(onTest, { armedLabel: '¿Activar la sirena?' });
  return (
    <Button type="button" variant="outline" loading={testing} onClick={handleClick}>
      {armed ? armedLabel : 'Probar sirena'}
    </Button>
  );
}

function DeviceCard({
  device,
  testing,
  onTest,
}: {
  device: AmbientDeviceEntry;
  testing: boolean;
  onTest: (deviceId: string) => void;
}) {
  return (
    <Card className={`mb-5 !p-0 ${device.online ? '' : 'border-danger-bg'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3.5 p-5">
        <div className="flex items-center gap-3.5">
          <div
            className={`flex h-11 w-11 items-center justify-center rounded-xl ${
              device.online ? 'bg-bg text-accent' : 'bg-danger-bg text-danger'
            }`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <rect x="4" y="4" width="16" height="16" rx="3" />
              <circle cx="12" cy="12" r="3.5" />
              <path d="M12 8.5v-1M12 16.5v-1" />
            </svg>
          </div>
          <div>
            <div className="font-heading text-lg font-medium text-heading">{device.name || device.id}</div>
            <div className="text-sm text-text-muted">
              Última conexión:{' '}
              {device.lastSeenAt ? (
                <span title={formatDateTime(device.lastSeenAt)}>{formatRelativeTime(device.lastSeenAt)}</span>
              ) : (
                'Nunca'
              )}
            </div>
          </div>
        </div>
        <Badge tone={device.online ? 'success' : 'danger'}>{device.online ? 'En línea' : 'Sin conexión'}</Badge>
      </div>

      {!device.online && (
        <div className="mx-5 mb-1 flex gap-2.5 rounded-lg bg-danger-bg px-3.5 py-3 text-sm text-danger">
          <span aria-hidden="true">⚠</span>
          <span>
            Este dispositivo no responde. Las lecturas de abajo son las últimas recibidas y pueden no reflejar el
            estado actual del departamento.
          </span>
        </div>
      )}

      {device.readings.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 px-5 pb-1.5 pt-3.5 sm:grid-cols-3 lg:grid-cols-5">
          {device.readings.map((reading) => (
            <ReadingTile key={reading.id} reading={reading} online={device.online} />
          ))}
        </div>
      ) : (
        <p className="px-5 pb-1.5 pt-3.5 text-sm text-text-muted">Todavía no reportó ninguna lectura.</p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3.5 p-5">
        <p className="text-xs text-text-muted">
          {device.online
            ? 'Los umbrales se calibran desde el propio dispositivo (ver Serial/README de ambient-control).'
            : 'La sirena puede no sonar si el dispositivo está sin conexión.'}
        </p>
        <TestBuzzerButton testing={testing} onTest={() => onTest(device.id)} />
      </div>
    </Card>
  );
}

export function SensorsPage() {
  const [devices, setDevices] = useState<AmbientDeviceEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  function load() {
    return listAmbientDevices()
      .then((result) => {
        setDevices(result);
        setError(null);
      })
      .catch(() => setError('No se pudieron cargar los dispositivos. Por favor, recargá la página.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, REFRESH_POLL_MS);
    return () => clearInterval(interval);
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function handleTestBuzzer(deviceId: string) {
    setTestingId(deviceId);
    setError(null);
    setNotice(null);
    try {
      await testAmbientDeviceBuzzer(deviceId);
      // The command is only delivered on the device's next heartbeat, not applied instantly -
      // see AmbientService.recordHeartbeat.
      setNotice('Comando enviado. Sonará en el próximo heartbeat del dispositivo (hasta 5 minutos).');
    } catch {
      setError('No se pudo enviar el comando. Por favor, intentá de nuevo.');
    } finally {
      setTestingId(null);
    }
  }

  const online = devices.filter((d) => d.online).length;
  const offline = devices.length - online;

  return (
    <PageContainer>
      <PageHeader
        title="Sensores"
        subtitle="Dispositivos ambient-control: última conexión y última lectura de cada sensor."
        nav={
          <Button type="button" variant="secondary" loading={refreshing} onClick={handleRefresh}>
            Actualizar
          </Button>
        }
      />
      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      {loading ? (
        <Card>
          <LoadingState />
        </Card>
      ) : devices.length === 0 ? (
        <Card>
          <EmptyState message="Todavía no se conectó ningún dispositivo." />
        </Card>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-3 gap-3.5">
            <Card className="!p-4">
              <div className="mb-1.5 text-xs text-text-muted">Dispositivos</div>
              <div className="font-heading text-2xl font-medium text-heading">{devices.length}</div>
            </Card>
            <Card className="!p-4">
              <div className="mb-1.5 text-xs text-text-muted">En línea</div>
              <div className={`font-heading text-2xl font-medium ${online > 0 ? 'text-success' : 'text-heading'}`}>
                {online}
              </div>
            </Card>
            <Card className="!p-4">
              <div className="mb-1.5 text-xs text-text-muted">Sin conexión</div>
              <div className={`font-heading text-2xl font-medium ${offline > 0 ? 'text-danger' : 'text-heading'}`}>
                {offline}
              </div>
            </Card>
          </div>
          {devices.map((device) => (
            <DeviceCard key={device.id} device={device} testing={testingId === device.id} onTest={handleTestBuzzer} />
          ))}
        </>
      )}
    </PageContainer>
  );
}
