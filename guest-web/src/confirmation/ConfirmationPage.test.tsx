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
  confirmationPaymentPercentage: 30,
  currency: 'ARS',
  datesConfirmedAt: null,
  contractAcceptedAt: null,
  contractAcceptedName: null,
  contractSnapshot: 'No parties.\nQuiet hours 10pm-8am.',
  confirmationPaymentReceivedAt: null,
  depositReceivedAt: null,
  houseRulesText: 'No parties.\nQuiet hours 10pm-8am.',
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

  it('starts at step 1 (Reserva), showing the reservation summary and the contact-info form', async () => {
    vi.spyOn(publicApi, 'getReservationByToken').mockResolvedValue({ ...baseReservation });

    renderAt('tok-1');

    expect(await screen.findByText(/confirmá tu reserva/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/nombre completo/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/celular/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
    // Step 2/3 content shouldn't be visible yet
    expect(screen.queryByText(/reglas de la casa/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/pago y garantía/i)).not.toBeInTheDocument();
  });

  it('hides the total-stay amount on step 1 when no total is known yet', async () => {
    vi.spyOn(publicApi, 'getReservationByToken').mockResolvedValue({ ...baseReservation, totalAmount: 0 });

    renderAt('tok-1');

    await screen.findByText(/confirmá tu reserva/i);
    expect(screen.queryByText(/total de la estadía/i)).not.toBeInTheDocument();
  });

  it('submits step 1 with name, phone, and email', async () => {
    vi.spyOn(publicApi, 'getReservationByToken').mockResolvedValue({ ...baseReservation });
    const confirmSpy = vi
      .spyOn(publicApi, 'confirmDates')
      .mockResolvedValue({ datesConfirmedAt: '2026-01-01T00:00:00.000Z' });

    renderAt('tok-1');

    await screen.findByText(/confirmá tu reserva/i);

    fireEvent.change(screen.getByLabelText(/nombre completo/i), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByLabelText(/celular/i), { target: { value: '2235550123' } });
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'jane@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /confirmar fechas y huéspedes/i }));

    await waitFor(() =>
      expect(confirmSpy).toHaveBeenCalledWith('tok-1', 'Jane Doe', '+5492235550123', 'jane@example.com'),
    );
  });

  it('lets a guest override the country code for a non-Argentine phone number', async () => {
    vi.spyOn(publicApi, 'getReservationByToken').mockResolvedValue({ ...baseReservation });
    const confirmSpy = vi
      .spyOn(publicApi, 'confirmDates')
      .mockResolvedValue({ datesConfirmedAt: '2026-01-01T00:00:00.000Z' });

    renderAt('tok-1');

    await screen.findByText(/confirmá tu reserva/i);

    fireEvent.change(screen.getByLabelText(/nombre completo/i), { target: { value: 'John Smith' } });
    fireEvent.change(screen.getByLabelText(/código/i), { target: { value: '+1' } });
    fireEvent.change(screen.getByLabelText(/celular/i), { target: { value: '2025551234' } });
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'john@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /confirmar fechas y huéspedes/i }));

    await waitFor(() =>
      expect(confirmSpy).toHaveBeenCalledWith('tok-1', 'John Smith', '+12025551234', 'john@example.com'),
    );
  });

  it('resumes at step 2 (house rules), listing each rule and requiring the checkbox before accepting', async () => {
    vi.spyOn(publicApi, 'getReservationByToken').mockResolvedValue({
      ...baseReservation,
      datesConfirmedAt: '2026-01-01T00:00:00.000Z',
    });
    const acceptSpy = vi
      .spyOn(publicApi, 'acceptContract')
      .mockResolvedValue({ contractAcceptedAt: '2026-01-01T00:00:00.000Z' });

    renderAt('tok-1');

    expect(await screen.findByText(/reserva confirmada/i)).toBeInTheDocument();
    expect(screen.getByText('No parties.')).toBeInTheDocument();
    expect(screen.getByText('Quiet hours 10pm-8am.')).toBeInTheDocument();
    // Step 1's form fields shouldn't be shown again
    expect(screen.queryByLabelText(/nombre completo/i)).not.toBeInTheDocument();

    const acceptButton = screen.getByRole('button', { name: /acepto las reglas de la casa/i });
    expect(acceptButton).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox'));
    expect(acceptButton).toBeEnabled();

    fireEvent.click(acceptButton);

    await waitFor(() => expect(acceptSpy).toHaveBeenCalledWith('tok-1'));
  });

  it('resumes at step 3 (payment), showing the bank details and deposit info', async () => {
    vi.spyOn(publicApi, 'getReservationByToken').mockResolvedValue({
      ...baseReservation,
      datesConfirmedAt: '2026-01-01T00:00:00.000Z',
      contractAcceptedAt: '2026-01-01T00:00:00.000Z',
      contractAcceptedName: 'Jane Doe',
    });

    renderAt('tok-1');

    expect(await screen.findByText(/reglas aceptadas/i)).toBeInTheDocument();
    expect(screen.getByText(/confirmación de reserva \(30%\)/i)).toBeInTheDocument();
    expect(screen.getByText('ARS 30.000')).toBeInTheDocument();
    expect(screen.getByText('Ana Pérez')).toBeInTheDocument();
    expect(screen.getByText('0000003100012345678901')).toBeInTheDocument();
    expect(screen.getByText('LABRISA.DEMO.ARS')).toBeInTheDocument();
    expect(screen.getByText(/depósito de garantía/i)).toBeInTheDocument();
    expect(screen.getByText('ARS 150.000 · se cobra al check-in')).toBeInTheDocument();
    expect(screen.getAllByText(/pendiente/i)).toHaveLength(2);
    expect(screen.queryByText(/acepto las reglas de la casa/i)).not.toBeInTheDocument();
    // The rules recap shouldn't be buried in the final step only — a guest deciding whether
    // to pay should be able to re-check what they agreed to right here, on step 3.
    expect(screen.getByRole('button', { name: /ver reglas de la casa/i })).toBeInTheDocument();
  });

  it('shows the confirmation payment label without a percentage when it is a fixed amount', async () => {
    vi.spyOn(publicApi, 'getReservationByToken').mockResolvedValue({
      ...baseReservation,
      datesConfirmedAt: '2026-01-01T00:00:00.000Z',
      contractAcceptedAt: '2026-01-01T00:00:00.000Z',
      confirmationPaymentAmount: 45000,
      confirmationPaymentPercentage: null,
    });

    renderAt('tok-1');

    expect(await screen.findByText('Confirmación de reserva')).toBeInTheDocument();
    expect(screen.queryByText(/confirmación de reserva \(/i)).not.toBeInTheDocument();
    expect(screen.getByText('ARS 45.000')).toBeInTheDocument();
  });

  it('re-fetches the reservation when "Actualizar estado de los pagos" is clicked', async () => {
    const getSpy = vi.spyOn(publicApi, 'getReservationByToken').mockResolvedValue({
      ...baseReservation,
      datesConfirmedAt: '2026-01-01T00:00:00.000Z',
      contractAcceptedAt: '2026-01-01T00:00:00.000Z',
    });

    renderAt('tok-1');

    await screen.findByText(/reglas aceptadas/i);
    fireEvent.click(screen.getByRole('button', { name: /actualizar estado de los pagos/i }));

    await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(2));
  });

  it('resumes at step 4 (Confirmación) once payment and deposit are both received, showing the totals breakdown', async () => {
    vi.spyOn(publicApi, 'getReservationByToken').mockResolvedValue({
      ...baseReservation,
      datesConfirmedAt: '2026-01-01T00:00:00.000Z',
      contractAcceptedAt: '2026-05-03T12:00:00.000Z',
      contractAcceptedName: 'Jane Doe',
      confirmationPaymentReceivedAt: '2026-01-02T00:00:00.000Z',
      depositReceivedAt: '2026-01-02T00:00:00.000Z',
    });

    renderAt('tok-1');

    expect(await screen.findByText('All done, see you soon!')).toBeInTheDocument();
    expect(screen.getByText(/pago confirmado/i)).toBeInTheDocument();
    expect(screen.getByText('Total a pagar')).toBeInTheDocument();
    expect(screen.getByText('ARS 100.000')).toBeInTheDocument();
    expect(screen.getByText(/pago de reserva \(30%\)/i)).toBeInTheDocument();
    expect(screen.getByText('Restante a pagar en el lugar')).toBeInTheDocument();
    expect(screen.getByText('ARS 70.000')).toBeInTheDocument();
    // Two checkmarks: one for the reservation payment, one for the deposit
    expect(screen.getAllByLabelText('Recibido')).toHaveLength(2);
  });

  it('reveals the accepted house rules and acceptance date when "Ver reglas de la casa" is clicked', async () => {
    vi.spyOn(publicApi, 'getReservationByToken').mockResolvedValue({
      ...baseReservation,
      datesConfirmedAt: '2026-01-01T00:00:00.000Z',
      contractAcceptedAt: '2026-05-03T12:00:00.000Z',
      contractAcceptedName: 'Jane Doe',
      contractSnapshot: 'Snapshot rule text.',
      confirmationPaymentReceivedAt: '2026-01-02T00:00:00.000Z',
      depositReceivedAt: '2026-01-02T00:00:00.000Z',
    });

    renderAt('tok-1');

    await screen.findByText(/pago confirmado/i);
    expect(screen.queryByText('Snapshot rule text.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /ver reglas de la casa/i }));

    expect(screen.getByText('Snapshot rule text.')).toBeInTheDocument();
    expect(screen.getByText(/aceptadas el 3 de mayo de 2026/i)).toBeInTheDocument();
  });

  it('does not show a checkmark next to a payment that has not been received yet', async () => {
    vi.spyOn(publicApi, 'getReservationByToken').mockResolvedValue({
      ...baseReservation,
      datesConfirmedAt: '2026-01-01T00:00:00.000Z',
      contractAcceptedAt: '2026-01-01T00:00:00.000Z',
      confirmationPaymentReceivedAt: '2026-01-02T00:00:00.000Z',
      depositReceivedAt: null,
    });

    renderAt('tok-1');

    // Deposit still Pendiente, so still on step 3 — the deposit checkmark only ever
    // appears on step 4, which isn't reached until both are received.
    expect(await screen.findByText(/reglas aceptadas/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Recibido')).not.toBeInTheDocument();
  });
});
