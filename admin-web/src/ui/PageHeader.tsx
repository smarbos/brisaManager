import { ReactNode, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  nav?: ReactNode;
  // When set, renders a small "← Volver" link above the title — for detail/edit screens
  // reached via a dynamic :id route (reservation, guest, ...) that have no other way back
  // to their list.
  backTo?: string;
  backLabel?: string;
}

export function PageHeader({ title, subtitle, nav, backTo, backLabel = 'Volver' }: PageHeaderProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Each page mounts its own PageHeader once per navigation (react-router swaps the whole
  // route element), so this runs exactly on page change — scrolls back to the top and
  // moves focus to the new page's heading, since the SPA never does either on its own the
  // way a full page load would, which otherwise leaves keyboard/screen-reader users
  // wherever they were on the previous page.
  useEffect(() => {
    window.scrollTo(0, 0);
    headingRef.current?.focus();
  }, []);

  return (
    <header className="mb-6 flex flex-col gap-3 pb-2 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {backTo && (
          <Link
            to={backTo}
            className="mb-1 inline-flex items-center gap-1 text-sm text-text-muted hover:text-heading"
          >
            ← {backLabel}
          </Link>
        )}
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="font-heading text-2xl font-bold text-heading outline-none focus:rounded focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-bg"
        >
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-sm text-text-muted">{subtitle}</p>}
      </div>
      {nav && <nav className="flex flex-wrap items-center gap-3 text-sm">{nav}</nav>}
    </header>
  );
}
