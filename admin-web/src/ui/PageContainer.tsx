import { ReactNode } from 'react';

export function PageContainer({ children }: { children: ReactNode }) {
  return <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>;
}
