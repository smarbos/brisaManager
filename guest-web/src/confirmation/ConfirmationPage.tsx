import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { acceptContract, confirmDates, getReservationByToken } from '../api/publicReservations';
import { GuestReservation } from './types';
import { PageContainer, Alert, Button, FormField, Input } from '../ui';

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
      <PageContainer>
        <h1 className="font-heading text-2xl font-semibold text-heading">Reservation not found</h1>
        <p className="mt-2 text-text-muted">This confirmation link is invalid. Please contact us directly.</p>
      </PageContainer>
    );
  }

  if (loadError) {
    return (
      <PageContainer>
        <h1 className="font-heading text-2xl font-semibold text-heading">Unable to load reservation</h1>
        <p className="mt-2 text-text-muted">
          Something went wrong loading your reservation. Please try again or contact us directly.
        </p>
      </PageContainer>
    );
  }

  if (!reservation) {
    return (
      <PageContainer>
        <p className="text-text-muted">Loading...</p>
      </PageContainer>
    );
  }

  const allDone = Boolean(
    reservation.datesConfirmedAt &&
      reservation.contractAcceptedAt &&
      reservation.confirmationPaymentReceivedAt &&
      reservation.depositReceivedAt,
  );

  return (
    <PageContainer>
      <h1 className="font-heading text-2xl font-semibold text-heading">La Brisa de Mar del Plata</h1>
      <h2 className="mt-1 font-heading text-lg font-semibold text-heading">
        Reservation for {reservation.guestName}
      </h2>
      <p className="mt-4 text-text">Check-in: {reservation.checkIn.slice(0, 10)}</p>
      <p className="text-text">Check-out: {reservation.checkOut.slice(0, 10)}</p>
      <p className="text-text">Guests: {reservation.paxCount}</p>
      <p className="text-text">
        Total: {reservation.totalAmount} {reservation.currency}
      </p>

      {error && <Alert>{error}</Alert>}

      <section className="mt-6">
        <h3 className="mb-2 font-heading text-base font-semibold text-heading">1. Confirm your dates</h3>
        {reservation.datesConfirmedAt ? (
          <p className="text-text">Confirmed.</p>
        ) : (
          <Button type="button" onClick={handleConfirmDates}>
            Confirm dates and guests
          </Button>
        )}
      </section>

      <section className="mt-6">
        <h3 className="mb-2 font-heading text-base font-semibold text-heading">2. Accept the house rules</h3>
        <p className="whitespace-pre-wrap text-text">{reservation.houseRulesText}</p>
        {reservation.contractAcceptedAt ? (
          <p className="text-text">Accepted by {reservation.contractAcceptedName}.</p>
        ) : (
          <form onSubmit={handleAcceptContract} className="mt-3 flex flex-col gap-3">
            <FormField label="Full name">
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </FormField>
            <Button type="submit">I accept the house rules</Button>
          </form>
        )}
      </section>

      <section className="mt-6">
        <h3 className="mb-2 font-heading text-base font-semibold text-heading">3. Payment</h3>
        <p className="whitespace-pre-wrap text-text">{reservation.paymentInstructions}</p>
        <p className="mt-2 text-text">
          30% confirmation payment ({reservation.confirmationPaymentAmount} {reservation.currency}):{' '}
          {reservation.confirmationPaymentReceivedAt ? 'Received' : 'Pending'}
        </p>
        <p className="text-text">Security deposit: {reservation.depositReceivedAt ? 'Received' : 'Pending'}</p>
      </section>

      {allDone && (
        <p className="mt-6 text-text">Your reservation is fully confirmed. We look forward to hosting you!</p>
      )}
    </PageContainer>
  );
}
