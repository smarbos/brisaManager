import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmailsPage } from './EmailsPage';
import * as outboundEmailsApi from '../api/outbound-emails';
import { ApiError } from '../api/client';
import type { OutboundEmail } from '../api/outbound-emails';

function email(overrides: Partial<OutboundEmail>): OutboundEmail {
  return {
    id: 'e1',
    kind: 'INITIAL_CONFIRMATION',
    status: 'SCHEDULED',
    to: 'guest@example.com',
    sentTo: null,
    subject: 'Confirmá tu reserva',
    html: '<p>Hola</p>',
    replyTo: null,
    sendAt: new Date(Date.now() + 4.5 * 60_000).toISOString(),
    sentAt: null,
    abortedAt: null,
    attempts: 0,
    lastError: null,
    reservationId: 'res-1',
    resentFromId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <EmailsPage />
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('EmailsPage', () => {
  it('lists emails with their kind, status, recipient and a countdown while scheduled', async () => {
    vi.spyOn(outboundEmailsApi, 'listOutboundEmails').mockResolvedValue([
      email({ id: 'e1' }),
      email({ id: 'e2', status: 'SENT', kind: 'ALERT', to: 'owner@example.com', sentTo: 'debug@example.com', sentAt: new Date().toISOString() }),
    ]);

    renderPage();

    const scheduledRow = await screen.findByTestId('outbound-email-e1');
    expect(within(scheduledRow).getByText('Programado')).toBeInTheDocument();
    expect(within(scheduledRow).getByText('Confirmación inicial')).toBeInTheDocument();
    expect(within(scheduledRow).getByText(/se envía en 4:/i)).toBeInTheDocument();

    const sentRow = screen.getByTestId('outbound-email-e2');
    expect(within(sentRow).getByText('Enviado')).toBeInTheDocument();
    expect(within(sentRow).getByText(/debug@example\.com/)).toBeInTheDocument();
  });

  it('offers the actions that fit each status', async () => {
    vi.spyOn(outboundEmailsApi, 'listOutboundEmails').mockResolvedValue([
      email({ id: 's', status: 'SCHEDULED' }),
      email({ id: 'f', status: 'FAILED', lastError: 'Domain not verified' }),
      email({ id: 'a', status: 'ABORTED' }),
    ]);

    renderPage();

    const scheduled = await screen.findByTestId('outbound-email-s');
    expect(within(scheduled).getByRole('button', { name: /abortar/i })).toBeInTheDocument();
    expect(within(scheduled).queryByRole('button', { name: /reenviar/i })).not.toBeInTheDocument();

    const failed = screen.getByTestId('outbound-email-f');
    expect(within(failed).getByRole('button', { name: /reintentar/i })).toBeInTheDocument();
    expect(within(failed).getByRole('button', { name: /reenviar/i })).toBeInTheDocument();
    expect(within(failed).getByText(/domain not verified/i)).toBeInTheDocument();

    const aborted = screen.getByTestId('outbound-email-a');
    expect(within(aborted).getByRole('button', { name: /reenviar/i })).toBeInTheDocument();
    expect(within(aborted).queryByRole('button', { name: /abortar/i })).not.toBeInTheDocument();
  });

  it('aborts a scheduled email and reloads the list', async () => {
    const listSpy = vi
      .spyOn(outboundEmailsApi, 'listOutboundEmails')
      .mockResolvedValueOnce([email({ id: 's' })])
      .mockResolvedValueOnce([email({ id: 's', status: 'ABORTED' })]);
    const abortSpy = vi.spyOn(outboundEmailsApi, 'abortOutboundEmail').mockResolvedValue(email({ status: 'ABORTED' }));

    renderPage();

    fireEvent.click(within(await screen.findByTestId('outbound-email-s')).getByRole('button', { name: /abortar/i }));

    await waitFor(() => expect(abortSpy).toHaveBeenCalledWith('s'));
    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(within(screen.getByTestId('outbound-email-s')).queryByRole('button', { name: /abortar/i })).not.toBeInTheDocument(),
    );
    expect(within(screen.getByTestId('outbound-email-s')).getAllByText('Abortado').length).toBeGreaterThan(0);
  });

  it('retries and resends through the API', async () => {
    vi.spyOn(outboundEmailsApi, 'listOutboundEmails').mockResolvedValue([email({ id: 'f', status: 'FAILED' })]);
    const retrySpy = vi.spyOn(outboundEmailsApi, 'retryOutboundEmail').mockResolvedValue(email({ status: 'SENT' }));
    const resendSpy = vi.spyOn(outboundEmailsApi, 'resendOutboundEmail').mockResolvedValue(email({ id: 'copy' }));

    renderPage();
    const row = await screen.findByTestId('outbound-email-f');

    fireEvent.click(within(row).getByRole('button', { name: /reintentar/i }));
    await waitFor(() => expect(retrySpy).toHaveBeenCalledWith('f'));

    fireEvent.click(within(screen.getByTestId('outbound-email-f')).getByRole('button', { name: /reenviar/i }));
    await waitFor(() => expect(resendSpy).toHaveBeenCalledWith('f'));
  });

  it('shows the API’s reason when an action is refused', async () => {
    vi.spyOn(outboundEmailsApi, 'listOutboundEmails').mockResolvedValue([email({ id: 's' })]);
    vi.spyOn(outboundEmailsApi, 'abortOutboundEmail').mockRejectedValue(
      new ApiError(409, JSON.stringify({ statusCode: 409, message: 'Este email ya no está programado: no se puede abortar.' })),
    );

    renderPage();
    fireEvent.click(within(await screen.findByTestId('outbound-email-s')).getByRole('button', { name: /abortar/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('no se puede abortar');
  });

  it('filters by status', async () => {
    const listSpy = vi.spyOn(outboundEmailsApi, 'listOutboundEmails').mockResolvedValue([]);

    renderPage();
    await waitFor(() => expect(listSpy).toHaveBeenCalledWith({}));

    fireEvent.click(screen.getByRole('tab', { name: /fallidos/i }));

    await waitFor(() => expect(listSpy).toHaveBeenLastCalledWith({ status: 'FAILED' }));
  });

  it('previews an email in a sandboxed frame', async () => {
    vi.spyOn(outboundEmailsApi, 'listOutboundEmails').mockResolvedValue([email({ id: 'e1', html: '<p>Hola Jane</p>' })]);

    renderPage();
    fireEvent.click(within(await screen.findByTestId('outbound-email-e1')).getByRole('button', { name: /ver/i }));

    const frame = await screen.findByTitle('Vista previa: Confirmá tu reserva');
    expect(frame).toHaveAttribute('sandbox', '');
    expect(frame).toHaveAttribute('srcdoc', '<p>Hola Jane</p>');
  });
});
