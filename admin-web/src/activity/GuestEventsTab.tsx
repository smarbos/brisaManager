import { useEffect, useState } from 'react';
import { listGuestActivityLog, GuestEventEntry } from '../api/guest-events';
import { Alert, EmptyState, LoadingState, Table, tableThClass as thClass, tableTdClass as tdClass } from '../ui';
import { formatDateTime } from '../lib/date';
import { guestEventTypeLabel } from '../lib/labels';

export function GuestEventsTab() {
  const [entries, setEntries] = useState<GuestEventEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listGuestActivityLog()
      .then(setEntries)
      .catch(() => setError('No se pudieron cargar los cambios de huéspedes. Por favor, recargá la página.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <LoadingState />;
  }

  return (
    <>
      {error && <Alert>{error}</Alert>}
      {!error && entries.length === 0 ? (
        <EmptyState message="Todavía no hay cambios de huéspedes registrados." />
      ) : (
        !error && (
          <Table>
            <thead>
              <tr>
                <th className={thClass}>Cuándo</th>
                <th className={thClass}>Huésped</th>
                <th className={thClass}>Cambio</th>
                <th className={thClass}>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className={tdClass}>{formatDateTime(entry.createdAt)}</td>
                  <td className={tdClass}>{entry.guest.name}</td>
                  <td className={tdClass}>{guestEventTypeLabel(entry.type)}</td>
                  <td className={tdClass}>{entry.detail ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )
      )}
    </>
  );
}
