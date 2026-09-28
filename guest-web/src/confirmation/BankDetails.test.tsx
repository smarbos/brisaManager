import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BankDetails } from './BankDetails';

const props = {
  accountHolder: 'Ana Pérez',
  cuil: '20123456789',
  accountNumber: '0001234567',
  cbu: '0000003100012345678901',
  alias: 'LABRISA.DEMO.ARS',
  bankName: 'Banco Ejemplo',
};

describe('BankDetails', () => {
  it('renders every bank field', () => {
    render(<BankDetails {...props} />);

    expect(screen.getByText('Ana Pérez')).toBeInTheDocument();
    expect(screen.getByText('20123456789')).toBeInTheDocument();
    expect(screen.getByText('0001234567')).toBeInTheDocument();
    expect(screen.getByText('0000003100012345678901')).toBeInTheDocument();
    expect(screen.getByText('LABRISA.DEMO.ARS')).toBeInTheDocument();
    expect(screen.getByText('Banco Ejemplo')).toBeInTheDocument();
  });

  it('copies the CBU and shows feedback, independently from the alias button', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });

    render(<BankDetails {...props} />);

    const copyButtons = screen.getAllByRole('button', { name: 'Copiar' });
    fireEvent.click(copyButtons[0]);

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(props.cbu));
    expect(await screen.findByText('¡Copiado!')).toBeInTheDocument();
    // The alias button is unaffected
    expect(screen.getAllByRole('button', { name: 'Copiar' })).toHaveLength(1);
  });
});
