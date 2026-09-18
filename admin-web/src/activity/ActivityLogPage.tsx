import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listActivityLog, ActivityLogEntry } from '../api/reservation-events';
import {
  PageContainer,
  PageHeader,
  Alert,
  Card,
  EmptyState,
  FormField,
  Input,
  LoadingState,
  Select,
  Table,
  tableThClass as thClass,
  tableTdClass as tdClass,
} from '../ui';
import { formatDateTime } from '../lib/date';
import { eventTypeLabel } from '../lib/labels';

export function ActivityLogPage() {
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [eventType, setEventType] = useState('');
  const [guestSearch, setGuestSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    listActivityLog()
      .then(setEntries)
      .catch(() => setError('No se pudo cargar el registro de actividad. Por favor, recargá la página.'))
      .finally(() => setLoading(false));
  }, []);

  const eventTypeOptions = useMemo(() => {
    const types = Array.from(new Set(entries.map((entry) => entry.type)));
    return types.sort((a, b) => eventTypeLabel(a).localeCompare(eventTypeLabel(b)));
  }, [entries]);

  const filteredEntries = useMemo(() => {
    const guestTerm = guestSearch.trim().toLowerCase();
    const from = dateFrom ? new Date(`${dateFrom}T00:00:00`) : null;
    const to = dateTo ? new Date(`${dateTo}T23:59:59.999`) : null;

    return entries.filter((entry) => {
      if (eventType && entry.type !== eventType) {
        return false;
      }
      if (guestTerm && !entry.reservation.guestName.toLowerCase().includes(guestTerm)) {
        return false;
      }
      const createdAt = new Date(entry.createdAt);
      if (from && createdAt < from) {
        return false;
      }
      if (to && createdAt > to) {
        return false;
      }
      return true;
    });
  }, [entries, eventType, guestSearch, dateFrom, dateTo]);

  return (
    <PageContainer>
      <PageHeader title="Registro de actividad" subtitle="Todos los eventos registrados en las reservas del alojamiento." />
      {error && <Alert>{error}</Alert>}
      <Card>
        <div className="mb-4 flex flex-wrap gap-4">
          <FormField label="Huésped">
            <Input
              type="search"
              value={guestSearch}
              onChange={(e) => setGuestSearch(e.target.value)}
              placeholder="Nombre del huésped"
            />
          </FormField>
          <FormField label="Tipo de evento">
            <Select value={eventType} onChange={(e) => setEventType(e.target.value)}>
              <option value="">Todos</option>
              {eventTypeOptions.map((type) => (
                <option key={type} value={type}>
                  {eventTypeLabel(type)}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Desde">
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </FormField>
          <FormField label="Hasta">
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </FormField>
        </div>
        {loading ? (
          <LoadingState />
        ) : entries.length === 0 ? (
          <EmptyState message="Todavía no hay eventos registrados." />
        ) : filteredEntries.length === 0 ? (
          <EmptyState message="No hay eventos que coincidan con estos filtros." />
        ) : (
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
            {filteredEntries.map((entry) => (
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
        )}
      </Card>
    </PageContainer>
  );
}
