import { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className = '' }: CardProps) {
  return <div className={`rounded-xl bg-surface p-6 shadow-sm ${className}`}>{children}</div>;
}
