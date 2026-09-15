import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { acceptContract, confirmDates, getReservationByToken } from '../api/publicReservations';
import { GuestReservation } from './types';
import { PageContainer, Alert, Button, FormField, Input } from '../ui';
import { formatDate } from '../lib/date';

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
      setError('No pudimos confirmar las fechas. Por favor, intentá de nuevo.');
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
      setError('No pudimos registrar la aceptación del contrato. Por favor, intentá de nuevo.');
    }
  }

  if (notFound) {
    return (
      <PageContainer>
        <h1 className="font-heading text-2xl font-semibold text-heading">Reserva no encontrada</h1>
        <p className="mt-2 text-text-muted">Este link de confirmación no es válido. Por favor, contactanos directamente.</p>
      </PageContainer>
    );
  }

  if (loadError) {
    return (
      <PageContainer>
        <h1 className="font-heading text-2xl font-semibold text-heading">No se pudo cargar la reserva</h1>
        <p className="mt-2 text-text-muted">
          Algo salió mal al cargar tu reserva. Por favor, intentá de nuevo o contactanos directamente.
        </p>
      </PageContainer>
    );
  }

  if (!reservation) {
    return (
      <PageContainer>
        <p className="text-text-muted">Cargando...</p>
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
        Reserva de {reservation.guestName}
      </h2>
      <p className="mt-4 text-text">Check-in: {formatDate(reservation.checkIn)}</p>
      <p className="text-text">Check-out: {formatDate(reservation.checkOut)}</p>
      <p className="text-text">Huéspedes: {reservation.paxCount}</p>
      <p className="text-text">
        Total: {reservation.totalAmount} {reservation.currency}
      </p>

      {error && <Alert>{error}</Alert>}

      <section className="mt-6">
        <h3 className="mb-2 font-heading text-base font-semibold text-heading">1. Confirmá tus fechas</h3>
        {reservation.datesConfirmedAt ? (
          <p className="text-text">Confirmado.</p>
        ) : (
          <Button type="button" onClick={handleConfirmDates}>
            Confirmar fechas y huéspedes
          </Button>
        )}
      </section>

      <section className="mt-6">
        <h3 className="mb-2 font-heading text-base font-semibold text-heading">2. Aceptá las reglas de la casa</h3>
        <p className="whitespace-pre-wrap text-text">{reservation.houseRulesText}</p>
        {reservation.contractAcceptedAt ? (
          <p className="text-text">Aceptado por {reservation.contractAcceptedName}.</p>
        ) : (
          <form onSubmit={handleAcceptContract} className="mt-3 flex flex-col gap-3">
            <FormField label="Nombre completo">
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </FormField>
            <Button type="submit">Acepto las reglas de la casa</Button>
          </form>
        )}
      </section>

      <section className="mt-6">
        <h3 className="mb-2 font-heading text-base font-semibold text-heading">3. Pago</h3>
        <p className="whitespace-pre-wrap text-text">{reservation.paymentInstructions}</p>
        <p className="mt-2 text-text">
          Pago de confirmación del 30% ({reservation.confirmationPaymentAmount} {reservation.currency}):{' '}
          {reservation.confirmationPaymentReceivedAt ? 'Recibido' : 'Pendiente'}
        </p>
        <p className="mt-2 whitespace-pre-wrap text-text">{reservation.depositInstructions}</p>
        <p className="text-text">Depósito de garantía: {reservation.depositReceivedAt ? 'Recibido' : 'Pendiente'}</p>
      </section>

      {allDone && (
        <p className="mt-6 text-text">Tu reserva está completamente confirmada. ¡Te esperamos!</p>
      )}
    </PageContainer>
  );
}
