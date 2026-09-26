import { useEffect, useState } from 'react';
import { listAmbientDevices, AmbientDeviceEntry } from '../api/ambient-devices';
import {
  PageContainer,
  PageHeader,
  Alert,
  Badge,
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

function readingsSummary(device: AmbientDeviceEntry): string {
  if (device.readings.length === 0) {
    return '—';
  }
  return device.readings.map((reading) => `${ambientSensorLabel(reading.sensor)}: ${reading.level}`).join(' · ');
}

export function SensorsPage() {
  const [devices, setDevices] = useState<AmbientDeviceEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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

  return (
    <PageContainer>
      <PageHeader
        title="Sensores"
        subtitle="Dispositivos ambient-control: última conexión y última lectura de cada sensor."
      />
      {error && <Alert>{error}</Alert>}
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
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </PageContainer>
  );
}
