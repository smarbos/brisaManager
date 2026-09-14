import { ReactNode } from 'react';

interface PageHeaderProps {
  title: ReactNode;
  nav?: ReactNode;
}

export function PageHeader({ title, nav }: PageHeaderProps) {
  return (
    <header className="mb-6 flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
      <h1 className="font-heading text-2xl font-semibold text-heading">{title}</h1>
      {nav && <nav className="flex flex-wrap items-center gap-3 text-sm">{nav}</nav>}
    </header>
  );
}
