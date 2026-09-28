import { render, screen, fireEvent } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Step4Confirmation } from './Step4Confirmation';
import { GuestReservation } from '../types';
import * as ambientApi from '../../api/ambient';

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

describe('Step4Confirmation', () => {
  it('shows the Pago tab by default', () => {
    render(<Step4Confirmation reservation={reservation} token="tok-1" showAmbient={false} stepHeadingRef={createRef()} />);

    expect(screen.getByRole('tab', { name: /pago/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Total a pagar')).toBeInTheDocument();
    expect(document.querySelector('#panel-pago')).toBeVisible();
    expect(document.querySelector('#panel-llegar')).not.toBeVisible();
  });

  it('switches to another tab on click', () => {
    render(<Step4Confirmation reservation={reservation} token="tok-1" showAmbient={false} stepHeadingRef={createRef()} />);

    fireEvent.click(screen.getByRole('tab', { name: /cómo llegar/i }));

    expect(screen.getByRole('tab', { name: /cómo llegar/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Formosa 259, Depto L')).toBeInTheDocument();
    expect(document.querySelector('#panel-llegar')).toBeVisible();
    expect(document.querySelector('#panel-pago')).not.toBeVisible();
  });

  it('moves to the next tab with ArrowRight and moves focus with it', () => {
    render(<Step4Confirmation reservation={reservation} token="tok-1" showAmbient={false} stepHeadingRef={createRef()} />);

    const pagoTab = screen.getByRole('tab', { name: /pago/i });
    pagoTab.focus();
    fireEvent.keyDown(pagoTab, { key: 'ArrowRight' });

    const llegarTab = screen.getByRole('tab', { name: /cómo llegar/i });
    expect(llegarTab).toHaveAttribute('aria-selected', 'true');
    expect(llegarTab).toHaveFocus();
  });

  it('wraps from the last tab back to the first with ArrowRight', () => {
    render(<Step4Confirmation reservation={reservation} token="tok-1" showAmbient={false} stepHeadingRef={createRef()} />);

    const zonaTab = screen.getByRole('tab', { name: /la zona/i });
    zonaTab.focus();
    fireEvent.keyDown(zonaTab, { key: 'ArrowRight' });

    expect(screen.getByRole('tab', { name: /pago/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('only shows the Sensores tab when showAmbient is true', () => {
    vi.spyOn(ambientApi, 'getAmbientReadings').mockResolvedValue([]);
    const { rerender } = render(
      <Step4Confirmation reservation={reservation} token="tok-1" showAmbient={false} stepHeadingRef={createRef()} />,
    );

    expect(screen.queryByRole('tab', { name: /sensores/i })).not.toBeInTheDocument();

    rerender(<Step4Confirmation reservation={reservation} token="tok-1" showAmbient={true} stepHeadingRef={createRef()} />);

    expect(screen.getByRole('tab', { name: /sensores/i })).toBeInTheDocument();
  });
});
