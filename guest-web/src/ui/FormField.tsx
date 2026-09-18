import { ReactNode } from 'react';

interface FormFieldProps {
  label: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
}

export function FormField({ label, error, children, className = '' }: FormFieldProps) {
  return (
    <label className={`flex flex-col gap-1 text-sm font-medium text-text ${className}`}>
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
