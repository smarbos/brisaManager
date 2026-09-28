import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ComoLlegarTab } from './ComoLlegarTab';

describe('ComoLlegarTab', () => {
  it('shows the address, a Maps link, and WhatsApp contacts', () => {
    render(<ComoLlegarTab />);

    expect(screen.getByText('Formosa 259, Depto L')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /abrir en google maps/i })).toHaveAttribute(
      'href',
      'https://maps.app.goo.gl/tMMvfWUcGDKKQuQh6',
    );
    expect(screen.getByText('Johanna')).toBeInTheDocument();
    expect(screen.getByText('Marta')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /whatsapp/i })[0]).toHaveAttribute(
      'href',
      'https://wa.me/5492235550101',
    );
  });

  it('copies the address and shows feedback', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });

    render(<ComoLlegarTab />);

    fireEvent.click(screen.getByRole('button', { name: /copiar dirección/i }));

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Formosa 259, Depto L'));
    expect(await screen.findByRole('button', { name: /copiada/i })).toBeInTheDocument();
  });
});
