import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LaZonaTab } from './LaZonaTab';

describe('LaZonaTab', () => {
  it('renders each zone group and its places', () => {
    render(<LaZonaTab />);

    expect(screen.getByText('Playas y paseos')).toBeInTheDocument();
    expect(screen.getByText('Playa Grande')).toBeInTheDocument();
    expect(screen.getByText('Puerto de Mar del Plata')).toBeInTheDocument();
    expect(screen.getByText('Comer y comprar')).toBeInTheDocument();
    expect(screen.getByText('Zona Güemes')).toBeInTheDocument();
  });
});
