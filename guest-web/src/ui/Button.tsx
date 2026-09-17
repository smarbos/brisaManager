import { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  // When true, disables the button and swaps its label for "Procesando..." — pass the
  // same boolean that's already driving the surrounding action's in-flight state.
  loading?: boolean;
};

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover disabled:bg-border disabled:text-text-muted',
  secondary: 'bg-surface text-text border border-border hover:bg-border disabled:text-text-muted',
  danger: 'bg-danger text-white hover:opacity-90 disabled:bg-border disabled:text-text-muted',
};

export function Button({
  variant = 'primary',
  className = '',
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`inline-flex min-h-11 cursor-pointer items-center justify-center rounded px-4 py-2 text-sm font-semibold transition-all duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg ${variantClasses[variant]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? 'Procesando...' : children}
    </button>
  );
}
