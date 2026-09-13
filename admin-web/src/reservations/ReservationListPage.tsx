import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { listReservations } from '../api/reservations';
import { useAuth } from '../auth/AuthContext';
import { Reservation, ReservationSource, ReservationStatus } from './types';

export function ReservationListPage() {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [source, setSource] = useState<ReservationSource | ''>('');
  const [status, setStatus] = useState<ReservationStatus | ''>('');
  const [error, setError] = useState<string | null>(null);
  const { logout } = useAuth();
  const navigate = useNavigate();

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

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div>
      <h1>Reservations</h1>
      <button type="button" onClick={handleLogout}>
        Log out
      </button>
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
      {error && <p role="alert">{error}</p>}
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
