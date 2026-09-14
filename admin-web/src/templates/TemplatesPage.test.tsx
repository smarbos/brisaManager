import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { TemplatesPage } from './TemplatesPage';
import * as templatesApi from '../api/campaign-templates';

function renderPage() {
  return render(
    <MemoryRouter>
      <TemplatesPage />
    </MemoryRouter>,
  );
}

describe('TemplatesPage', () => {
  it('loads and displays templates, and creates a new one', async () => {
    vi.spyOn(templatesApi, 'listCampaignTemplates').mockResolvedValue([
      { id: '1', name: 'Welcome back', subject: 'Hi {{guestName}}', bodyHtml: '<p>Hi {{guestName}}</p>' },
    ]);
    const createSpy = vi.spyOn(templatesApi, 'createCampaignTemplate').mockResolvedValue({
      id: '2',
      name: 'New template',
      subject: 'Subject',
      bodyHtml: '<p>Body</p>',
    });

    renderPage();

    await waitFor(() => expect(screen.getByText('Welcome back')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/^nombre$/i), { target: { value: 'New template' } });
    fireEvent.change(screen.getByLabelText(/asunto/i), { target: { value: 'Subject' } });
    fireEvent.change(screen.getByLabelText(/cuerpo/i), { target: { value: '<p>Body</p>' } });
    fireEvent.click(screen.getByRole('button', { name: /crear plantilla/i }));

    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith({ name: 'New template', subject: 'Subject', bodyHtml: '<p>Body</p>' }),
    );
  });

  it('deletes a template', async () => {
    vi.spyOn(templatesApi, 'listCampaignTemplates').mockResolvedValue([
      { id: '1', name: 'Welcome back', subject: 'Hi', bodyHtml: '<p>Hi</p>' },
    ]);
    const deleteSpy = vi.spyOn(templatesApi, 'deleteCampaignTemplate').mockResolvedValue(undefined);

    renderPage();

    await waitFor(() => expect(screen.getByText('Welcome back')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /eliminar/i }));

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith('1'));
  });

  it('shows an alert when a delete is refused because the template is in use', async () => {
    vi.spyOn(templatesApi, 'listCampaignTemplates').mockResolvedValue([
      { id: '1', name: 'Welcome back', subject: 'Hi', bodyHtml: '<p>Hi</p>' },
    ]);
    vi.spyOn(templatesApi, 'deleteCampaignTemplate').mockRejectedValue(new Error('in use'));

    renderPage();

    await waitFor(() => expect(screen.getByText('Welcome back')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /eliminar/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudo eliminar/i);
  });
});
