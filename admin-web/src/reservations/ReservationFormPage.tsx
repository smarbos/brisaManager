import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { isValidPhoneNumber, parsePhoneNumberFromString } from 'libphonenumber-js';
import {
  cancelReservation,
  checkOverlap,
  createReservation,
  getReservation,
  listReservationEvents,
  markDepositReceived,
  markDepositReturned,
  markPaymentReceived,
  resendCancellationEmail,
  resendFinalEmail,
  resendInitialEmail,
  sendInitialWhatsapp,
  updateReservation,
} from '../api/reservations';
import { getReservationImageBlob, listReservationImages, ReservationImage } from '../api/reservation-images';
import { listOutboundEmails, OutboundEmail } from '../api/outbound-emails';
import { OutboundEmailList } from '../emails/OutboundEmailList';
import { Reservation, ReservationEvent, ReservationSource, ReservationStatus } from './types';
import {
  PageContainer,
  PageHeader,
  Alert,
  Button,
  Card,
  FormField,
  Input,
  Lightbox,
  Select,
  Textarea,
  useTwoStepConfirm,
} from '../ui';
import { formatDate, formatDateTime, formatTime } from '../lib/date';
import { shortId } from '../lib/id';
import { sourceLabel, eventTypeLabel } from '../lib/labels';

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

type ActionKey =
  | 'resendEmail'
  | 'sendWhatsapp'
  | 'resendFinalEmail'
  | 'resendCancellationEmail'
  | 'markPayment'
  | 'markDeposit'
  | 'returnDeposit'
  | 'cancel';

function StepIcon({ done }: { done: boolean }) {
  return (
    <span
      className={`mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full text-xs font-bold ${
        done ? 'bg-success-bg text-success' : 'bg-border text-text-muted'
      }`}
    >
      {done ? '✓' : '✗'}
    </span>
  );
}

// Receipts are financial documents served through an authenticated endpoint, not a plain
// static URL — so each thumbnail needs its own blob fetch + object URL, revoked on unmount
// to avoid leaking memory as staff browse between reservations.
function ReceiptImage({ reservationId, image }: { reservationId: string; image: ReservationImage }) {
  const [url, setUrl] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    getReservationImageBlob(reservationId, image.id)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [reservationId, image.id]);

  if (!url) {
    return <div className="h-24 w-24 animate-pulse rounded border border-border bg-bg" />;
  }

  return (
    <>
      <div className="flex flex-col items-center gap-1">
        <button
          type="button"
          onClick={() => setViewerOpen(true)}
          title={image.originalName ?? 'Comprobante'}
          className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          <img
            src={url}
            alt={image.originalName ?? 'Comprobante de pago'}
            className="h-24 w-24 rounded border border-border object-cover"
          />
        </button>
        {image.message && <p className="max-w-24 truncate text-xs text-text-muted" title={image.message}>{image.message}</p>}
      </div>
      {viewerOpen && (
        <Lightbox src={url} alt={image.originalName ?? 'Comprobante de pago'} onClose={() => setViewerOpen(false)} />
      )}
    </>
  );
}

export function ReservationFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEditing = Boolean(id);
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<ActionKey | null>(null);
  const [reservationRecord, setReservationRecord] = useState<Reservation | null>(null);
  const [events, setEvents] = useState<ReservationEvent[]>([]);
  const [outboundEmails, setOutboundEmails] = useState<OutboundEmail[]>([]);
  const [overlaps, setOverlaps] = useState<Reservation[]>([]);
  const [images, setImages] = useState<ReservationImage[]>([]);
  const guestWebUrl = import.meta.env.VITE_GUEST_WEB_URL as string;

  // The email of this kind still waiting in the outbox, if any — its row then says when it goes
  // out, and its resend button is hidden so the operator doesn't queue a second copy (the
  // waiting one can be aborted from the Emails section).
  function waitingEmail(kind: OutboundEmail['kind']): OutboundEmail | undefined {
    return outboundEmails.find((email) => email.kind === kind && email.status === 'SCHEDULED');
  }

  function loadOutboundEmails() {
    if (!id) return;
    listOutboundEmails({ reservationId: id })
      .then(setOutboundEmails)
      .catch((err) => {
        console.error('Failed to load the reservation emails', err);
      });
  }

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
        setError('No se pudo cargar la reserva');
      });
    loadOutboundEmails();
    listReservationEvents(id)
      .then(setEvents)
      .catch((err) => {
        console.error('Failed to load the reservation events', err);
      });
    listReservationImages(id)
      .then(setImages)
      .catch((err) => {
        console.error('Failed to load the reservation receipts', err);
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
    setActionLoading('markPayment');
    try {
      await markPaymentReceived(id);
      loadReservation();
    } catch {
      setActionError('No se pudo marcar el pago del 30% como recibido. Por favor, intentá de nuevo.');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleMarkDepositReceived() {
    if (!id) return;
    setActionError(null);
    setActionLoading('markDeposit');
    try {
      await markDepositReceived(id);
      loadReservation();
    } catch {
      setActionError('No se pudo marcar el depósito como recibido. Por favor, intentá de nuevo.');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleMarkDepositReturned() {
    if (!id) return;
    setActionError(null);
    setActionLoading('returnDeposit');
    try {
      await markDepositReturned(id);
      loadReservation();
    } catch {
      setActionError('No se pudo marcar el depósito como devuelto. Por favor, intentá de nuevo.');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleResendInitialEmail() {
    if (!id) return;
    setActionError(null);
    setActionLoading('resendEmail');
    try {
      const { sent } = await resendInitialEmail(id);
      loadReservation();
      if (!sent) {
        setActionError('El email no se pudo programar. Revisá el historial de eventos para más detalles.');
      }
    } catch {
      setActionError('No se pudo reenviar el email de confirmación. Por favor, intentá de nuevo.');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleSendInitialWhatsapp() {
    if (!id) return;
    setActionError(null);
    setActionLoading('sendWhatsapp');
    try {
      const { sent } = await sendInitialWhatsapp(id);
      loadReservation();
      if (!sent) {
        setActionError('El WhatsApp no pudo enviarse. Revisá el historial de eventos para más detalles.');
      }
    } catch {
      setActionError('No se pudo enviar el link por WhatsApp. Por favor, intentá de nuevo.');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleResendFinalEmail() {
    if (!id) return;
    setActionError(null);
    setActionLoading('resendFinalEmail');
    try {
      const { sent } = await resendFinalEmail(id);
      loadReservation();
      if (!sent) {
        setActionError('El email no se pudo programar. Revisá el historial de eventos para más detalles.');
      }
    } catch {
      setActionError('No se pudo reenviar el email de confirmación final. Por favor, intentá de nuevo.');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleResendCancellationEmail() {
    if (!id) return;
    setActionError(null);
    setActionLoading('resendCancellationEmail');
    try {
      const { sent } = await resendCancellationEmail(id);
      loadReservation();
      if (!sent) {
        setActionError('El email no se pudo programar. Revisá el historial de eventos para más detalles.');
      }
    } catch {
      setActionError('No se pudo reenviar el email de cancelación. Por favor, intentá de nuevo.');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleCancel() {
    if (!id || !reservationRecord) return;
    setActionError(null);
    setActionLoading('cancel');
    try {
      await cancelReservation(id);
      loadReservation();
    } catch {
      setActionError('No se pudo cancelar la reserva. Por favor, intentá de nuevo.');
    } finally {
      setActionLoading(null);
    }
  }

  function copyGuestLink() {
    if (!reservationRecord) return;
    navigator.clipboard.writeText(`${guestWebUrl}/r/${reservationRecord.confirmationToken}`);
  }

  const cancelConfirm = useTwoStepConfirm(handleCancel, { armedLabel: '¿Cancelar? Tocá de nuevo' });

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    // Only manual entry via this form is held to this: staff sometimes need to enter a
    // reservation with no phone at all (optional field), but a non-empty value must be a
    // real number — unlike the Chrome extension's import path, which best-effort normalizes
    // a scraped phone and never rejects the import over it (see ChannelImportService).
    if (form.guestPhone && !isValidPhoneNumber(form.guestPhone, 'AR')) {
      setPhoneError('Ingresá un número de teléfono válido.');
      return;
    }
    setPhoneError(null);
    setError(null);
    setSubmitting(true);
    const guestPhone = form.guestPhone ? parsePhoneNumberFromString(form.guestPhone, 'AR')!.number : form.guestPhone;
    try {
      if (isEditing && id) {
        await updateReservation(id, { ...form, guestPhone });
      } else {
        await createReservation({ ...form, guestPhone });
      }
      navigate('/');
    } catch {
      setError('No se pudo guardar la reserva');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title={isEditing ? 'Editar reserva' : 'Nueva reserva'}
        subtitle={
          isEditing
            ? 'Datos de la estadía y progreso del check-in online del huésped.'
            : 'Cargá los datos de una nueva reserva manual.'
        }
        backTo="/"
        backLabel="Volver a reservas"
      />
      <Card>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {isEditing && id && (
            <p className="-mt-1 font-mono text-xs text-text-muted" title={id}>
              ID de reserva: {shortId(id)}
            </p>
          )}
          {overlaps.length > 0 && (
            <Alert>
              <p>Estas fechas se superponen con otra(s) reserva(s):</p>
              <ul className="mt-1 list-disc pl-5">
                {overlaps.map((o) => (
                  <li key={o.id}>
                    {o.guestName} ({sourceLabel(o.source)}): {formatDate(o.checkIn)} – {formatDate(o.checkOut)}
                  </li>
                ))}
              </ul>
            </Alert>
          )}
          <FormField label="Nombre del huésped">
            <Input value={form.guestName} onChange={(e) => setForm({ ...form, guestName: e.target.value })} required />
          </FormField>
          <FormField label="Email del huésped">
            <Input
              type="email"
              value={form.guestEmail}
              onChange={(e) => setForm({ ...form, guestEmail: e.target.value })}
            />
          </FormField>
          <FormField label="Teléfono del huésped" error={phoneError}>
            <Input
              type="tel"
              value={form.guestPhone}
              onChange={(e) => {
                setForm({ ...form, guestPhone: e.target.value });
                setPhoneError(null);
              }}
            />
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
          <FormField label="Huéspedes">
            <Input
              type="number"
              min={1}
              value={form.paxCount}
              onChange={(e) => setForm({ ...form, paxCount: Number(e.target.value) })}
              required
            />
          </FormField>
          <FormField label="Canal">
            <Select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value as ReservationSource })}>
              <option value="BOOKING">Booking.com</option>
              <option value="AIRBNB">Airbnb</option>
              <option value="DIRECT">Directo</option>
              <option value="OTHER">Otro</option>
            </Select>
          </FormField>
          <FormField label="Referencia externa">
            <Input
              value={form.externalReference}
              onChange={(e) => setForm({ ...form, externalReference: e.target.value })}
            />
          </FormField>
          <FormField label="Monto total">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={form.totalAmount}
              onChange={(e) => setForm({ ...form, totalAmount: Number(e.target.value) })}
              required
            />
          </FormField>
          <FormField label="Moneda">
            <Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} required />
          </FormField>
          {isEditing && (
            <FormField label="Estado">
              <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ReservationStatus })}>
                <option value="PENDING">Pendiente</option>
                <option value="CONFIRMED">Confirmada</option>
                <option value="CANCELLED">Cancelada</option>
                <option value="COMPLETED">Completada</option>
              </Select>
            </FormField>
          )}
          <FormField label="Notas">
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </FormField>
          {error && <Alert>{error}</Alert>}
          <div>
            <Button type="submit" loading={submitting}>
              Guardar
            </Button>
          </div>
        </form>
      </Card>
      {isEditing && reservationRecord && (
        <>
          {images.length > 0 ? (
            <Card className="mt-6">
              <h2 className="mb-1 font-heading text-lg font-semibold text-heading">Comprobantes de pago</h2>
              <p className="mb-4 text-sm text-text-muted">
                Subidos por el huésped desde la página de check-in. Revisalos y marcá lo que corresponda como
                recibido.
              </p>
              <div className="flex flex-wrap gap-3">
                {images.map((image) => (
                  <ReceiptImage key={image.id} reservationId={id!} image={image} />
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                {!reservationRecord.confirmationPaymentReceivedAt && (
                  <Button
                    type="button"
                    variant="secondary"
                    loading={actionLoading === 'markPayment'}
                    onClick={handleMarkPaymentReceived}
                  >
                    Marcar pago del 30% como recibido
                  </Button>
                )}
                {!reservationRecord.depositReceivedAt && (
                  <Button
                    type="button"
                    variant="secondary"
                    loading={actionLoading === 'markDeposit'}
                    onClick={handleMarkDepositReceived}
                  >
                    Marcar depósito como recibido
                  </Button>
                )}
              </div>
            </Card>
          ) : null}
          <Card className="mt-6">
            <h2 className="mb-1 font-heading text-lg font-semibold text-heading">Progreso del onboarding</h2>
            <p className="mb-4 text-sm text-text-muted">Estado de cada paso del check-in online del huésped.</p>
            {actionError && <Alert>{actionError}</Alert>}
            {reservationRecord.missingFromChannelAt && (
              <Alert>
                Ya no está en el calendario del canal desde el{' '}
                {formatDateTime(reservationRecord.missingFromChannelAt)} — confirmá con el huésped o cancelá
                esta reserva.
              </Alert>
            )}
            <ul className="flex flex-col divide-y divide-border">
              <li className="flex items-start justify-between gap-4 py-3">
                <div className="flex items-start gap-3">
                  <StepIcon done={Boolean(reservationRecord.confirmationEmailSentAt)} />
                  <div>
                    <p className="font-medium text-text">Email inicial</p>
                    <p className="text-sm text-text-muted">
                      {!reservationRecord.guestEmail
                        ? 'La reserva no tiene un email de huésped'
                        : waitingEmail('INITIAL_CONFIRMATION')
                          ? `Programado para las ${formatTime(waitingEmail('INITIAL_CONFIRMATION')!.sendAt)}`
                          : reservationRecord.confirmationEmailSentAt
                            ? `Enviado el ${formatDateTime(reservationRecord.confirmationEmailSentAt)}`
                            : 'No enviado'}
                    </p>
                  </div>
                </div>
                {reservationRecord.guestEmail && !waitingEmail('INITIAL_CONFIRMATION') && (
                  <Button
                    type="button"
                    variant="secondary"
                    loading={actionLoading === 'resendEmail'}
                    onClick={handleResendInitialEmail}
                  >
                    Reenviar email de confirmación
                  </Button>
                )}
              </li>
              <li className="flex items-start justify-between gap-4 py-3">
                <div className="flex items-start gap-3">
                  <StepIcon done={Boolean(reservationRecord.confirmationWhatsappSentAt)} />
                  <div>
                    <p className="font-medium text-text">WhatsApp con el link</p>
                    <p className="text-sm text-text-muted">
                      {!reservationRecord.guestPhone
                        ? 'La reserva no tiene un teléfono de huésped'
                        : reservationRecord.confirmationWhatsappSentAt
                          ? `Enviado el ${formatDateTime(reservationRecord.confirmationWhatsappSentAt)}`
                          : 'No enviado'}
                    </p>
                  </div>
                </div>
                {reservationRecord.guestPhone && (
                  <Button
                    type="button"
                    variant="secondary"
                    loading={actionLoading === 'sendWhatsapp'}
                    onClick={handleSendInitialWhatsapp}
                  >
                    Enviar link por WhatsApp
                  </Button>
                )}
              </li>
              <li className="flex items-start gap-3 py-3">
                <StepIcon done={Boolean(reservationRecord.datesConfirmedAt)} />
                <p className="font-medium text-text">
                  Fechas confirmadas: {reservationRecord.datesConfirmedAt ? 'Sí' : 'No'}
                </p>
              </li>
              <li className="flex items-start gap-3 py-3">
                <StepIcon done={Boolean(reservationRecord.contractAcceptedAt)} />
                <p className="font-medium text-text">
                  Contrato aceptado:{' '}
                  {reservationRecord.contractAcceptedAt ? `Sí (${reservationRecord.contractAcceptedName})` : 'No'}
                </p>
              </li>
              <li className="flex items-center justify-between gap-4 py-3">
                <div className="flex items-center gap-3">
                  <StepIcon done={Boolean(reservationRecord.confirmationPaymentReceivedAt)} />
                  <p className="font-medium text-text">
                    Pago del 30% recibido: {reservationRecord.confirmationPaymentReceivedAt ? 'Sí' : 'No'}
                  </p>
                </div>
                {!reservationRecord.confirmationPaymentReceivedAt && (
                  <Button
                    type="button"
                    variant="secondary"
                    loading={actionLoading === 'markPayment'}
                    onClick={handleMarkPaymentReceived}
                  >
                    Marcar pago del 30% como recibido
                  </Button>
                )}
              </li>
              <li className="flex items-center justify-between gap-4 py-3">
                <div className="flex items-center gap-3">
                  <StepIcon done={Boolean(reservationRecord.depositReceivedAt)} />
                  <p className="font-medium text-text">
                    Depósito recibido: {reservationRecord.depositReceivedAt ? 'Sí' : 'No'}
                  </p>
                </div>
                {!reservationRecord.depositReceivedAt && (
                  <Button
                    type="button"
                    variant="secondary"
                    loading={actionLoading === 'markDeposit'}
                    onClick={handleMarkDepositReceived}
                  >
                    Marcar depósito como recibido
                  </Button>
                )}
              </li>
              <li className="flex items-center justify-between gap-4 py-3">
                <div className="flex items-center gap-3">
                  <StepIcon done={Boolean(reservationRecord.depositReturnedAt)} />
                  <p className="font-medium text-text">
                    Depósito devuelto: {reservationRecord.depositReturnedAt ? 'Sí' : 'No'}
                  </p>
                </div>
                {!reservationRecord.depositReturnedAt && (
                  <Button
                    type="button"
                    variant="secondary"
                    loading={actionLoading === 'returnDeposit'}
                    onClick={handleMarkDepositReturned}
                  >
                    Marcar depósito como devuelto
                  </Button>
                )}
              </li>
              {reservationRecord.status === 'CONFIRMED' && reservationRecord.guestEmail && (
                <li className="flex items-start justify-between gap-4 py-3">
                  <div className="flex items-start gap-3">
                    <StepIcon done={Boolean(reservationRecord.finalConfirmationEmailSentAt)} />
                    <div>
                      <p className="font-medium text-text">Email de confirmación final</p>
                      <p className="text-sm text-text-muted">
                        {waitingEmail('FINAL_CONFIRMATION')
                          ? `Programado para las ${formatTime(waitingEmail('FINAL_CONFIRMATION')!.sendAt)}`
                          : reservationRecord.finalConfirmationEmailSentAt
                            ? `Enviado el ${formatDateTime(reservationRecord.finalConfirmationEmailSentAt)}`
                            : 'No enviado'}
                      </p>
                    </div>
                  </div>
                  {!waitingEmail('FINAL_CONFIRMATION') && (
                    <Button
                      type="button"
                      variant="secondary"
                      loading={actionLoading === 'resendFinalEmail'}
                      onClick={handleResendFinalEmail}
                    >
                      Reenviar email de confirmación final
                    </Button>
                  )}
                </li>
              )}
              {reservationRecord.status === 'CANCELLED' && reservationRecord.guestEmail && (
                <li className="flex items-start justify-between gap-4 py-3">
                  <div className="flex items-start gap-3">
                    <StepIcon done={Boolean(reservationRecord.cancellationEmailSentAt)} />
                    <div>
                      <p className="font-medium text-text">Email de cancelación</p>
                      <p className="text-sm text-text-muted">
                        {waitingEmail('CANCELLATION')
                          ? `Programado para las ${formatTime(waitingEmail('CANCELLATION')!.sendAt)}`
                          : reservationRecord.cancellationEmailSentAt
                            ? `Enviado el ${formatDateTime(reservationRecord.cancellationEmailSentAt)}`
                            : 'No enviado'}
                      </p>
                    </div>
                  </div>
                  {!waitingEmail('CANCELLATION') && (
                    <Button
                      type="button"
                      variant="secondary"
                      loading={actionLoading === 'resendCancellationEmail'}
                      onClick={handleResendCancellationEmail}
                    >
                      Reenviar email de cancelación
                    </Button>
                  )}
                </li>
              )}
            </ul>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button type="button" variant="secondary" onClick={copyGuestLink}>
                Copiar link de confirmación para el huésped
              </Button>
              {reservationRecord.status !== 'CANCELLED' && reservationRecord.status !== 'COMPLETED' && (
                <Button
                  type="button"
                  variant="danger-outline"
                  loading={actionLoading === 'cancel'}
                  onClick={cancelConfirm.handleClick}
                >
                  {cancelConfirm.armed ? cancelConfirm.armedLabel : 'Cancelar reserva'}
                </Button>
              )}
            </div>
          </Card>

          {outboundEmails.length > 0 && (
            <Card className="mt-6">
              <h2 className="mb-1 font-heading text-lg font-semibold text-heading">Emails</h2>
              <p className="mb-3 text-sm text-text-muted">
                Cada email espera 5 minutos antes de enviarse: mientras tanto lo podés abortar.
              </p>
              <OutboundEmailList
                emails={outboundEmails}
                showReservationLink={false}
                onChanged={() => {
                  loadOutboundEmails();
                  loadReservation();
                }}
              />
            </Card>
          )}

          <Card className="mt-6">
            <h2 className="mb-3 font-heading text-lg font-semibold text-heading">Historial de eventos</h2>
            <ul className="flex flex-col gap-2 text-sm">
              {events.map((event) => (
                <li key={event.id} className="flex items-baseline gap-2 text-text-muted">
                  <span className="h-1.5 w-1.5 flex-none rounded-full bg-accent" />
                  <span>
                    {eventTypeLabel(event.type)} — {formatDateTime(event.createdAt)}
                    {event.actor ? ` (${event.actor})` : ''}
                    {event.detail ? `: ${event.detail}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </PageContainer>
  );
}
