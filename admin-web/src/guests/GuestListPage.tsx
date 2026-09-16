import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listGuests, Guest } from '../api/guests';
import { PageContainer, PageHeader, Alert, Table, Badge, tableThClass as thClass, tableTdClass as tdClass } from '../ui';
import { formatDate } from '../lib/date';

export function GuestListPage() {
  const [guests, setGuests] = useState<Guest[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listGuests()
      .then(setGuests)
      .catch(() => setError('No se pudieron cargar los huéspedes. Por favor, recargá la página.'));
  }, []);

  return (
    <PageContainer>
      <PageHeader title="Huéspedes" />
      {error && <Alert>{error}</Alert>}
      <Table>
        <thead>
          <tr>
            <th className={thClass}>ID</th>
            <th className={thClass}>Nombre</th>
            <th className={thClass}>Email</th>
            <th className={thClass}>Teléfono</th>
            <th className={thClass}>Estadías totales</th>
            <th className={thClass}>Última estadía</th>
            <th className={thClass}>Estado</th>
          </tr>
        </thead>
        <tbody>
          {guests.map((g) => (
            <tr key={g.id}>
              <td className={tdClass}>
                <Link to={`/guests/${g.id}`} className="font-mono text-xs text-accent hover:underline">
                  {g.id}
                </Link>
              </td>
              <td className={tdClass}>
                <Link to={`/guests/${g.id}`} className="text-accent hover:underline">
                  {g.name}
                </Link>
              </td>
              <td className={tdClass}>{g.email}</td>
              <td className={tdClass}>{g.phone ?? '—'}</td>
              <td className={tdClass}>{g.totalStays}</td>
              <td className={tdClass}>{g.lastStayAt ? formatDate(g.lastStayAt) : '—'}</td>
              <td className={tdClass}>
                <Badge tone={g.unsubscribedAt ? 'warning' : 'success'}>
                  {g.unsubscribedAt ? 'Dado de baja' : 'Suscripto'}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </PageContainer>
  );
}
