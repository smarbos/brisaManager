import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listActivityLog, ActivityLogEntry } from '../api/reservation-events';
import { PageContainer, PageHeader, Alert, Table, tableThClass as thClass, tableTdClass as tdClass } from '../ui';
import { formatDateTime } from '../lib/date';

function formatEventType(type: string): string {
  const lower = type.toLowerCase().replaceAll('_', ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function ActivityLogPage() {
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listActivityLog()
      .then(setEntries)
      .catch(() => setError('Could not load the activity log. Please reload the page.'));
  }, []);

  return (
    <PageContainer>
      <PageHeader title="Activity Log" />
      {error && <Alert>{error}</Alert>}
      <Table>
        <thead>
          <tr>
            <th className={thClass}>When</th>
            <th className={thClass}>Reservation</th>
            <th className={thClass}>Event</th>
            <th className={thClass}>Detail</th>
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
              <td className={tdClass}>{formatEventType(entry.type)}</td>
              <td className={tdClass}>{entry.detail ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </PageContainer>
  );
}
