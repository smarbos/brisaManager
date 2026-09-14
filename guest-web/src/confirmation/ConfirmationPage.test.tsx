import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmationPage } from './ConfirmationPage';
import * as publicApi from '../api/publicReservations';
import { ApiError } from '../api/client';

const baseReservation = {
  guestName: 'Jane Doe',
  checkIn: '2026-03-01',
  checkOut: '2026-03-05',
  paxCount: 2,
  totalAmount: 100000,
  confirmationPaymentAmount: 30000,
  currency: 'ARS',
  datesConfirmedAt: null,
  contractAcceptedAt: null,
  contractAcceptedName: null,
  confirmationPaymentReceivedAt: null,
  depositReceivedAt: null,
  houseRulesText: 'No parties.',
  paymentInstructions: 'Transfer to bank X.',
};

function renderAt(token: string) {
  return render(
    <MemoryRouter initialEntries={[`/r/${token}`]}>
      <Routes>
        <Route path="/r/:token" element={<ConfirmationPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ConfirmationPage', () => {
  it('shows a not-found message for an invalid token', async () => {
    vi.spyOn(publicApi, 'getReservationByToken').mockRejectedValue(new ApiError(404, 'Not Found'));

    renderAt('bad-token');

    expect(await screen.findByText(/reserva no encontrada/i)).toBeInTheDocument();
  });

  it('shows a distinct error message for a non-404 failure, without implying the link is invalid', async () => {
    vi.spyOn(publicApi, 'getReservationByToken').mockRejectedValue(
      new ApiError(500, 'Internal Server Error'),
    );

    renderAt('tok-1');

    expect(await screen.findByText(/algo salió mal/i)).toBeInTheDocument();
    expect(screen.queryByText(/reserva no encontrada/i)).not.toBeInTheDocument();
  });

  it('displays the 30% confirmation payment amount', async () => {
    vi.spyOn(publicApi, 'getReservationByToken').mockResolvedValue({ ...baseReservation });

    renderAt('tok-1');

    expect(await screen.findByText(/pago de confirmación del 30% \(30000 ARS\)/i)).toBeInTheDocument();
  });

  it('renders reservation details and confirms dates', async () => {
    vi.spyOn(publicApi, 'getReservationByToken').mockResolvedValue({ ...baseReservation });
    const confirmSpy = vi
      .spyOn(publicApi, 'confirmDates')
      .mockResolvedValue({ datesConfirmedAt: '2026-01-01T00:00:00.000Z' });

    renderAt('tok-1');

    expect(await screen.findByText(/jane doe/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /confirmar fechas y huéspedes/i }));

    await waitFor(() => expect(confirmSpy).toHaveBeenCalledWith('tok-1'));
  });

  it('submits the contract acceptance form with the typed name', async () => {
    vi.spyOn(publicApi, 'getReservationByToken').mockResolvedValue({ ...baseReservation });
    const acceptSpy = vi
      .spyOn(publicApi, 'acceptContract')
      .mockResolvedValue({ contractAcceptedAt: '2026-01-01T00:00:00.000Z' });

    renderAt('tok-1');

    await screen.findByText(/jane doe/i);

    fireEvent.change(screen.getByLabelText(/nombre completo/i), { target: { value: 'Jane Doe' } });
    fireEvent.click(screen.getByRole('button', { name: /acepto las reglas de la casa/i }));

    await waitFor(() => expect(acceptSpy).toHaveBeenCalledWith('tok-1', 'Jane Doe'));
  });

  it('shows the final confirmed message once all 4 steps are done', async () => {
    vi.spyOn(publicApi, 'getReservationByToken').mockResolvedValue({
      ...baseReservation,
      datesConfirmedAt: '2026-01-01T00:00:00.000Z',
      contractAcceptedAt: '2026-01-01T00:00:00.000Z',
      contractAcceptedName: 'Jane Doe',
      confirmationPaymentReceivedAt: '2026-01-02T00:00:00.000Z',
      depositReceivedAt: '2026-01-02T00:00:00.000Z',
    });

    renderAt('tok-1');

    expect(await screen.findByText(/completamente confirmada/i)).toBeInTheDocument();
  });
});
