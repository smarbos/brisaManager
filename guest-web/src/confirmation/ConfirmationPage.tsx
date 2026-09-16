import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { acceptContract, confirmDates, getReservationByToken } from '../api/publicReservations';
import { GuestReservation } from './types';
import { Alert, Badge, Button, FormField, Input } from '../ui';
import { formatDate } from '../lib/date';

type Step = 1 | 2 | 3;

const STEP_LABELS: Record<Step, string> = { 1: 'Reserva', 2: 'Reglas', 3: 'Pago' };

function currentStep(reservation: GuestReservation): Step {
  if (!reservation.datesConfirmedAt) {
    return 1;
  }
  if (!reservation.contractAcceptedAt) {
    return 2;
  }
  return 3;
}

function formatMoney(currency: string, amount: number): string {
  return `${currency} ${amount.toLocaleString('es-AR')}`;
}

function copyToClipboard(value: string) {
  if (!value) return;
  navigator.clipboard?.writeText(value).catch(() => {});
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
    <div className="mx-auto flex max-w-md gap-2 px-4">
      {([1, 2, 3] as Step[]).map((s) => (
        <div key={s} className="flex-1">
          <div className={`h-1 rounded-full ${s <= step ? 'bg-accent' : 'bg-border'}`} />
          <p className={`mt-1 text-xs ${s === step ? 'font-semibold text-heading' : 'text-text-muted'}`}>
            {STEP_LABELS[s]}
          </p>
        </div>
      ))}
    </div>
  );
}

function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-bg px-4 py-8">
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
        La Brisa de Mar del Plata · checkin.labrisa.com.ar
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
  const [email, setEmail] = useState('');
  const [rulesChecked, setRulesChecked] = useState(false);
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

  async function handleConfirmDates(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setError(null);
    try {
      await confirmDates(token, fullName, phone, email);
      load();
    } catch {
      setError('No pudimos confirmar tus datos. Por favor, intentá de nuevo.');
    }
  }

  async function handleAcceptContract() {
    if (!token) return;
    setError(null);
    try {
      await acceptContract(token);
      load();
    } catch {
      setError('No pudimos registrar la aceptación del contrato. Por favor, intentá de nuevo.');
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
  const ruleLines = reservation.houseRulesText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const fullyConfirmed = Boolean(reservation.confirmationPaymentReceivedAt && reservation.depositReceivedAt);

  return (
    <PageShell>
      <StepIndicator step={step} />

      <div className="mx-auto mt-6 max-w-md rounded-xl bg-surface p-6 shadow-sm">
        {error && <Alert>{error}</Alert>}

        {step === 1 && (
          <>
            <h2 className="font-heading text-xl font-bold text-heading">Confirmá tu reserva</h2>
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
              <div>
                <p className="text-xs text-text-muted">Total de la estadía</p>
                <p className="font-heading text-lg font-bold text-heading">
                  {formatMoney(reservation.currency, reservation.totalAmount)}
                </p>
              </div>
            </div>

            <form onSubmit={handleConfirmDates} className="mt-6 flex flex-col gap-4">
              <FormField label="Nombre completo">
                <Input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Como figura en tu reserva"
                  required
                />
              </FormField>
              <div className="grid grid-cols-2 gap-4">
                <FormField label="Celular">
                  <Input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+54 9 223 ..."
                    required
                  />
                </FormField>
                <FormField label="Email">
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="vos@mail.com"
                    required
                  />
                </FormField>
              </div>
              <Button type="submit" className="w-full">
                Confirmar fechas y huéspedes
              </Button>
            </form>
          </>
        )}

        {step === 2 && (
          <>
            <Badge tone="success">✓ Reserva confirmada</Badge>
            <h2 className="mt-2 font-heading text-xl font-bold text-heading">Reglas de la casa</h2>
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

            <label className="mt-4 flex items-start gap-2 text-sm text-text">
              <input
                type="checkbox"
                checked={rulesChecked}
                onChange={(e) => setRulesChecked(e.target.checked)}
                className="mt-1"
              />
              <span>
                Leí y acepto las reglas de la casa. Entiendo que su incumplimiento puede ocasionar la pérdida
                parcial o total del depósito de garantía.
              </span>
            </label>

            <Button type="button" className="mt-4 w-full" disabled={!rulesChecked} onClick={handleAcceptContract}>
              Acepto las reglas de la casa
            </Button>
          </>
        )}

        {step === 3 && (
          <>
            <Badge tone="success">✓ Reglas aceptadas</Badge>
            <h2 className="mt-2 font-heading text-xl font-bold text-heading">Pago y garantía</h2>
            <p className="mt-1 text-sm text-text-muted">
              Transferí el importe a la cuenta indicada y compartinos el comprobante. Acá vas a ver el estado de
              cada pago.
            </p>

            <div className="mt-4 rounded-lg bg-bg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-heading">Confirmación de reserva (30%)</p>
                  <p className="text-sm text-text-muted">
                    {formatMoney(reservation.currency, reservation.confirmationPaymentAmount)}
                  </p>
                </div>
                <Badge tone={reservation.confirmationPaymentReceivedAt ? 'success' : 'warning'}>
                  {reservation.confirmationPaymentReceivedAt ? 'Recibido' : 'Pendiente'}
                </Badge>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
                <dt className="text-text-muted">Titular</dt>
                <dd className="text-right font-medium text-heading">{reservation.bankAccountHolder}</dd>
                <dt className="text-text-muted">CUIL</dt>
                <dd className="text-right font-medium text-heading">{reservation.bankCuil}</dd>
                <dt className="text-text-muted">Caja de ahorro en pesos</dt>
                <dd className="text-right font-medium text-heading">{reservation.bankAccountNumber}</dd>
                <dt className="text-text-muted">CBU</dt>
                <dd className="flex items-center justify-end gap-2 text-right font-medium text-heading">
                  <span>{reservation.bankCbu}</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(reservation.bankCbu)}
                    className="text-xs font-semibold text-accent underline"
                  >
                    Copiar
                  </button>
                </dd>
                <dt className="text-text-muted">Alias</dt>
                <dd className="flex items-center justify-end gap-2 text-right font-medium text-heading">
                  <span>{reservation.bankAlias}</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(reservation.bankAlias)}
                    className="text-xs font-semibold text-accent underline"
                  >
                    Copiar
                  </button>
                </dd>
                <dt className="text-text-muted">Banco</dt>
                <dd className="text-right font-medium text-heading">{reservation.bankName}</dd>
              </dl>
              <p className="mt-4 rounded bg-surface p-3 text-xs text-text-muted">
                Una vez transferido, enviá el comprobante por WhatsApp o email para que actualicemos el estado del
                pago.
              </p>
            </div>

            <div className="mt-4 rounded-lg bg-bg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-heading">Depósito de garantía</p>
                  <p className="text-sm text-text-muted">
                    {formatMoney(reservation.currency, reservation.securityDepositAmount)} · se cobra al check-in
                  </p>
                </div>
                <Badge tone={reservation.depositReceivedAt ? 'success' : 'warning'}>
                  {reservation.depositReceivedAt ? 'Recibido' : 'Pendiente'}
                </Badge>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm text-text-muted">{reservation.depositInstructions}</p>
            </div>

            <Button type="button" variant="secondary" className="mt-4 w-full" onClick={load}>
              Actualizar estado de los pagos
            </Button>

            {fullyConfirmed && (
              <p className="mt-4 text-center text-text">Tu reserva está completamente confirmada. ¡Te esperamos!</p>
            )}
          </>
        )}
      </div>
    </PageShell>
  );
}
