import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CampaignsPage } from './CampaignsPage';
import * as campaignsApi from '../api/campaigns';
import * as templatesApi from '../api/campaign-templates';

function renderPage() {
  return render(
    <MemoryRouter>
      <CampaignsPage />
    </MemoryRouter>,
  );
}

describe('CampaignsPage', () => {
  beforeEach(() => {
    vi.spyOn(templatesApi, 'listCampaignTemplates').mockResolvedValue([
      { id: 'tpl-1', name: 'Welcome back', subject: 'Hi {{guestName}}', bodyHtml: '<p>Hi</p>' },
    ]);
    vi.spyOn(campaignsApi, 'listCampaignHistory').mockResolvedValue([]);
  });

  it('previews the recipient count when a template and filter are chosen', async () => {
    const previewSpy = vi.spyOn(campaignsApi, 'previewCampaign').mockResolvedValue({ recipientCount: 5 });

    renderPage();

    await waitFor(() => expect(screen.getByText('Welcome back')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/plantilla/i), { target: { value: 'tpl-1' } });
    fireEvent.change(screen.getByLabelText(/filtro/i), { target: { value: 'ALL' } });

    await waitFor(() => expect(previewSpy).toHaveBeenCalledWith({ templateId: 'tpl-1', filterType: 'ALL' }));
    expect(await screen.findByText(/5 destinatario/i)).toBeInTheDocument();
  });

  it('requires confirmation before sending, then sends', async () => {
    vi.spyOn(campaignsApi, 'previewCampaign').mockResolvedValue({ recipientCount: 5 });
    const sendSpy = vi.spyOn(campaignsApi, 'sendCampaign').mockResolvedValue({
      id: 'camp-1',
      templateId: 'tpl-1',
      template: { name: 'Welcome back' },
      filterType: 'ALL',
      filterMonths: null,
      recipientCount: 5,
      sentAt: '2026-09-13T12:00:00.000Z',
      recipients: [],
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderPage();

    await waitFor(() => expect(screen.getByText('Welcome back')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/plantilla/i), { target: { value: 'tpl-1' } });
    fireEvent.change(screen.getByLabelText(/filtro/i), { target: { value: 'ALL' } });
    await waitFor(() => expect(screen.getByText(/5 destinatario/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /enviar campaña/i }));

    await waitFor(() => expect(sendSpy).toHaveBeenCalledWith({ templateId: 'tpl-1', filterType: 'ALL' }));
  });

  it('does not send when the confirmation is declined', async () => {
    vi.spyOn(campaignsApi, 'previewCampaign').mockResolvedValue({ recipientCount: 5 });
    const sendSpy = vi.spyOn(campaignsApi, 'sendCampaign');
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    renderPage();

    await waitFor(() => expect(screen.getByText('Welcome back')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/plantilla/i), { target: { value: 'tpl-1' } });
    fireEvent.change(screen.getByLabelText(/filtro/i), { target: { value: 'ALL' } });
    await waitFor(() => expect(screen.getByText(/5 destinatario/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /enviar campaña/i }));

    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('clears the displayed recipient count while a new preview is pending', async () => {
    vi.spyOn(templatesApi, 'listCampaignTemplates').mockResolvedValue([
      { id: 'tpl-1', name: 'Welcome back', subject: 'Hi {{guestName}}', bodyHtml: '<p>Hi</p>' },
      { id: 'tpl-2', name: 'Reminder', subject: 'Hi {{guestName}}', bodyHtml: '<p>Hi</p>' },
    ]);

    let resolveSecondPreview: (value: { recipientCount: number }) => void = () => {};
    const previewSpy = vi
      .spyOn(campaignsApi, 'previewCampaign')
      .mockResolvedValueOnce({ recipientCount: 5 })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecondPreview = resolve;
          }),
      );

    renderPage();

    await waitFor(() => expect(screen.getByText('Welcome back')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/plantilla/i), { target: { value: 'tpl-1' } });
    fireEvent.change(screen.getByLabelText(/filtro/i), { target: { value: 'ALL' } });
    expect(await screen.findByText(/5 destinatario/i)).toBeInTheDocument();

    // Switch to a different (still valid) template while a slower preview is in flight.
    fireEvent.change(screen.getByLabelText(/plantilla/i), { target: { value: 'tpl-2' } });

    // The stale count must disappear immediately, before the new preview resolves.
    await waitFor(() => expect(screen.queryByText(/5 destinatario/i)).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /enviar campaña/i })).toBeDisabled();

    resolveSecondPreview({ recipientCount: 9 });

    expect(await screen.findByText(/9 destinatario/i)).toBeInTheDocument();
    expect(previewSpy).toHaveBeenCalledTimes(2);
  });

  it('discards an out-of-order preview response from a superseded request', async () => {
    let resolveFirstPreview: (value: { recipientCount: number }) => void = () => {};
    vi.spyOn(campaignsApi, 'previewCampaign')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstPreview = resolve;
          }),
      )
      .mockResolvedValueOnce({ recipientCount: 9 });

    renderPage();

    await waitFor(() => expect(screen.getByText('Welcome back')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/plantilla/i), { target: { value: 'tpl-1' } });
    // This triggers the first (slow) preview request, using the default N months of 6.
    fireEvent.change(screen.getByLabelText(/filtro/i), { target: { value: 'STAYED_WITHIN_MONTHS' } });

    // Changing N months before the first request resolves supersedes it with a second request.
    fireEvent.change(screen.getByLabelText(/N meses/i), { target: { value: '3' } });

    expect(await screen.findByText(/9 destinatario/i)).toBeInTheDocument();

    // The stale first response resolves late; it must not overwrite the current count.
    resolveFirstPreview({ recipientCount: 5 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getByText(/9 destinatario/i)).toBeInTheDocument();
    expect(screen.queryByText(/5 destinatario/i)).not.toBeInTheDocument();
  });

  it('loads and displays campaign history', async () => {
    vi.spyOn(campaignsApi, 'listCampaignHistory').mockResolvedValue([
      {
        id: 'camp-1',
        templateId: 'tpl-1',
        template: { name: 'Welcome back' },
        filterType: 'ALL',
        filterMonths: null,
        recipientCount: 5,
        sentAt: '2026-09-13T12:00:00.000Z',
        recipients: [
          { id: 'r1', guestId: 'g1', status: 'SENT', error: null },
          { id: 'r2', guestId: 'g2', status: 'FAILED', error: 'bounced' },
        ],
      },
    ]);

    renderPage();

    expect(await screen.findByText('Welcome back')).toBeInTheDocument();
    expect(screen.getByText(/5 destinatario/i)).toBeInTheDocument();
  });
});
