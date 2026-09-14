import { ReactNode } from 'react';

interface TableProps {
  children: ReactNode;
  className?: string;
}

export function Table({ children, className = '' }: TableProps) {
  return (
    <div className="overflow-x-auto">
      <table className={`w-full min-w-[480px] border-collapse text-left text-sm ${className}`}>{children}</table>
    </div>
  );
}

export const tableThClass = 'border-b border-border px-3 py-2 text-left font-semibold text-text-muted';
export const tableTdClass = 'border-b border-border px-3 py-2';
