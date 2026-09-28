import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PagoTab } from './PagoTab';
import { GuestReservation } from '../types';

const reservation: GuestReservation = {
  guestName: 'Jane Doe',
  checkIn: '2026-03-01',
  checkOut: '2026-03-05',
  paxCount: 2,
  totalAmount: 100000,
  confirmationPaymentAmount: 30000,
  confirmationPaymentPercentage: 30,
  currency: 'ARS',
  datesConfirmedAt: '2026-01-01T00:00:00.000Z',
  contractAcceptedAt: '2026-01-01T00:00:00.000Z',
  contractAcceptedName: 'Jane Doe',
  contractSnapshot: 'No parties.',
  confirmationPaymentReceivedAt: '2026-01-02T00:00:00.000Z',
  depositReceivedAt: '2026-01-02T00:00:00.000Z',
  houseRulesText: 'No parties.',
  paymentInstructions: 'Transfer to bank X.',
  depositInstructions: 'Deposit charged at check-in.',
  confirmationStepText: 'All done, see you soon!',
  bankAccountHolder: 'Ana Pérez',
  bankCuil: '20123456789',
  bankAccountNumber: '0001234567',
  bankCbu: '0000003100012345678901',
  bankAlias: 'LABRISA.DEMO.ARS',
  bankName: 'Banco Ejemplo',
  securityDepositAmount: 150000,
};

describe('PagoTab', () => {
  it('shows the payment summary with both confirmed badges', () => {
    render(<PagoTab reservation={reservation} />);

    expect(screen.getByText('Total a pagar')).toBeInTheDocument();
    expect(screen.getByText('ARS 100.000')).toBeInTheDocument();
    expect(screen.getByText(/pago de reserva \(30%\)/i)).toBeInTheDocument();
    expect(screen.getByText('Restante a pagar en el lugar')).toBeInTheDocument();
    expect(screen.getByText('ARS 70.000')).toBeInTheDocument();
    expect(screen.getAllByText('✓ Confirmado')).toHaveLength(2);
  });

  it('shows the payment label without a percentage when it is a fixed amount', () => {
    render(<PagoTab reservation={{ ...reservation, confirmationPaymentAmount: 45000, confirmationPaymentPercentage: null }} />);

    expect(screen.getByText('Pago de reserva')).toBeInTheDocument();
    expect(screen.queryByText(/pago de reserva \(/i)).not.toBeInTheDocument();
  });

  it('reveals the bank transfer details when the accordion is opened', () => {
    render(<PagoTab reservation={reservation} />);

    expect(screen.queryByText('LABRISA.DEMO.ARS')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Datos de la cuenta para transferir'));

    expect(screen.getByText('LABRISA.DEMO.ARS')).toBeInTheDocument();
  });
});
