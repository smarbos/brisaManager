import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { PageHeader } from './PageHeader';

describe('PageHeader', () => {
  it('renders the title and subtitle', () => {
    render(<PageHeader title="Reservas" subtitle="Todas las reservas" />);

    expect(screen.getByRole('heading', { name: 'Reservas' })).toBeInTheDocument();
    expect(screen.getByText('Todas las reservas')).toBeInTheDocument();
  });

  it('does not render a back link when backTo is omitted', () => {
    render(<PageHeader title="Reservas" />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders a back link to backTo with the default label', () => {
    render(
      <MemoryRouter>
        <PageHeader title="Editar reserva" backTo="/" />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: /volver/i })).toHaveAttribute('href', '/');
  });

  it('renders a back link with a custom label', () => {
    render(
      <MemoryRouter>
        <PageHeader title="Huésped" backTo="/guests" backLabel="Volver a huéspedes" />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: /volver a huéspedes/i })).toHaveAttribute('href', '/guests');
  });
});
