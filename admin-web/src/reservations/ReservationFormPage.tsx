import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { createReservation, getReservation, updateReservation } from '../api/reservations';
import { Reservation, ReservationSource, ReservationStatus } from './types';

const emptyForm = {
  guestName: '',
  guestPhone: '',
  guestEmail: '',
  checkIn: '',
  checkOut: '',
  paxCount: 1,
  source: 'DIRECT' as ReservationSource,
  externalReference: '',
  totalAmount: 0,
  currency: 'ARS',
  status: 'PENDING' as ReservationStatus,
  notes: '',
};

export function ReservationFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEditing = Boolean(id);
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id) {
      getReservation(id).then((reservation: Reservation) =>
        setForm({
          ...emptyForm,
          ...reservation,
          checkIn: reservation.checkIn.slice(0, 10),
          checkOut: reservation.checkOut.slice(0, 10),
          totalAmount: Number(reservation.totalAmount),
        }),
      );
    }
  }, [id]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      if (isEditing && id) {
        await updateReservation(id, form);
      } else {
        await createReservation(form);
      }
      navigate('/');
    } catch {
      setError('Could not save the reservation');
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>{isEditing ? 'Edit reservation' : 'New reservation'}</h1>
      <label>
        Guest name
        <input value={form.guestName} onChange={(e) => setForm({ ...form, guestName: e.target.value })} required />
      </label>
      <label>
        Check-in
        <input
          type="date"
          value={form.checkIn}
          onChange={(e) => setForm({ ...form, checkIn: e.target.value })}
          required
        />
      </label>
      <label>
        Check-out
        <input
          type="date"
          value={form.checkOut}
          onChange={(e) => setForm({ ...form, checkOut: e.target.value })}
          required
        />
      </label>
      <label>
        Pax
        <input
          type="number"
          min={1}
          value={form.paxCount}
          onChange={(e) => setForm({ ...form, paxCount: Number(e.target.value) })}
          required
        />
      </label>
      <label>
        Source
        <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value as ReservationSource })}>
          <option value="BOOKING">Booking.com</option>
          <option value="AIRBNB">Airbnb</option>
          <option value="DIRECT">Direct</option>
          <option value="OTHER">Other</option>
        </select>
      </label>
      <label>
        Total amount
        <input
          type="number"
          min={0}
          value={form.totalAmount}
          onChange={(e) => setForm({ ...form, totalAmount: Number(e.target.value) })}
          required
        />
      </label>
      <label>
        Currency
        <input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} required />
      </label>
      {isEditing && (
        <label>
          Status
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ReservationStatus })}>
            <option value="PENDING">Pending</option>
            <option value="CONFIRMED">Confirmed</option>
            <option value="CANCELLED">Cancelled</option>
            <option value="COMPLETED">Completed</option>
          </select>
        </label>
      )}
      <label>
        Notes
        <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit">Save</button>
    </form>
  );
}
