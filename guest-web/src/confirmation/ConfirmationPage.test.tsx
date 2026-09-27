import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmationPage } from './ConfirmationPage';
import * as publicApi from '../api/publicReservations';
import * as reservationImagesApi from '../api/reservationImages';
import * as configApi from '../api/config';
import * as ambientApi from '../api/ambient';
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
      expect(confirmSpy).toHaveBeenCalledWith('tok-1', 'Jane Doe', '+542235550123', 'jane@example.com'),
    );
  });

  it('accepts a foreign phone number typed with its own country code', async () => {
    vi.spyOn(publicApi, 'getReservationByToken').mockResolvedValue({ ...baseReservation });
    const confirmSpy = vi
      .spyOn(publicApi, 'confirmDates')
      .mockResolvedValue({ datesConfirmedAt: '2026-01-01T00:00:00.000Z' });

    renderAt('tok-1');

    await screen.findByText(/confirmá tu reserva/i);

    fireEvent.change(screen.getByLabelText(/nombre completo/i), { target: { value: 'John Smith' } });
    fireEvent.change(screen.getByLabelText(/celular/i), { target: { value: '+1 202 555 0123' } });
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'john@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /confirmar fechas y huéspedes/i }));

    await waitFor(() =>
      expect(confirmSpy).toHaveBeenCalledWith('tok-1', 'John Smith', '+12025550123', 'john@example.com'),
    );
  });

  it('blocks submission and shows an inline error for an invalid phone number', async () => {
    vi.spyOn(publicApi, 'getReservationByToken').mockResolvedValue({ ...baseReservation });
    const confirmSpy = vi.spyOn(publicApi, 'confirmDates');

    renderAt('tok-1');

    await screen.findByText(/confirmá tu reserva/i);

    fireEvent.change(screen.getByLabelText(/nombre completo/i), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByLabelText(/celular/i), { target: { value: '123' } });
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'jane@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /confirmar fechas y huéspedes/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/número de teléfono válido/i);
    expect(confirmSpy).not.toHaveBeenCalled();
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

  it('disables "Actualizar datos de pagos" until a file is selected or a message is typed', async () => {
    vi.spyOn(publicApi, 'getReservationByToken').mockResolvedValue({
      ...baseReservation,
      datesConfirmedAt: '2026-01-01T00:00:00.000Z',
      contractAcceptedAt: '2026-01-01T00:00:00.000Z',
      contractAcceptedName: 'Jane Doe',
    });
    vi.spyOn(reservationImagesApi, 'listReceiptImages').mockResolvedValue([]);

    renderAt('tok-1');

    const submitButton = await screen.findByRole('button', { name: /actualizar datos de pagos/i });
    expect(submitButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/mensaje \(opcional\)/i), { target: { value: 'es la seña' } });
    expect(submitButton).toBeEnabled();
  });

  it('submits selected files with the typed message, no confirmation needed, and shows the results in the gallery', async () => {
    vi.spyOn(publicApi, 'getReservationByToken').mockResolvedValue({
      ...baseReservation,
      datesConfirmedAt: '2026-01-01T00:00:00.000Z',
      contractAcceptedAt: '2026-01-01T00:00:00.000Z',
      contractAcceptedName: 'Jane Doe',
    });
    vi.spyOn(reservationImagesApi, 'listReceiptImages').mockResolvedValue([]);
    const confirmSpy = vi.spyOn(window, 'confirm');
    const submitSpy = vi.spyOn(reservationImagesApi, 'submitPaymentUpdate').mockResolvedValue({
      images: [
        {
          id: 'img-1',
          reservationId: 'res-1',
          originalName: 'comprobante.png',
          mimeType: 'image/png',
          sizeBytes: 123,
          message: 'es la seña',
          createdAt: '2026-01-02T00:00:00.000Z',
        },
      ],
    });

    renderAt('tok-1');

    const input = await screen.findByLabelText(/elegir foto o archivo/i);
    const file = new File(['fake-image-bytes'], 'comprobante.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText(/mensaje \(opcional\)/i), { target: { value: 'es la seña' } });
    fireEvent.click(screen.getByRole('button', { name: /actualizar datos de pagos/i }));

    await waitFor(() => expect(submitSpy).toHaveBeenCalledWith('tok-1', [file], 'es la seña'));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(await screen.findByAltText('comprobante.png')).toBeInTheDocument();
  });

  it('shows receipts already uploaded on a previous visit, with their caption', async () => {
    vi.spyOn(publicApi, 'getReservationByToken').mockResolvedValue({
      ...baseReservation,
      datesConfirmedAt: '2026-01-01T00:00:00.000Z',
      contractAcceptedAt: '2026-01-01T00:00:00.000Z',
      contractAcceptedName: 'Jane Doe',
    });
    vi.spyOn(reservationImagesApi, 'listReceiptImages').mockResolvedValue([
      {
        id: 'img-1',
        reservationId: 'res-1',
        originalName: 'comprobante.png',
        mimeType: 'image/png',
        sizeBytes: 123,
        message: 'es la seña',
        createdAt: '2026-01-02T00:00:00.000Z',
      },
    ]);

    renderAt('tok-1');

    expect(await screen.findByAltText('comprobante.png')).toBeInTheDocument();
    expect(screen.getByText('es la seña')).toBeInTheDocument();
  });

  it('opens an uploaded receipt in a lightbox viewer when clicked, and closes it', async () => {
    vi.spyOn(publicApi, 'getReservationByToken').mockResolvedValue({
      ...baseReservation,
      datesConfirmedAt: '2026-01-01T00:00:00.000Z',
      contractAcceptedAt: '2026-01-01T00:00:00.000Z',
      contractAcceptedName: 'Jane Doe',
    });
    vi.spyOn(reservationImagesApi, 'listReceiptImages').mockResolvedValue([
      {
        id: 'img-1',
        reservationId: 'res-1',
        originalName: 'comprobante.png',
        mimeType: 'image/png',
        sizeBytes: 123,
        message: null,
        createdAt: '2026-01-02T00:00:00.000Z',
      },
    ]);

    renderAt('tok-1');

    const thumbnail = await screen.findByAltText('comprobante.png');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(thumbnail);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('img')).toHaveAttribute('alt', 'comprobante.png');

    fireEvent.click(screen.getByRole('button', { name: /cerrar/i }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('asks for confirmation before submitting a message with no files, and submits on Aceptar', async () => {
    const getSpy = vi.spyOn(publicApi, 'getReservationByToken').mockResolvedValue({
      ...baseReservation,
      datesConfirmedAt: '2026-01-01T00:00:00.000Z',
      contractAcceptedAt: '2026-01-01T00:00:00.000Z',
      contractAcceptedName: 'Jane Doe',
    });
    vi.spyOn(reservationImagesApi, 'listReceiptImages').mockResolvedValue([]);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const submitSpy = vi.spyOn(reservationImagesApi, 'submitPaymentUpdate').mockResolvedValue({ images: [] });

    renderAt('tok-1');

    fireEvent.change(await screen.findByLabelText(/mensaje \(opcional\)/i), {
      target: { value: 'todavía no transferí' },
    });
    fireEvent.click(screen.getByRole('button', { name: /actualizar datos de pagos/i }));

    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => expect(submitSpy).toHaveBeenCalledWith('tok-1', [], 'todavía no transferí'));
    // Re-fetches payment status too, same as the old standalone refresh button.
    await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(2));
  });

  it('does not submit a message-only update when the confirmation is declined', async () => {
    vi.spyOn(publicApi, 'getReservationByToken').mockResolvedValue({
      ...baseReservation,
      datesConfirmedAt: '2026-01-01T00:00:00.000Z',
      contractAcceptedAt: '2026-01-01T00:00:00.000Z',
      contractAcceptedName: 'Jane Doe',
    });
    vi.spyOn(reservationImagesApi, 'listReceiptImages').mockResolvedValue([]);
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const submitSpy = vi.spyOn(reservationImagesApi, 'submitPaymentUpdate');

    renderAt('tok-1');

    fireEvent.change(await screen.findByLabelText(/mensaje \(opcional\)/i), {
      target: { value: 'todavía no transferí' },
    });
    fireEvent.click(screen.getByRole('button', { name: /actualizar datos de pagos/i }));

    expect(submitSpy).not.toHaveBeenCalled();
  });

  it('shows an error notice when the submission fails', async () => {
    vi.spyOn(publicApi, 'getReservationByToken').mockResolvedValue({
      ...baseReservation,
      datesConfirmedAt: '2026-01-01T00:00:00.000Z',
      contractAcceptedAt: '2026-01-01T00:00:00.000Z',
      contractAcceptedName: 'Jane Doe',
    });
    vi.spyOn(reservationImagesApi, 'listReceiptImages').mockResolvedValue([]);
    vi.spyOn(reservationImagesApi, 'submitPaymentUpdate').mockRejectedValue(new Error('network error'));

    renderAt('tok-1');

    const input = await screen.findByLabelText(/elegir foto o archivo/i);
    const file = new File(['fake-image-bytes'], 'comprobante.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: /actualizar datos de pagos/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/no pudimos actualizar los datos de pago/i);
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

  it('shows ambient sensor status once fully confirmed and during the stay dates', async () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    vi.spyOn(configApi, 'getConfig').mockResolvedValue({ debugMode: false });
    vi.spyOn(publicApi, 'getReservationByToken').mockResolvedValue({
      ...baseReservation,
      checkIn: yesterday,
      checkOut: tomorrow,
      datesConfirmedAt: '2026-01-01T00:00:00.000Z',
      contractAcceptedAt: '2026-01-01T00:00:00.000Z',
      confirmationPaymentReceivedAt: '2026-01-02T00:00:00.000Z',
      depositReceivedAt: '2026-01-02T00:00:00.000Z',
    });
    vi.spyOn(ambientApi, 'getAmbientReadings').mockResolvedValue([
      { id: 'dev-1', name: 'Living room', online: true, lastSeenAt: now.toISOString(), readings: [] },
    ]);

    renderAt('tok-1');

    expect(await screen.findByText('Living room')).toBeInTheDocument();
  });

  it('does not show ambient sensor status outside the stay dates, even when fully confirmed', async () => {
    vi.spyOn(configApi, 'getConfig').mockResolvedValue({ debugMode: false });
    vi.spyOn(publicApi, 'getReservationByToken').mockResolvedValue({
      ...baseReservation,
      datesConfirmedAt: '2026-01-01T00:00:00.000Z',
      contractAcceptedAt: '2026-01-01T00:00:00.000Z',
      confirmationPaymentReceivedAt: '2026-01-02T00:00:00.000Z',
      depositReceivedAt: '2026-01-02T00:00:00.000Z',
    });
    const getAmbientReadings = vi.spyOn(ambientApi, 'getAmbientReadings');

    renderAt('tok-1');

    await screen.findByText(/pago confirmado/i);
    expect(getAmbientReadings).not.toHaveBeenCalled();
  });

  it('shows ambient sensor status regardless of confirmation or dates when debug mode is on', async () => {
    vi.spyOn(configApi, 'getConfig').mockResolvedValue({ debugMode: true });
    vi.spyOn(publicApi, 'getReservationByToken').mockResolvedValue({ ...baseReservation });
    vi.spyOn(ambientApi, 'getAmbientReadings').mockResolvedValue([
      { id: 'dev-1', name: 'Living room', online: true, lastSeenAt: null, readings: [] },
    ]);

    renderAt('tok-1');

    expect(await screen.findByText('Living room')).toBeInTheDocument();
  });

  it('does not show ambient sensor status during the stay dates when not yet fully confirmed', async () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    vi.spyOn(configApi, 'getConfig').mockResolvedValue({ debugMode: false });
    vi.spyOn(publicApi, 'getReservationByToken').mockResolvedValue({
      ...baseReservation,
      checkIn: yesterday,
      checkOut: tomorrow,
      // Dates confirmed and contract accepted, but payment/deposit still pending — this
      // reservation is "in range" but not "fully confirmed", the other half of the AND from
      // the previous test (which was fully confirmed but out of range).
      datesConfirmedAt: '2026-01-01T00:00:00.000Z',
      contractAcceptedAt: '2026-01-01T00:00:00.000Z',
      confirmationPaymentReceivedAt: null,
      depositReceivedAt: null,
    });
    const getAmbientReadings = vi.spyOn(ambientApi, 'getAmbientReadings');

    renderAt('tok-1');

    await screen.findByText(/pago y garantía/i);
    expect(getAmbientReadings).not.toHaveBeenCalled();
  });
});
