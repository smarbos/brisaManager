import { ReactNode } from 'react';

interface FormFieldProps {
  label: ReactNode;
  error?: string | null;
  children: ReactNode;
}

export function FormField({ label, error, children }: FormFieldProps) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-text">
      {label}
      {children}
      {error && (
        <span role="alert" className="text-sm font-normal text-danger">
          {error}
        </span>
      )}
    </label>
  );
}
