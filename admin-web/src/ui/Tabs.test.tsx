import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Tabs } from './Tabs';

const tabs = [
  { id: 'a', label: 'Reglas' },
  { id: 'b', label: 'Pagos' },
  { id: 'c', label: 'Alojamiento' },
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

  it('links each tab to its panel via id/aria-controls, using the given id prefix', () => {
    render(<Tabs id="settings" tabs={tabs} activeTab="a" onChange={vi.fn()} />);

    const tab = screen.getByRole('tab', { name: 'Reglas' });
    expect(tab).toHaveAttribute('id', 'settings-tab-a');
    expect(tab).toHaveAttribute('aria-controls', 'settings-panel-a');
  });

  it('only the active tab is in the normal tab order (roving tabindex)', () => {
    render(<Tabs tabs={tabs} activeTab="a" onChange={vi.fn()} />);

    expect(screen.getByRole('tab', { name: 'Reglas' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Pagos' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tab', { name: 'Alojamiento' })).toHaveAttribute('tabindex', '-1');
  });

  it('ArrowRight moves focus and activation to the next tab, wrapping at the end', () => {
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} activeTab="c" onChange={onChange} />);

    screen.getByRole('tab', { name: 'Alojamiento' }).focus();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Alojamiento' }), { key: 'ArrowRight' });

    expect(onChange).toHaveBeenCalledWith('a');
    expect(screen.getByRole('tab', { name: 'Reglas' })).toHaveFocus();
  });

  it('ArrowLeft moves focus and activation to the previous tab, wrapping at the start', () => {
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} activeTab="a" onChange={onChange} />);

    screen.getByRole('tab', { name: 'Reglas' }).focus();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Reglas' }), { key: 'ArrowLeft' });

    expect(onChange).toHaveBeenCalledWith('c');
    expect(screen.getByRole('tab', { name: 'Alojamiento' })).toHaveFocus();
  });

  it('Home and End jump to the first and last tab', () => {
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} activeTab="b" onChange={onChange} />);

    screen.getByRole('tab', { name: 'Pagos' }).focus();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Pagos' }), { key: 'End' });
    expect(onChange).toHaveBeenCalledWith('c');

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Pagos' }), { key: 'Home' });
    expect(onChange).toHaveBeenCalledWith('a');
  });
});
