import { useEffect, useState } from 'react';
import { listAmbientDevices, testAmbientDeviceBuzzer, AmbientDeviceEntry } from '../api/ambient-devices';
import {
  PageContainer,
  PageHeader,
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  LoadingState,
  Table,
  tableThClass as thClass,
  tableTdClass as tdClass,
} from '../ui';
import { formatDateTime, formatRelativeTime } from '../lib/date';
import { ambientSensorLabel } from '../lib/labels';

// Polled rather than pushed, same reasoning as AppNav's unread-count badge - no
// websocket/SSE channel, and devices heartbeat every 5 minutes anyway so a short staleness
// window here doesn't hide anything meaningful.
const REFRESH_POLL_MS = 30_000;

// Raw sensor readings are uncalibrated ADC counts (0-4095) with no real-world unit - "1242"
// means nothing on its own. Showing it against the device's own calibrated alert threshold
// (e.g. "1242 / 2500 (50%)") gives it a reference point a human can actually reason about,
// without needing real ppm calibration this hardware can't provide (see ambient-control's
// README "Note on MQ-7/MQ-2 accuracy"). Sensors with no threshold concept (temperature,
// humidity) just show the bare reading, same as before.
function formatReading(reading: { level: number; threshold: number | null }): string {
  if (!reading.threshold) {
    return String(reading.level);
  }
  const percent = Math.round((reading.level / reading.threshold) * 100);
  return `${reading.level} / ${reading.threshold} (${percent}%)`;
}

function readingsSummary(device: AmbientDeviceEntry): string {
  if (device.readings.length === 0) {
    return '—';
  }
  return device.readings
    .map((reading) => `${ambientSensorLabel(reading.sensor)}: ${formatReading(reading)}`)
    .join(' · ');
}

export function SensorsPage() {
  const [devices, setDevices] = useState<AmbientDeviceEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [testingId, setTestingId] = useState<string | null>(null);

  function load() {
    listAmbientDevices()
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

  return (
    <PageContainer>
      <PageHeader
        title="Sensores"
        subtitle="Dispositivos ambient-control: última conexión y última lectura de cada sensor."
      />
      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      <Card>
        {loading ? (
          <LoadingState />
        ) : devices.length === 0 ? (
          <EmptyState message="Todavía no se conectó ningún dispositivo." />
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={thClass}>Dispositivo</th>
                <th className={thClass}>Estado</th>
                <th className={thClass}>Última conexión</th>
                <th className={thClass}>Últimas lecturas</th>
                <th className={thClass}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((device) => (
                <tr key={device.id}>
                  <td className={tdClass}>{device.name || device.id}</td>
                  <td className={tdClass}>
                    <Badge tone={device.online ? 'success' : 'danger'}>{device.online ? 'En línea' : 'Sin conexión'}</Badge>
                  </td>
                  <td className={tdClass}>
                    {device.lastSeenAt ? (
                      <span title={formatDateTime(device.lastSeenAt)}>{formatRelativeTime(device.lastSeenAt)}</span>
                    ) : (
                      'Nunca'
                    )}
                  </td>
                  <td className={tdClass}>{readingsSummary(device)}</td>
                  <td className={tdClass}>
                    <Button
                      type="button"
                      variant="secondary"
                      loading={testingId === device.id}
                      onClick={() => handleTestBuzzer(device.id)}
                    >
                      Probar sirena
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </PageContainer>
  );
}
