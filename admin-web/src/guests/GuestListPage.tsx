import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listGuests, Guest } from '../api/guests';

export function GuestListPage() {
  const [guests, setGuests] = useState<Guest[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listGuests()
      .then(setGuests)
      .catch(() => setError('Could not load the guests. Please reload the page.'));
  }, []);

  return (
    <div>
      <h1>Guests</h1>
      <Link to="/">Reservations</Link>
      {error && <p role="alert">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Phone</th>
            <th>Total stays</th>
            <th>Last stay</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {guests.map((g) => (
            <tr key={g.id}>
              <td>{g.name}</td>
              <td>{g.email}</td>
              <td>{g.phone ?? '—'}</td>
              <td>{g.totalStays}</td>
              <td>{g.lastStayAt ? new Date(g.lastStayAt).toLocaleDateString() : '—'}</td>
              <td>{g.unsubscribedAt ? 'Unsubscribed' : 'Subscribed'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
