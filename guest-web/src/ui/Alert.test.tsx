import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Alert } from './Alert';

describe('Alert', () => {
  it('renders with role="alert" by default', () => {
    render(<Alert>Something went wrong</Alert>);

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
  });

  it('renders with role="status" for the success tone', () => {
    render(<Alert tone="success">Saved</Alert>);

    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });
});
