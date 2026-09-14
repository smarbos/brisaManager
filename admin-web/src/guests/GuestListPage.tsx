import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listGuests, Guest } from '../api/guests';
import { PageContainer, PageHeader, Alert, Table, Badge } from '../ui';

const thClass = 'border-b border-border px-3 py-2 text-left font-semibold text-text-muted';
const tdClass = 'border-b border-border px-3 py-2';

export function GuestListPage() {
  const [guests, setGuests] = useState<Guest[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listGuests()
      .then(setGuests)
      .catch(() => setError('Could not load the guests. Please reload the page.'));
  }, []);

  return (
    <PageContainer>
      <PageHeader
        title="Guests"
        nav={
          <Link to="/" className="text-accent hover:underline">
            Reservations
          </Link>
        }
      />
      {error && <Alert>{error}</Alert>}
      <Table>
        <thead>
          <tr>
            <th className={thClass}>Name</th>
            <th className={thClass}>Email</th>
            <th className={thClass}>Phone</th>
            <th className={thClass}>Total stays</th>
            <th className={thClass}>Last stay</th>
            <th className={thClass}>Status</th>
          </tr>
        </thead>
        <tbody>
          {guests.map((g) => (
            <tr key={g.id}>
              <td className={tdClass}>{g.name}</td>
              <td className={tdClass}>{g.email}</td>
              <td className={tdClass}>{g.phone ?? '—'}</td>
              <td className={tdClass}>{g.totalStays}</td>
              <td className={tdClass}>{g.lastStayAt ? new Date(g.lastStayAt).toLocaleDateString() : '—'}</td>
              <td className={tdClass}>
                <Badge tone={g.unsubscribedAt ? 'warning' : 'success'}>
                  {g.unsubscribedAt ? 'Unsubscribed' : 'Subscribed'}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </PageContainer>
  );
}
