import { useCallback, useEffect, useState } from 'react';
import { OutboundEmail, OutboundEmailStatus, listOutboundEmails } from '../api/outbound-emails';
import { PageContainer, PageHeader, Alert, Card, EmptyState, LoadingState, Tabs } from '../ui';
import { OutboundEmailList } from './OutboundEmailList';

const FILTERS: { id: string; label: string; status?: OutboundEmailStatus }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'scheduled', label: 'Programados', status: 'SCHEDULED' },
  { id: 'sent', label: 'Enviados', status: 'SENT' },
  { id: 'failed', label: 'Fallidos', status: 'FAILED' },
  { id: 'aborted', label: 'Abortados', status: 'ABORTED' },
];

const REFRESH_MS = 15_000;

// Every outgoing email (the outbox): each waits 5 minutes before it's sent and can be aborted
// until then; failed ones can be retried and finished ones re-sent.
export function EmailsPage() {
  const [filterId, setFilterId] = useState('all');
  const [emails, setEmails] = useState<OutboundEmail[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(() => {
    const status = FILTERS.find((f) => f.id === filterId)?.status;
    listOutboundEmails(status ? { status } : {})
      .then((result) => {
        setEmails(result);
        setLoadError(false);
      })
      .catch(() => setLoadError(true));
  }, [filterId]);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <PageContainer>
      <PageHeader title="Emails" />
      <p className="mb-4 text-sm text-text-muted">
        Cada email espera 5 minutos antes de enviarse: mientras tanto lo podés abortar. Los emails que llegan a la casilla de
        La Brisa se reenvían al instante.
      </p>
      <Tabs tabs={FILTERS.map(({ id, label }) => ({ id, label }))} activeTab={filterId} onChange={setFilterId} />
      <Card className="mt-4">
        {loadError && <Alert>No se pudieron cargar los emails. Por favor, intentá de nuevo.</Alert>}
        {emails === null && !loadError ? (
          <LoadingState />
        ) : emails && emails.length === 0 ? (
          <EmptyState message="No hay emails." />
        ) : (
          emails && <OutboundEmailList emails={emails} onChanged={load} />
        )}
      </Card>
    </PageContainer>
  );
}
