import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Lightbox } from './Lightbox';

describe('Lightbox', () => {
  it('renders the image with the given src and alt', () => {
    render(<Lightbox src="blob:fake-url" alt="Comprobante" onClose={vi.fn()} />);

    expect(screen.getByRole('img', { name: 'Comprobante' })).toHaveAttribute('src', 'blob:fake-url');
  });

  it('moves focus to the close button on mount', () => {
    render(<Lightbox src="blob:fake-url" onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: /cerrar/i })).toHaveFocus();
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(<Lightbox src="blob:fake-url" onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: /cerrar/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(<Lightbox src="blob:fake-url" onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when clicking the backdrop', () => {
    const onClose = vi.fn();
    render(<Lightbox src="blob:fake-url" onClose={onClose} />);

    fireEvent.click(screen.getByRole('dialog'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when clicking the image itself', () => {
    const onClose = vi.fn();
    render(<Lightbox src="blob:fake-url" alt="Comprobante" onClose={onClose} />);

    fireEvent.click(screen.getByRole('img', { name: 'Comprobante' }));

    expect(onClose).not.toHaveBeenCalled();
  });
});
