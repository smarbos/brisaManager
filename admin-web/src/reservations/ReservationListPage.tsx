import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { listReservations } from '../api/reservations';
import { useAuth } from '../auth/AuthContext';
import { Reservation, ReservationSource, ReservationStatus } from './types';
import { PageContainer, PageHeader, Button, FormField, Select, Alert, Table } from '../ui';

const thClass = 'border-b border-border px-3 py-2 text-left font-semibold text-text-muted';
const tdClass = 'border-b border-border px-3 py-2';

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
    <PageContainer>
      <PageHeader
        title="Reservations"
        nav={
          <>
            <Link to="/settings" className="text-accent hover:underline">
              Settings
            </Link>
            <Link to="/guests" className="text-accent hover:underline">
              Guests
            </Link>
            <Link to="/templates" className="text-accent hover:underline">
              Templates
            </Link>
            <Link to="/campaigns" className="text-accent hover:underline">
              Campaigns
            </Link>
            <Link to="/reservations/new" className="text-accent hover:underline">
              New reservation
            </Link>
            <Button type="button" variant="secondary" onClick={handleLogout}>
              Log out
            </Button>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap gap-4">
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
