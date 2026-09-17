import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';

describe('Button', () => {
  it('renders its label and forwards onClick', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('respects the disabled prop', () => {
    render(<Button disabled>Save</Button>);

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('shows "Procesando..." and disables itself when loading', () => {
    render(<Button loading>Save</Button>);

    const button = screen.getByRole('button', { name: /procesando/i });
    expect(button).toBeDisabled();
    expect(screen.queryByText('Save')).not.toBeInTheDocument();
  });

  it('is not clickable while loading', () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );

    fireEvent.click(screen.getByRole('button', { name: /procesando/i }));

    expect(onClick).not.toHaveBeenCalled();
  });
});
