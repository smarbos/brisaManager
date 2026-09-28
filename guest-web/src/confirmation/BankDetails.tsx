import { useState } from 'react';

type CopyField = 'cbu' | 'alias';
type CopyStatus = 'copied' | 'failed';

function CopyButton({
  value,
  field,
  status,
  onCopy,
}: {
  value: string;
  field: CopyField;
  status: CopyStatus | null;
  onCopy: (field: CopyField, value: string) => void;
}) {
  return (
    <span role="status" aria-live="polite">
      <button
        type="button"
        onClick={() => onCopy(field, value)}
        className="min-h-11 shrink-0 rounded px-2 text-sm font-semibold text-accent underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        {status === 'copied' ? '¡Copiado!' : status === 'failed' ? 'No se pudo copiar' : 'Copiar'}
      </button>
    </span>
  );
}

interface BankDetailsProps {
  accountHolder: string;
  cuil: string;
  accountNumber: string;
  cbu: string;
  alias: string;
  bankName: string;
}

export function BankDetails({ accountHolder, cuil, accountNumber, cbu, alias, bankName }: BankDetailsProps) {
  const [copyStatus, setCopyStatus] = useState<Record<CopyField, CopyStatus | null>>({ cbu: null, alias: null });

  function handleCopy(field: CopyField, value: string) {
    if (!value) return;
    navigator.clipboard
      ?.writeText(value)
      .then(() => setCopyStatus((prev) => ({ ...prev, [field]: 'copied' })))
      .catch(() => setCopyStatus((prev) => ({ ...prev, [field]: 'failed' })));
    setTimeout(() => setCopyStatus((prev) => ({ ...prev, [field]: null })), 2000);
  }

  return (
    <dl className="flex flex-col gap-3 text-sm">
      <div className="flex flex-col gap-0.5">
        <dt className="text-text-muted">Titular</dt>
        <dd className="font-medium text-heading">{accountHolder}</dd>
      </div>
      <div className="flex flex-col gap-0.5">
        <dt className="text-text-muted">CUIL</dt>
        <dd className="font-medium text-heading">{cuil}</dd>
      </div>
      <div className="flex flex-col gap-0.5">
        <dt className="text-text-muted">Caja de ahorro en pesos</dt>
        <dd className="font-medium text-heading">{accountNumber}</dd>
      </div>
      <div className="flex flex-col gap-0.5">
        <dt className="text-text-muted">CBU</dt>
        <dd className="flex flex-wrap items-center gap-2 font-medium text-heading">
          <span className="break-all">{cbu}</span>
          <CopyButton value={cbu} field="cbu" status={copyStatus.cbu} onCopy={handleCopy} />
        </dd>
      </div>
      <div className="flex flex-col gap-0.5">
        <dt className="text-text-muted">Alias</dt>
        <dd className="flex flex-wrap items-center gap-2 font-medium text-heading">
          <span className="break-all">{alias}</span>
          <CopyButton value={alias} field="alias" status={copyStatus.alias} onCopy={handleCopy} />
        </dd>
      </div>
      <div className="flex flex-col gap-0.5">
        <dt className="text-text-muted">Banco</dt>
        <dd className="font-medium text-heading">{bankName}</dd>
      </div>
    </dl>
  );
}
