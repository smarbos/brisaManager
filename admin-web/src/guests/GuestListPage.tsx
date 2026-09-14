import { useEffect, useState } from 'react';
import { listGuests, Guest } from '../api/guests';
import { PageContainer, PageHeader, Alert, Table, Badge, tableThClass as thClass, tableTdClass as tdClass } from '../ui';
import { formatDate } from '../lib/date';

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
      <PageHeader title="Guests" />
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
              <td className={tdClass}>{g.lastStayAt ? formatDate(g.lastStayAt) : '—'}</td>
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
