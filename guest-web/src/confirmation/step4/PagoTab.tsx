import { useState } from 'react';
import { GuestReservation } from '../types';
import { BankDetails } from '../BankDetails';
import { Badge } from '../../ui';

function formatMoney(currency: string, amount: number): string {
  return `${currency} ${amount.toLocaleString('es-AR')}`;
}

function ChevronIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function PagoTab({ reservation }: { reservation: GuestReservation }) {
  const [isOpen, setIsOpen] = useState(false);
  const remainingAtProperty = reservation.totalAmount - reservation.confirmationPaymentAmount;

  return (
    <div>
      <h3 className="font-heading text-lg font-semibold text-heading">Información de pago</h3>
      <p className="mt-1 text-sm text-text-muted">Así está el estado de cada pago de tu estadía.</p>

      {/* Both badges below are unconditional, not gated on confirmationPaymentReceivedAt/depositReceivedAt - safe because ConfirmationPage's currentStep() only reaches step 4 (the only place this component renders) once both are already set. */}
      <dl className="mt-4 flex flex-col gap-3 text-sm">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <dt className="font-semibold text-heading">Total a pagar</dt>
          <dd className="font-heading text-lg font-bold text-accent">
            {formatMoney(reservation.currency, reservation.totalAmount)}
          </dd>
        </div>
        <div className="flex items-center justify-between border-b border-border pb-3">
          <dt className="text-text-muted">
            Pago de reserva
            {reservation.confirmationPaymentPercentage !== null && ` (${reservation.confirmationPaymentPercentage}%)`}
          </dt>
          <dd className="flex items-center gap-2 font-semibold text-heading">
            {formatMoney(reservation.currency, reservation.confirmationPaymentAmount)}
            <Badge tone="success">✓ Confirmado</Badge>
          </dd>
        </div>
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div>
            <dt className="text-text-muted">Restante a pagar en el lugar</dt>
            <p className="text-xs text-text-muted">Se abona al momento del check-in.</p>
          </div>
          <dd className="font-semibold text-heading">{formatMoney(reservation.currency, remainingAtProperty)}</dd>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <dt className="text-text-muted">Depósito de garantía</dt>
            <p className="whitespace-pre-wrap text-xs text-text-muted">{reservation.depositInstructions}</p>
          </div>
          <dd className="flex items-center gap-2 font-semibold text-heading">
            {formatMoney(reservation.currency, reservation.securityDepositAmount)}
            <Badge tone="success">✓ Confirmado</Badge>
          </dd>
        </div>
      </dl>

      <div className="mt-4 overflow-hidden rounded-lg border border-border">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          aria-expanded={isOpen}
          aria-controls="pago-bank-details"
          className="flex w-full cursor-pointer items-center justify-between bg-bg px-4 py-3 text-sm font-semibold text-heading hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          Datos de la cuenta para transferir
          <ChevronIcon />
        </button>
        {isOpen && (
          <div id="pago-bank-details" className="p-4">
            <BankDetails
              accountHolder={reservation.bankAccountHolder}
              cuil={reservation.bankCuil}
              accountNumber={reservation.bankAccountNumber}
              cbu={reservation.bankCbu}
              alias={reservation.bankAlias}
              bankName={reservation.bankName}
            />
          </div>
        )}
      </div>
    </div>
  );
}
