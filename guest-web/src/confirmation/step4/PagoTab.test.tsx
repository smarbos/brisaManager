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
  confirmationPaymentCurrency: 'ARS',
  currency: 'ARS',
  askForPayment: true,
  askForDeposit: true,
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
  securityDepositCurrency: 'ARS',
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

  it('shows a fixed peso amount in pesos on a USD reservation, without a mixed-currency remainder', () => {
    render(
      <PagoTab
        reservation={{
          ...reservation,
          currency: 'USD',
          totalAmount: 1000,
          confirmationPaymentAmount: 210000,
          confirmationPaymentPercentage: null,
          confirmationPaymentCurrency: 'ARS',
          securityDepositAmount: 150,
          securityDepositCurrency: 'USD',
        }}
      />,
    );

    expect(screen.getByText('USD 1.000')).toBeInTheDocument();
    expect(screen.getByText('ARS 210.000')).toBeInTheDocument();
    expect(screen.getByText('USD 150')).toBeInTheDocument();
    expect(screen.queryByText('Restante a pagar en el lugar')).not.toBeInTheDocument();
  });

  it('reveals the bank transfer details when the accordion is opened', () => {
    render(<PagoTab reservation={reservation} />);

    expect(screen.queryByText('LABRISA.DEMO.ARS')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Datos de la cuenta para transferir'));

    expect(screen.getByText('LABRISA.DEMO.ARS')).toBeInTheDocument();
  });

  it('shows only the deposit when the reservation payment is not asked for', () => {
    render(<PagoTab reservation={{ ...reservation, askForPayment: false }} />);

    expect(screen.getByText('Depósito de garantía')).toBeInTheDocument();
    expect(screen.queryByText('Total a pagar')).not.toBeInTheDocument();
    expect(screen.queryByText(/pago de reserva/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Restante a pagar en el lugar')).not.toBeInTheDocument();
    expect(screen.getAllByText('✓ Confirmado')).toHaveLength(1);
  });

  it('leaves the deposit out when it is not asked for', () => {
    render(<PagoTab reservation={{ ...reservation, askForDeposit: false }} />);

    expect(screen.getByText('Total a pagar')).toBeInTheDocument();
    expect(screen.queryByText('Depósito de garantía')).not.toBeInTheDocument();
  });
});
