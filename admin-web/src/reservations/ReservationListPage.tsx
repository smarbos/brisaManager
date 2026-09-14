import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listReservations } from '../api/reservations';
import { Reservation, ReservationSource, ReservationStatus } from './types';
import { PageContainer, PageHeader, Button, FormField, Select, Alert, Table, tableThClass as thClass, tableTdClass as tdClass } from '../ui';
import { formatDate } from '../lib/date';
import { sourceLabel, statusLabel } from '../lib/labels';

export function ReservationListPage() {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [source, setSource] = useState<ReservationSource | ''>('');
  const [status, setStatus] = useState<ReservationStatus | ''>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    listReservations({
      source: source || undefined,
      status: status || undefined,
    })
      .then(setReservations)
      .catch((err) => {
        console.error('Failed to load reservations', err);
        setError('No se pudieron cargar las reservas.');
      });
  }, [source, status]);

  return (
    <PageContainer>
      <PageHeader title="Reservas" />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap gap-4">
          <FormField label="Canal">
            <Select value={source} onChange={(e) => setSource(e.target.value as ReservationSource | '')}>
              <option value="">Todos</option>
              <option value="BOOKING">Booking.com</option>
              <option value="AIRBNB">Airbnb</option>
              <option value="DIRECT">Directo</option>
              <option value="OTHER">Otro</option>
            </Select>
          </FormField>
          <FormField label="Estado">
            <Select value={status} onChange={(e) => setStatus(e.target.value as ReservationStatus | '')}>
              <option value="">Todos</option>
              <option value="PENDING">Pendiente</option>
              <option value="CONFIRMED">Confirmada</option>
              <option value="CANCELLED">Cancelada</option>
              <option value="COMPLETED">Completada</option>
            </Select>
          </FormField>
        </div>
        <Link to="/reservations/new">
          <Button type="button">Nueva reserva</Button>
        </Link>
      </div>
      {error && <Alert>{error}</Alert>}
      <Table>
        <thead>
          <tr>
            <th className={thClass}>Huésped</th>
            <th className={thClass}>Check-in</th>
            <th className={thClass}>Check-out</th>
            <th className={thClass}>Canal</th>
            <th className={thClass}>Estado</th>
          </tr>
        </thead>
        <tbody>
          {reservations.map((r) => (
            <tr key={r.id}>
              <td className={tdClass}>
                <Link to={`/reservations/${r.id}`} className="text-accent hover:underline">
                  {r.guestName}
                </Link>
                {r.missingFromChannelAt && <span> ⚠ Ya no está en el calendario del canal</span>}
              </td>
              <td className={tdClass}>{formatDate(r.checkIn)}</td>
              <td className={tdClass}>{formatDate(r.checkOut)}</td>
              <td className={tdClass}>{sourceLabel(r.source)}</td>
              <td className={tdClass}>{statusLabel(r.status)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </PageContainer>
  );
}
