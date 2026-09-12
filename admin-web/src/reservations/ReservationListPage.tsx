import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listReservations } from '../api/reservations';
import { Reservation, ReservationSource, ReservationStatus } from './types';

export function ReservationListPage() {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [source, setSource] = useState<ReservationSource | ''>('');
  const [status, setStatus] = useState<ReservationStatus | ''>('');

  useEffect(() => {
    listReservations({
      source: source || undefined,
      status: status || undefined,
    }).then(setReservations);
  }, [source, status]);

  return (
    <div>
      <h1>Reservations</h1>
      <Link to="/reservations/new">New reservation</Link>
      <div>
        <label>
          Source
          <select value={source} onChange={(e) => setSource(e.target.value as ReservationSource | '')}>
            <option value="">All</option>
            <option value="BOOKING">Booking.com</option>
            <option value="AIRBNB">Airbnb</option>
            <option value="DIRECT">Direct</option>
            <option value="OTHER">Other</option>
          </select>
        </label>
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value as ReservationStatus | '')}>
            <option value="">All</option>
            <option value="PENDING">Pending</option>
            <option value="CONFIRMED">Confirmed</option>
            <option value="CANCELLED">Cancelled</option>
            <option value="COMPLETED">Completed</option>
          </select>
        </label>
      </div>
      <table>
        <thead>
          <tr>
            <th>Guest</th>
            <th>Check-in</th>
            <th>Check-out</th>
            <th>Source</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {reservations.map((r) => (
            <tr key={r.id}>
              <td>
                <Link to={`/reservations/${r.id}`}>{r.guestName}</Link>
              </td>
              <td>{r.checkIn}</td>
              <td>{r.checkOut}</td>
              <td>{r.source}</td>
              <td>{r.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
