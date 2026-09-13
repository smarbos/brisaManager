import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmationPage } from './ConfirmationPage';
import * as publicApi from '../api/publicReservations';

const baseReservation = {
  guestName: 'Jane Doe',
  checkIn: '2026-03-01',
  checkOut: '2026-03-05',
  paxCount: 2,
  totalAmount: 100000,
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
    vi.spyOn(publicApi, 'getReservationByToken').mockRejectedValue(new Error('404'));

    renderAt('bad-token');

    expect(await screen.findByText(/reservation not found/i)).toBeInTheDocument();
  });

  it('renders reservation details and confirms dates', async () => {
    vi.spyOn(publicApi, 'getReservationByToken').mockResolvedValue({ ...baseReservation });
    const confirmSpy = vi
      .spyOn(publicApi, 'confirmDates')
      .mockResolvedValue({ datesConfirmedAt: '2026-01-01T00:00:00.000Z' });

    renderAt('tok-1');

    expect(await screen.findByText(/jane doe/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /confirm dates and guests/i }));

    await waitFor(() => expect(confirmSpy).toHaveBeenCalledWith('tok-1'));
  });

  it('submits the contract acceptance form with the typed name', async () => {
    vi.spyOn(publicApi, 'getReservationByToken').mockResolvedValue({ ...baseReservation });
    const acceptSpy = vi
      .spyOn(publicApi, 'acceptContract')
      .mockResolvedValue({ contractAcceptedAt: '2026-01-01T00:00:00.000Z' });

    renderAt('tok-1');

    await screen.findByText(/jane doe/i);

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Jane Doe' } });
    fireEvent.click(screen.getByRole('button', { name: /i accept the house rules/i }));

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

    expect(await screen.findByText(/fully confirmed/i)).toBeInTheDocument();
  });
});
