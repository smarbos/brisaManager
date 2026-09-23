import { ReactNode } from 'react';

export function PageContainer({ children }: { children: ReactNode }) {
  return (
    // pb-12 clears AppFooter, which is fixed to the bottom of the viewport, so it never
    // covers the last bit of content on pages short enough not to scroll past it naturally.
    <main id="main-content" className="mx-auto max-w-6xl px-4 py-6 pb-12 sm:px-6 lg:px-8">
      {children}
    </main>
  );
}
