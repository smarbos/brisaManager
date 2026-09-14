import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FormField } from './FormField';
import { Input } from './Input';

describe('FormField', () => {
  it('associates the label with its control', () => {
    render(
      <FormField label="Email">
        <Input type="email" />
      </FormField>,
    );

    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('renders an error message', () => {
    render(
      <FormField label="Email" error="Required">
        <Input type="email" />
      </FormField>,
    );

    expect(screen.getByText('Required')).toBeInTheDocument();
  });
});
