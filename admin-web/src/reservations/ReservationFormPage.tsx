import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  checkOverlap,
  createReservation,
  getReservation,
  listReservationEvents,
  markDepositReceived,
  markDepositReturned,
  markPaymentReceived,
  updateReservation,
} from '../api/reservations';
import { Reservation, ReservationEvent, ReservationSource, ReservationStatus } from './types';
import { PageContainer, Alert, Button, FormField, Input, Select, Textarea } from '../ui';
import { formatDate, formatDateTime } from '../lib/date';

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
  const [actionError, setActionError] = useState<string | null>(null);
  const [reservationRecord, setReservationRecord] = useState<Reservation | null>(null);
  const [events, setEvents] = useState<ReservationEvent[]>([]);
  const [overlaps, setOverlaps] = useState<Reservation[]>([]);
  const guestWebUrl = import.meta.env.VITE_GUEST_WEB_URL as string;

  function loadReservation() {
    if (!id) return;
    getReservation(id)
      .then((reservation: Reservation) => {
        setReservationRecord(reservation);
        setForm({
          ...emptyForm,
          ...reservation,
          checkIn: reservation.checkIn.slice(0, 10),
          checkOut: reservation.checkOut.slice(0, 10),
          totalAmount: Number(reservation.totalAmount),
        });
      })
      .catch((err) => {
        console.error('Failed to load the reservation', err);
        setError('Could not load the reservation');
      });
    listReservationEvents(id)
      .then(setEvents)
      .catch((err) => {
        console.error('Failed to load the reservation events', err);
      });
  }

  useEffect(() => {
    loadReservation();
  }, [id]);

  useEffect(() => {
    if (!form.checkIn || !form.checkOut) {
      setOverlaps([]);
      return;
    }
    checkOverlap(form.checkIn, form.checkOut, id)
      .then(setOverlaps)
      .catch(() => setOverlaps([]));
  }, [form.checkIn, form.checkOut, id]);

  async function handleMarkPaymentReceived() {
    if (!id) return;
    setActionError(null);
    try {
      await markPaymentReceived(id);
      loadReservation();
    } catch {
      setActionError('Could not mark the 30% payment as received. Please try again.');
    }
  }

  async function handleMarkDepositReceived() {
    if (!id) return;
    setActionError(null);
    try {
      await markDepositReceived(id);
      loadReservation();
    } catch {
      setActionError('Could not mark the deposit as received. Please try again.');
    }
  }

  async function handleMarkDepositReturned() {
    if (!id) return;
    setActionError(null);
    try {
      await markDepositReturned(id);
      loadReservation();
    } catch {
      setActionError('Could not mark the deposit as returned. Please try again.');
    }
  }

  function copyGuestLink() {
    if (!reservationRecord) return;
    navigator.clipboard.writeText(`${guestWebUrl}/r/${reservationRecord.confirmationToken}`);
  }

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
    <PageContainer>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <h1 className="font-heading text-2xl font-semibold text-heading">
          {isEditing ? 'Edit reservation' : 'New reservation'}
        </h1>
        {overlaps.length > 0 && (
          <Alert>
            <p>These dates overlap with existing reservation(s):</p>
            <ul className="mt-1 list-disc pl-5">
              {overlaps.map((o) => (
                <li key={o.id}>
                  {o.guestName} ({o.source}): {formatDate(o.checkIn)} – {formatDate(o.checkOut)}
                </li>
              ))}
            </ul>
          </Alert>
        )}
        <FormField label="Guest name">
          <Input value={form.guestName} onChange={(e) => setForm({ ...form, guestName: e.target.value })} required />
        </FormField>
        <FormField label="Check-in">
          <Input
            type="date"
            value={form.checkIn}
            onChange={(e) => setForm({ ...form, checkIn: e.target.value })}
            required
          />
        </FormField>
        <FormField label="Check-out">
          <Input
            type="date"
            value={form.checkOut}
            onChange={(e) => setForm({ ...form, checkOut: e.target.value })}
            required
          />
        </FormField>
        <FormField label="Pax">
          <Input
            type="number"
            min={1}
            value={form.paxCount}
            onChange={(e) => setForm({ ...form, paxCount: Number(e.target.value) })}
            required
          />
        </FormField>
        <FormField label="Source">
          <Select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value as ReservationSource })}>
            <option value="BOOKING">Booking.com</option>
            <option value="AIRBNB">Airbnb</option>
            <option value="DIRECT">Direct</option>
            <option value="OTHER">Other</option>
          </Select>
        </FormField>
        <FormField label="Total amount">
          <Input
            type="number"
            min={0}
            value={form.totalAmount}
            onChange={(e) => setForm({ ...form, totalAmount: Number(e.target.value) })}
            required
          />
        </FormField>
        <FormField label="Currency">
          <Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} required />
        </FormField>
        {isEditing && (
          <FormField label="Status">
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ReservationStatus })}>
              <option value="PENDING">Pending</option>
              <option value="CONFIRMED">Confirmed</option>
              <option value="CANCELLED">Cancelled</option>
              <option value="COMPLETED">Completed</option>
            </Select>
          </FormField>
        )}
        <FormField label="Notes">
          <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </FormField>
        {error && <Alert>{error}</Alert>}
        <Button type="submit">Save</Button>
      </form>
      {isEditing && reservationRecord && (
        <section className="mt-8">
          <h2 className="mb-3 font-heading text-lg font-semibold text-heading">Onboarding progress</h2>
          {actionError && <Alert>{actionError}</Alert>}
          {reservationRecord.missingFromChannelAt && (
            <Alert>
              No longer found in the channel's calendar as of{' '}
              {formatDateTime(reservationRecord.missingFromChannelAt)} — confirm with the guest or cancel
              this reservation.
            </Alert>
          )}
          <ul className="flex flex-col gap-2">
            <li>Dates confirmed: {reservationRecord.datesConfirmedAt ? 'Yes' : 'No'}</li>
            <li>
              Contract accepted:{' '}
              {reservationRecord.contractAcceptedAt ? `Yes (${reservationRecord.contractAcceptedName})` : 'No'}
            </li>
            <li>
              30% payment received:{' '}
              {reservationRecord.confirmationPaymentReceivedAt ? (
                'Yes'
              ) : (
                <Button type="button" variant="secondary" onClick={handleMarkPaymentReceived}>
                  Mark 30% payment received
                </Button>
              )}
            </li>
            <li>
              Deposit received:{' '}
              {reservationRecord.depositReceivedAt ? (
                'Yes'
              ) : (
                <Button type="button" variant="secondary" onClick={handleMarkDepositReceived}>
                  Mark deposit received
                </Button>
              )}
            </li>
            <li>
              Deposit returned:{' '}
              {reservationRecord.depositReturnedAt ? (
                'Yes'
              ) : (
                <Button type="button" variant="secondary" onClick={handleMarkDepositReturned}>
                  Mark deposit returned
                </Button>
              )}
            </li>
          </ul>
          <Button type="button" variant="secondary" className="mt-3" onClick={copyGuestLink}>
            Copy guest confirmation link
          </Button>

          <h2 className="mb-3 mt-6 font-heading text-lg font-semibold text-heading">Event history</h2>
          <ul className="flex flex-col gap-1 text-sm text-text-muted">
            {events.map((event) => (
              <li key={event.id}>
                {event.type} — {formatDateTime(event.createdAt)}
                {event.detail ? `: ${event.detail}` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageContainer>
  );
}
