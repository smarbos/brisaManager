import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listActivityLog, ActivityLogEntry } from '../api/reservation-events';
import { PageContainer, PageHeader, Alert, Table, tableThClass as thClass, tableTdClass as tdClass } from '../ui';
import { formatDateTime } from '../lib/date';
import { eventTypeLabel } from '../lib/labels';

export function ActivityLogPage() {
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listActivityLog()
      .then(setEntries)
      .catch(() => setError('No se pudo cargar el registro de actividad. Por favor, recargá la página.'));
  }, []);

  return (
    <PageContainer>
      <PageHeader title="Registro de actividad" />
      {error && <Alert>{error}</Alert>}
      <Table>
        <thead>
          <tr>
            <th className={thClass}>Cuándo</th>
            <th className={thClass}>Reserva</th>
            <th className={thClass}>Evento</th>
            <th className={thClass}>Detalle</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td className={tdClass}>{formatDateTime(entry.createdAt)}</td>
              <td className={tdClass}>
                <Link to={`/reservations/${entry.reservationId}`} className="text-accent hover:underline">
                  {entry.reservation.guestName}
                </Link>
              </td>
              <td className={tdClass}>{eventTypeLabel(entry.type)}</td>
              <td className={tdClass}>{entry.detail ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </PageContainer>
  );
}
