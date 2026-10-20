import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ComoLlegarTab } from './ComoLlegarTab';

// The real contacts come from VITE_PROPERTY_CONTACTS at build time; tests use fictional ones.
vi.mock('../propertyInfo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../propertyInfo')>()),
  PROPERTY_CONTACTS: [
    { name: 'Ana', phone: '+54 9 223 555-0101' },
    { name: 'Lucía', phone: '+54 9 223 555-0102' },
  ],
}));

describe('ComoLlegarTab', () => {
  it('shows the address, a Maps link, and WhatsApp contacts', () => {
    render(<ComoLlegarTab />);

    expect(screen.getByText('Formosa 259, Depto L')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /abrir en google maps/i })).toHaveAttribute(
      'href',
      'https://maps.app.goo.gl/tMMvfWUcGDKKQuQh6',
    );
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('Lucía')).toBeInTheDocument();
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
