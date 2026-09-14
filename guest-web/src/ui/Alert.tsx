import { ReactNode } from 'react';

type AlertTone = 'danger' | 'success';

const toneClasses: Record<AlertTone, string> = {
  danger: 'bg-danger-bg text-danger',
  success: 'bg-success-bg text-success',
};

interface AlertProps {
  tone?: AlertTone;
  children: ReactNode;
}

export function Alert({ tone = 'danger', children }: AlertProps) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={`rounded px-3 py-2 text-sm ${toneClasses[tone]}`}>
      {children}
    </div>
  );
}
