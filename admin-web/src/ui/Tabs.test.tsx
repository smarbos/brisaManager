import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Tabs } from './Tabs';

const tabs = [
  { id: 'a', label: 'Reglas' },
  { id: 'b', label: 'Pagos' },
];

describe('Tabs', () => {
  it('renders every tab and marks the active one as selected', () => {
    render(<Tabs tabs={tabs} activeTab="a" onChange={vi.fn()} />);

    expect(screen.getByRole('tab', { name: 'Reglas' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Pagos' })).toHaveAttribute('aria-selected', 'false');
  });

  it('calls onChange with the clicked tab id', () => {
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} activeTab="a" onChange={onChange} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Pagos' }));

    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('does not call onChange when clicking the already-active tab', () => {
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} activeTab="a" onChange={onChange} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Reglas' }));

    expect(onChange).not.toHaveBeenCalled();
  });
});
