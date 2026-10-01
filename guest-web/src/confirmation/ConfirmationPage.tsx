import { ChangeEvent, ClipboardEvent, FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { isValidPhoneNumber, parsePhoneNumberFromString } from 'libphonenumber-js';
import { ApiError } from '../api/client';
import { acceptContract, confirmDates, getReservationByToken } from '../api/publicReservations';
import {
  listReceiptImages,
  receiptImageUrl,
  submitPaymentUpdate,
  ReservationImage,
} from '../api/reservationImages';
import { getConfig } from '../api/config';
import { GuestReservation } from './types';
import { Step4Confirmation } from './step4/Step4Confirmation';
import { BankDetails } from './BankDetails';
import { Alert, Badge, Button, FormField, Input, Lightbox, Textarea } from '../ui';
import { formatDate, formatLongDate } from '../lib/date';

type Step = 1 | 2 | 3 | 4;

// Most guests booking this property are Argentine, so a bare local number (no country code)
// is assumed to be Argentine — but a guest can still type "+" followed by any other
// country's code and it's validated/normalized against that country instead.
const DEFAULT_PHONE_COUNTRY = 'AR';

const STEP_LABELS: Record<Step, string> = { 1: 'Reserva', 2: 'Reglas', 3: 'Pago', 4: 'Confirmación' };

function currentStep(reservation: GuestReservation): Step {
  if (!reservation.datesConfirmedAt) {
    return 1;
  }
  if (!reservation.contractAcceptedAt) {
    return 2;
  }
  if (!(reservation.confirmationPaymentReceivedAt && reservation.depositReceivedAt)) {
    return 3;
  }
  return 4;
}

function formatMoney(currency: string, amount: number): string {
  return `${currency} ${amount.toLocaleString('es-AR')}`;
}

function WaveIcon() {
  return (
    <svg width="32" height="20" viewBox="0 0 32 20" fill="none" className="mt-2 shrink-0 text-accent" aria-hidden="true">
      <path d="M1 10c3-6 6-6 9 0s6 6 9 0 6-6 9 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M1 16c3-6 6-6 9 0s6 6 9 0 6-6 9 0"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.5"
      />
    </svg>
  );
}

function StepIndicator({ step }: { step: Step }) {
  return (
    <nav aria-label="Progreso del check-in" className="mx-auto mt-6 flex max-w-md gap-2 px-4">
      {([1, 2, 3, 4] as Step[]).map((s) => (
        <div key={s} className="flex-1" aria-current={s === step ? 'step' : undefined}>
          <div className={`h-1 rounded-full ${s <= step ? 'bg-accent' : 'bg-border'}`} />
          <p className={`mt-1 text-xs ${s === step ? 'font-semibold text-heading' : 'text-text-muted'}`}>
            {STEP_LABELS[s]}
          </p>
        </div>
      ))}
      <p role="status" aria-live="polite" className="sr-only">
        Paso {step} de 4: {STEP_LABELS[step]}
      </p>
    </nav>
  );
}

function PageShell({ children }: { children: ReactNode }) {
  // pb-12 clears AppFooter, which is fixed to the bottom of the viewport, so it never covers
  // the last bit of content on steps short enough not to scroll past it naturally.
  return (
    <div className="min-h-screen bg-bg px-4 py-8 pb-12">
      <div className="mx-auto flex max-w-md items-start justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-heading">
            La <span className="italic">Brisa</span>
          </h1>
          <p className="text-sm text-text-muted">Mar del Plata · Playa Grande</p>
        </div>
        <WaveIcon />
      </div>
      {children}
      <p className="mx-auto mt-4 max-w-md text-center text-xs text-text-muted">
        La Brisa de Mar del Plata ·{' '}
        <a href="https://www.labrisa.com.ar" className="hover:underline" target="_blank" rel="noreferrer">
          www.labrisa.com.ar
        </a>
      </p>
    </div>
  );
}

export function ConfirmationPage() {
  const { token } = useParams<{ token: string }>();
  const [reservation, setReservation] = useState<GuestReservation | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [rulesChecked, setRulesChecked] = useState(false);
  const [rulesRevealed, setRulesRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDates, setConfirmingDates] = useState(false);
  const [acceptingContract, setAcceptingContract] = useState(false);
  const [images, setImages] = useState<ReservationImage[]>([]);
  const [paymentMessage, setPaymentMessage] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [submittingPaymentUpdate, setSubmittingPaymentUpdate] = useState(false);
  const [paymentUpdateError, setPaymentUpdateError] = useState<string | null>(null);
  const [viewerImageId, setViewerImageId] = useState<string | null>(null);
  const [debugMode, setDebugMode] = useState(false);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousStepRef = useRef<Step | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function load(): Promise<void> {
    if (!token) return Promise.resolve();
    return getReservationByToken(token)
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

  function loadImages() {
    if (!token) return;
    listReceiptImages(token)
      .then(setImages)
      .catch(() => {});
  }

  // Selecting/pasting a file only stages it — nothing is sent to the server until the guest
  // clicks "Actualizar datos de pagos", so a message typed alongside it travels with the
  // same submission instead of firing one request per file.
  function handleImageFileChange(event: ChangeEvent<HTMLInputElement>) {
    setSelectedFiles(Array.from(event.target.files ?? []));
  }

  function handleImagePaste(event: ClipboardEvent<HTMLDivElement>) {
    const file = Array.from(event.clipboardData.files).find((f) => f.type.startsWith('image/'));
    if (file) {
      setSelectedFiles((prev) => [...prev, file]);
    }
  }

  useEffect(() => {
    load();
    loadImages();
  }, [token]);

  useEffect(() => {
    getConfig()
      .then((config) => setDebugMode(config.debugMode))
      .catch(() => setDebugMode(false));
  }, []);

  // Move focus to the new step's heading when the guest advances (confirm dates, accept
  // contract) so keyboard/screen-reader users land on the new content instead of being
  // left on the button that just submitted and disappeared. Skipped on the very first
  // load (previousStepRef starts at null) so page load doesn't unexpectedly steal focus.
  useEffect(() => {
    if (!reservation) return;
    const step = currentStep(reservation);
    if (previousStepRef.current !== null && previousStepRef.current !== step) {
      stepHeadingRef.current?.focus();
    }
    previousStepRef.current = step;
  }, [reservation]);

  async function handleConfirmDates(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    if (!isValidPhoneNumber(phone, DEFAULT_PHONE_COUNTRY)) {
      setPhoneError('Ingresá un número de teléfono válido.');
      return;
    }
    setPhoneError(null);
    setError(null);
    setConfirmingDates(true);
    try {
      const normalizedPhone = parsePhoneNumberFromString(phone, DEFAULT_PHONE_COUNTRY)!.number;
      await confirmDates(token, fullName, normalizedPhone, email);
      await load();
    } catch {
      setError('No pudimos confirmar tus datos. Por favor, intentá de nuevo.');
    } finally {
      setConfirmingDates(false);
    }
  }

  async function handleAcceptContract() {
    if (!token) return;
    setError(null);
    setAcceptingContract(true);
    try {
      await acceptContract(token);
      await load();
    } catch {
      setError('No pudimos registrar la aceptación del contrato. Por favor, intentá de nuevo.');
    } finally {
      setAcceptingContract(false);
    }
  }

  // Covers what used to be two separate actions: uploading receipts and refreshing payment
  // status. A guest can submit files, a note, or both — never neither (the button is
  // disabled until at least one is present) — and either way it also re-checks payment
  // status afterward, same as the old standalone refresh button did on its own.
  async function handleSubmitPaymentUpdate() {
    if (!token) return;
    const trimmedMessage = paymentMessage.trim();
    if (selectedFiles.length === 0 && trimmedMessage) {
      const confirmed = window.confirm(
        '¿Confirmás que querés enviar esto sin subir ningún comprobante?',
      );
      if (!confirmed) return;
    }

    setPaymentUpdateError(null);
    setSubmittingPaymentUpdate(true);
    try {
      const { images: newImages } = await submitPaymentUpdate(token, selectedFiles, trimmedMessage || undefined);
      setImages((prev) => [...newImages, ...prev]);
      setPaymentMessage('');
      setSelectedFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await load();
    } catch {
      setPaymentUpdateError('No pudimos actualizar los datos de pago. Por favor, intentá de nuevo.');
    } finally {
      setSubmittingPaymentUpdate(false);
    }
  }

  if (notFound) {
    return (
      <PageShell>
        <div className="mx-auto mt-6 max-w-md rounded-xl bg-surface p-6 shadow-sm">
          <h2 className="font-heading text-xl font-bold text-heading">Reserva no encontrada</h2>
          <p className="mt-2 text-text-muted">Este link de confirmación no es válido. Por favor, contactanos directamente.</p>
        </div>
      </PageShell>
    );
  }

  if (loadError) {
    return (
      <PageShell>
        <div className="mx-auto mt-6 max-w-md rounded-xl bg-surface p-6 shadow-sm">
          <h2 className="font-heading text-xl font-bold text-heading">No se pudo cargar la reserva</h2>
          <p className="mt-2 text-text-muted">
            Algo salió mal al cargar tu reserva. Por favor, intentá de nuevo o contactanos directamente.
          </p>
        </div>
      </PageShell>
    );
  }

  if (!reservation) {
    return (
      <PageShell>
        <p className="mx-auto mt-6 max-w-md text-text-muted">Cargando...</p>
      </PageShell>
    );
  }

  const step = currentStep(reservation);
  const isFullyConfirmed = Boolean(reservation.confirmationPaymentReceivedAt) && Boolean(reservation.depositReceivedAt);
  const now = new Date();
  // checkIn/checkOut are stored as midnight-UTC dates with no time component — "inclusive of
  // the check-out day" means extending the window through the end of that day, matching the
  // same fix in the backend's own eligibility check (the real gate this only mirrors for UX).
  const stayEnd = new Date(new Date(reservation.checkOut).getTime() + 24 * 60 * 60 * 1000);
  const isDuringStay = now >= new Date(reservation.checkIn) && now < stayEnd;
  const showAmbient = debugMode || (isFullyConfirmed && isDuringStay);
  const ruleLines = reservation.houseRulesText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    <PageShell>
      <StepIndicator step={step} />

      <div className="mx-auto mt-6 max-w-md rounded-xl bg-surface p-6 shadow-sm">
        {error && <Alert>{error}</Alert>}

        {reservation.contractAcceptedAt && (
          <div className="mb-4">
            <button
              type="button"
              onClick={() => setRulesRevealed((v) => !v)}
              className="min-h-11 rounded px-2 text-sm font-semibold text-accent underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              Ver reglas de la casa
            </button>
            {rulesRevealed && (
              <div className="mt-2 rounded-lg bg-bg p-4">
                <p className="whitespace-pre-wrap text-sm text-text">{reservation.contractSnapshot}</p>
                <p className="mt-3 text-xs font-semibold uppercase text-text-muted">
                  Aceptadas el {formatLongDate(reservation.contractAcceptedAt)}
                </p>
              </div>
            )}
          </div>
        )}

        {step === 1 && (
          <>
            <h2
              ref={stepHeadingRef}
              tabIndex={-1}
              className="font-heading text-xl font-bold text-heading outline-none"
            >
              Confirmá tu reserva
            </h2>
            <p className="mt-1 text-sm text-text-muted">
              Revisá que los datos coincidan con tu reserva de Booking.com y completá tus datos de contacto.
            </p>

            <div className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-text-muted">Check-in</p>
                <p className="font-semibold text-heading">{formatDate(reservation.checkIn)}</p>
              </div>
              <div>
                <p className="text-xs text-text-muted">Check-out</p>
                <p className="font-semibold text-heading">{formatDate(reservation.checkOut)}</p>
              </div>
              <div>
                <p className="text-xs text-text-muted">Huéspedes</p>
                <p className="font-semibold text-heading">{reservation.paxCount}</p>
              </div>
              {reservation.totalAmount > 0 && (
                <div>
                  <p className="text-xs text-text-muted">Total de la estadía</p>
                  <p className="font-heading text-lg font-bold text-heading">
                    {formatMoney(reservation.currency, reservation.totalAmount)}
                  </p>
                </div>
              )}
            </div>

            <form onSubmit={handleConfirmDates} className="mt-6 flex flex-col gap-4">
              <FormField label="Nombre completo">
                <Input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Como figura en tu Documento"
                  required
                />
              </FormField>
              <FormField label="Celular" error={phoneError}>
                <Input
                  type="tel"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    setPhoneError(null);
                  }}
                  placeholder="223 456 7890"
                  required
                />
              </FormField>
              <p className="-mt-2 text-xs text-text-muted">
                Si tu número no es de Argentina, escribilo con el código de tu país (ej. +1 202 555 0123).
              </p>
              <FormField label="Email">
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="vos@mail.com"
                  required
                />
              </FormField>
              <Button type="submit" className="w-full" loading={confirmingDates}>
                Confirmar fechas y huéspedes
              </Button>
            </form>
          </>
        )}

        {step === 2 && (
          <>
            <Badge tone="success">✓ Reserva confirmada</Badge>
            <h2
              ref={stepHeadingRef}
              tabIndex={-1}
              className="mt-2 font-heading text-xl font-bold text-heading outline-none"
            >
              Reglas de la casa
            </h2>
            <p className="mt-1 text-sm text-text-muted">
              Por favor, leé y aceptá las normas de convivencia del edificio antes de continuar.
            </p>

            <div className="mt-4 flex flex-col gap-2">
              {ruleLines.map((line, i) => (
                <div key={i} className="flex items-center gap-3 rounded-lg bg-bg px-4 py-3">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />
                  <span className="text-sm text-text">{line}</span>
                </div>
              ))}
            </div>

            <label className="mt-4 flex items-start gap-3 text-sm text-text">
              {/* The wrapping span gives the checkbox itself a 44px hit box (centered on
                  its 20px visible glyph, `-m-3` cancels the added footprint so the row's
                  layout doesn't shift) — a span, not padding on the native checkbox
                  control, since padding-based hit-box tricks are unreliable on native
                  form controls across browsers. The outer <label> already made the whole
                  row clickable; this makes the checkbox's own target meet the guideline
                  too, not just the row via its adjacent text. */}
              <span className="-m-3 mt-[-0.375rem] flex h-11 w-11 shrink-0 items-center justify-center">
                <input
                  type="checkbox"
                  checked={rulesChecked}
                  onChange={(e) => setRulesChecked(e.target.checked)}
                  className="h-5 w-5 accent-accent"
                />
              </span>
              <span>
                Leí y acepto las reglas de la casa. Entiendo que su incumplimiento puede ocasionar la pérdida
                parcial o total del depósito de garantía.
              </span>
            </label>

            <Button
              type="button"
              className="mt-4 w-full"
              disabled={!rulesChecked}
              loading={acceptingContract}
              onClick={handleAcceptContract}
            >
              Acepto las reglas de la casa
            </Button>
          </>
        )}

        {step === 3 && (
          <>
            <Badge tone="success">✓ Reglas aceptadas</Badge>
            <h2
              ref={stepHeadingRef}
              tabIndex={-1}
              className="mt-2 font-heading text-xl font-bold text-heading outline-none"
            >
              Pago y garantía
            </h2>
            <p className="mt-1 text-sm text-text-muted">
              Transferí el importe a la cuenta indicada y compartinos el comprobante. Acá vas a ver el estado de
              cada pago.
            </p>

            <div className="mt-4 rounded-lg bg-bg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-heading">
                    Confirmación de reserva
                    {reservation.confirmationPaymentPercentage !== null &&
                      ` (${reservation.confirmationPaymentPercentage}%)`}
                  </p>
                  <p className="text-sm text-text-muted">
                    {formatMoney(reservation.currency, reservation.confirmationPaymentAmount)}
                  </p>
                </div>
                <Badge tone={reservation.confirmationPaymentReceivedAt ? 'success' : 'warning'}>
                  {reservation.confirmationPaymentReceivedAt ? 'Recibido' : 'Pendiente'}
                </Badge>
              </div>
              {/* Always stacked (label above, value below) rather than a viewport-based
                  breakpoint: this card sits in a fixed max-w-md container regardless of
                  device, so a long value like the CBU can overlap the label on any screen
                  width, not just narrow ones. */}
              <div className="mt-4">
                <BankDetails
                  accountHolder={reservation.bankAccountHolder}
                  cuil={reservation.bankCuil}
                  accountNumber={reservation.bankAccountNumber}
                  cbu={reservation.bankCbu}
                  alias={reservation.bankAlias}
                  bankName={reservation.bankName}
                />
              </div>
              <p className="mt-4 rounded bg-surface p-3 text-xs text-text-muted">
                Una vez transferido, subí el comprobante acá abajo (o mandalo por WhatsApp o email) para que
                actualicemos el estado del pago.
              </p>
            </div>

            <div className="mt-4 rounded-lg bg-bg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-heading">Depósito de garantía</p>
                  <p className="text-sm text-text-muted">
                    {formatMoney(reservation.currency, reservation.securityDepositAmount)} · por transferencia a la misma cuenta
                  </p>
                </div>
                <Badge tone={reservation.depositReceivedAt ? 'success' : 'warning'}>
                  {reservation.depositReceivedAt ? 'Recibido' : 'Pendiente'}
                </Badge>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm text-text-muted">{reservation.depositInstructions}</p>
            </div>

            <div
              tabIndex={0}
              onPaste={handleImagePaste}
              className="mt-4 flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-bg p-6 text-center"
            >
              <p className="text-sm font-semibold text-heading">Comprobante de pago</p>
              <FormField label="Mensaje (opcional)" className="w-full text-left">
                <Textarea
                  value={paymentMessage}
                  onChange={(e) => setPaymentMessage(e.target.value)}
                  placeholder="Ej: es la seña, ya transferí el depósito..."
                  rows={2}
                />
              </FormField>
              {/* A <label htmlFor> wrapping a visually-hidden <input> is the standard way to
                  restyle a file input: the browser's own file-picker chrome can't be
                  re-skinned directly, but clicking any element labelling the input still
                  opens it natively, no JS ref needed. Not using the shared FormField here
                  since it wraps its children in its own <label> — nesting a second <label>
                  inside it would be invalid. */}
              <label
                htmlFor="receipt-file-input"
                className={`inline-flex min-h-11 cursor-pointer items-center justify-center rounded border border-border bg-surface px-4 py-2 text-sm font-semibold text-text transition-all duration-150 hover:bg-border active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg ${
                  submittingPaymentUpdate ? 'pointer-events-none opacity-60' : ''
                }`}
              >
                {selectedFiles.length > 0
                  ? `${selectedFiles.length} archivo${selectedFiles.length > 1 ? 's' : ''} seleccionado${selectedFiles.length > 1 ? 's' : ''}`
                  : 'Elegir foto o archivo'}
              </label>
              <input
                ref={fileInputRef}
                id="receipt-file-input"
                type="file"
                accept="image/*"
                multiple
                onChange={handleImageFileChange}
                disabled={submittingPaymentUpdate}
                className="sr-only"
              />
              <p className="text-xs text-text-muted">
                También podés pegar una captura copiada (Ctrl+V) haciendo clic acá primero. Vale para la seña o
                para el depósito — subí las que tengas.
              </p>
              {paymentUpdateError && <Alert>{paymentUpdateError}</Alert>}
              {images.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {images.map((image) => (
                    <div key={image.id} className="flex flex-col items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setViewerImageId(image.id)}
                        title={image.originalName ?? 'Comprobante'}
                        className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                      >
                        <img
                          src={receiptImageUrl(token!, image.id)}
                          alt={image.originalName ?? 'Comprobante de pago'}
                          className="h-20 w-20 rounded border border-border object-cover"
                        />
                      </button>
                      {image.message && <p className="max-w-20 truncate text-xs text-text-muted">{image.message}</p>}
                    </div>
                  ))}
                </div>
              )}
              {viewerImageId && (
                <Lightbox
                  src={receiptImageUrl(token!, viewerImageId)}
                  alt={images.find((image) => image.id === viewerImageId)?.originalName ?? 'Comprobante de pago'}
                  onClose={() => setViewerImageId(null)}
                />
              )}
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                loading={submittingPaymentUpdate}
                disabled={selectedFiles.length === 0 && !paymentMessage.trim()}
                onClick={handleSubmitPaymentUpdate}
              >
                Actualizar datos de pagos
              </Button>
            </div>
          </>
        )}

        {step === 4 && (
          <Step4Confirmation
            reservation={reservation}
            token={token!}
            showAmbient={showAmbient}
            stepHeadingRef={stepHeadingRef}
          />
        )}
      </div>
    </PageShell>
  );
}
