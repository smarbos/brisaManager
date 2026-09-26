import { useEffect, useState } from 'react';
import { listAmbientEvents, AmbientEventEntry } from '../api/ambient-events';
import { Alert, EmptyState, LoadingState, Table, tableThClass as thClass, tableTdClass as tdClass } from '../ui';
import { formatDateTime } from '../lib/date';
import { ambientSensorLabel } from '../lib/labels';

// Reported by an ambient-control ESP32 device whenever a sensor threshold rule fires. Every
// report lands here regardless of whether it also created a Notification (see AmbientService
// on the API side), so this is the full history rather than just the still-unread queue.
export function AmbientEventsTab() {
  const [entries, setEntries] = useState<AmbientEventEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listAmbientEvents()
      .then(setEntries)
      .catch(() => setError('No se pudieron cargar las alertas ambientales. Por favor, recargá la página.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <LoadingState />;
  }

  return (
    <>
      {error && <Alert>{error}</Alert>}
      {!error && entries.length === 0 ? (
        <EmptyState message="Todavía no se reportaron alertas ambientales." />
      ) : (
        !error && (
          <Table>
            <thead>
              <tr>
                <th className={thClass}>Cuándo</th>
                <th className={thClass}>Dispositivo</th>
                <th className={thClass}>Sensor</th>
                <th className={thClass}>Nivel</th>
                <th className={thClass}>Mensaje</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className={tdClass}>{formatDateTime(entry.createdAt)}</td>
                  <td className={tdClass}>{entry.deviceId}</td>
                  <td className={tdClass}>{ambientSensorLabel(entry.sensor)}</td>
                  <td className={tdClass}>{entry.level ?? '—'}</td>
                  <td className={tdClass}>{entry.message}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )
      )}
    </>
  );
}
