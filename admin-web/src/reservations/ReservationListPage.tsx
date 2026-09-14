import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listReservations } from '../api/reservations';
import { Reservation, ReservationSource, ReservationStatus } from './types';
import { PageContainer, PageHeader, Button, FormField, Select, Alert, Table, tableThClass as thClass, tableTdClass as tdClass } from '../ui';

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
        setError('Could not load the reservations');
      });
  }, [source, status]);

  return (
    <PageContainer>
      <PageHeader title="Reservations" />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap gap-4">
          <FormField label="Source">
            <Select value={source} onChange={(e) => setSource(e.target.value as ReservationSource | '')}>
              <option value="">All</option>
              <option value="BOOKING">Booking.com</option>
              <option value="AIRBNB">Airbnb</option>
              <option value="DIRECT">Direct</option>
              <option value="OTHER">Other</option>
            </Select>
          </FormField>
          <FormField label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value as ReservationStatus | '')}>
              <option value="">All</option>
              <option value="PENDING">Pending</option>
              <option value="CONFIRMED">Confirmed</option>
              <option value="CANCELLED">Cancelled</option>
              <option value="COMPLETED">Completed</option>
            </Select>
          </FormField>
        </div>
        <Link to="/reservations/new">
          <Button type="button">New reservation</Button>
        </Link>
      </div>
      {error && <Alert>{error}</Alert>}
      <Table>
        <thead>
          <tr>
            <th className={thClass}>Guest</th>
            <th className={thClass}>Check-in</th>
            <th className={thClass}>Check-out</th>
            <th className={thClass}>Source</th>
            <th className={thClass}>Status</th>
          </tr>
        </thead>
        <tbody>
          {reservations.map((r) => (
            <tr key={r.id}>
              <td className={tdClass}>
                <Link to={`/reservations/${r.id}`} className="text-accent hover:underline">
                  {r.guestName}
                </Link>
                {r.missingFromChannelAt && <span> ⚠ No longer in channel feed</span>}
              </td>
              <td className={tdClass}>{r.checkIn}</td>
              <td className={tdClass}>{r.checkOut}</td>
              <td className={tdClass}>{r.source}</td>
              <td className={tdClass}>{r.status}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </PageContainer>
  );
}
