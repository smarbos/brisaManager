import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listGuests, Guest } from '../api/guests';
import {
  PageContainer,
  PageHeader,
  Alert,
  Card,
  EmptyState,
  LoadingState,
  Table,
  Badge,
  FormField,
  Input,
  tableThClass as thClass,
  tableTdClass as tdClass,
} from '../ui';
import { formatDate } from '../lib/date';
import { shortId } from '../lib/id';

export function GuestListPage() {
  const [guests, setGuests] = useState<Guest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    listGuests()
      .then(setGuests)
      .catch(() => setError('No se pudieron cargar los huéspedes. Por favor, recargá la página.'))
      .finally(() => setLoading(false));
  }, []);

  const filteredGuests = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return guests;
    }
    return guests.filter((g) =>
      [g.name, g.email, g.phone].some((field) => field?.toLowerCase().includes(term)),
    );
  }, [guests, search]);

  return (
    <PageContainer>
      <PageHeader title="Huéspedes" subtitle="Todos los huéspedes que se alojaron o reservaron en el alojamiento." />
      {error && <Alert>{error}</Alert>}
      <Card>
        <div className="mb-4">
          <FormField label="Buscar">
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nombre, email o teléfono"
            />
          </FormField>
        </div>
        {loading ? (
          <LoadingState />
        ) : guests.length === 0 ? (
          <EmptyState message="Todavía no hay huéspedes registrados." />
        ) : filteredGuests.length === 0 ? (
          <EmptyState message="No hay huéspedes que coincidan con la búsqueda." />
        ) : (
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
            {filteredGuests.map((g) => (
              <tr key={g.id}>
                <td className={tdClass}>
                  <Link
                    to={`/guests/${g.id}`}
                    title={g.id}
                    className="font-mono text-xs text-accent hover:underline"
                  >
                    {shortId(g.id)}
                  </Link>
                </td>
                <td className={tdClass}>
                  <Link to={`/guests/${g.id}`} className="font-medium text-accent hover:underline">
                    {g.name}
                  </Link>
                </td>
                <td className={tdClass}>{g.email ?? '—'}</td>
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
        )}
      </Card>
    </PageContainer>
  );
}
