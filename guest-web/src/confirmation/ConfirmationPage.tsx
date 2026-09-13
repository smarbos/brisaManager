import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { acceptContract, confirmDates, getReservationByToken } from '../api/publicReservations';
import { GuestReservation } from './types';

export function ConfirmationPage() {
  const { token } = useParams<{ token: string }>();
  const [reservation, setReservation] = useState<GuestReservation | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | null>(null);

  function load() {
    if (!token) return;
    getReservationByToken(token)
      .then((r) => {
        setReservation(r);
        setNotFound(false);
        setLoadError(false);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
        } else {
          setLoadError(true);
        }
      });
  }

  useEffect(load, [token]);

  async function handleConfirmDates() {
    if (!token) return;
    setError(null);
    try {
      await confirmDates(token);
      load();
    } catch {
      setError('Could not confirm dates. Please try again.');
    }
  }

  async function handleAcceptContract(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setError(null);
    try {
      await acceptContract(token, fullName);
      load();
    } catch {
      setError('Could not accept the contract. Please try again.');
    }
  }

  if (notFound) {
    return (
      <main className="container">
        <h1>Reservation not found</h1>
        <p>This confirmation link is invalid. Please contact us directly.</p>
      </main>
    );
  }

  if (loadError) {
    return (
      <main className="container">
        <h1>Unable to load reservation</h1>
        <p>Something went wrong loading your reservation. Please try again or contact us directly.</p>
      </main>
    );
  }

  if (!reservation) {
    return (
      <main className="container">
        <p>Loading...</p>
      </main>
    );
  }

  const allDone = Boolean(
    reservation.datesConfirmedAt &&
      reservation.contractAcceptedAt &&
      reservation.confirmationPaymentReceivedAt &&
      reservation.depositReceivedAt,
  );

  return (
    <main className="container">
      <h1>La Brisa de Mar del Plata</h1>
      <h2>Reservation for {reservation.guestName}</h2>
      <p>Check-in: {reservation.checkIn.slice(0, 10)}</p>
      <p>Check-out: {reservation.checkOut.slice(0, 10)}</p>
      <p>Guests: {reservation.paxCount}</p>
      <p>
        Total: {reservation.totalAmount} {reservation.currency}
      </p>

      {error && <p role="alert">{error}</p>}

      <section>
        <h3>1. Confirm your dates</h3>
        {reservation.datesConfirmedAt ? (
          <p>Confirmed.</p>
        ) : (
          <button type="button" className="btn" onClick={handleConfirmDates}>
            Confirm dates and guests
          </button>
        )}
      </section>

      <section>
        <h3>2. Accept the house rules</h3>
        <p style={{ whiteSpace: 'pre-wrap' }}>{reservation.houseRulesText}</p>
        {reservation.contractAcceptedAt ? (
          <p>Accepted by {reservation.contractAcceptedName}.</p>
        ) : (
          <form onSubmit={handleAcceptContract}>
            <label>
              Full name
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </label>
            <button type="submit" className="btn">
              I accept the house rules
            </button>
          </form>
        )}
      </section>

      <section>
        <h3>3. Payment</h3>
        <p style={{ whiteSpace: 'pre-wrap' }}>{reservation.paymentInstructions}</p>
        <p>
          30% confirmation payment ({reservation.confirmationPaymentAmount} {reservation.currency}):{' '}
          {reservation.confirmationPaymentReceivedAt ? 'Received' : 'Pending'}
        </p>
        <p>Security deposit: {reservation.depositReceivedAt ? 'Received' : 'Pending'}</p>
      </section>

      {allDone && <p>Your reservation is fully confirmed. We look forward to hosting you!</p>}
    </main>
  );
}
