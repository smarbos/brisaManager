import { ReactNode } from 'react';

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  nav?: ReactNode;
}

export function PageHeader({ title, subtitle, nav }: PageHeaderProps) {
  return (
    <header className="mb-6 flex flex-col gap-3 pb-2 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="font-heading text-2xl font-bold text-heading">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-text-muted">{subtitle}</p>}
      </div>
      {nav && <nav className="flex flex-wrap items-center gap-3 text-sm">{nav}</nav>}
    </header>
  );
}
