import { useEffect, useState } from 'react';
import { listCampaignTemplates, CampaignTemplate } from '../api/campaign-templates';
import {
  previewCampaign,
  sendCampaign,
  listCampaignHistory,
  Campaign,
  CampaignFilterType,
} from '../api/campaigns';
import { PageContainer, PageHeader, Alert, Badge, Button, Card, EmptyState, FormField, Input, LoadingState, Select } from '../ui';
import { formatDateTime } from '../lib/date';
import { recipientStatusLabel, recipientStatusTone } from '../lib/labels';

export function CampaignsPage() {
  const [templates, setTemplates] = useState<CampaignTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [filterType, setFilterType] = useState<CampaignFilterType | ''>('');
  const [filterMonths, setFilterMonths] = useState('6');
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [excludedForConsent, setExcludedForConsent] = useState(0);
  const [history, setHistory] = useState<Campaign[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);

  useEffect(() => {
    listCampaignTemplates()
      .then(setTemplates)
      .catch(() => setError('No se pudieron cargar las plantillas.'));
    reloadHistory();
  }, []);

  function reloadHistory() {
    listCampaignHistory()
      .then(setHistory)
      .catch(() => setError('No se pudo cargar el historial de campañas.'))
      .finally(() => setLoadingHistory(false));
  }

  useEffect(() => {
    if (!templateId || !filterType) {
      setRecipientCount(null);
      return;
    }
    if (filterType !== 'ALL' && !filterMonths) {
      setRecipientCount(null);
      return;
    }
    // Clear the previous count immediately so a stale value is never shown
    // (and the Send button stays disabled) while the new preview is in flight.
    setRecipientCount(null);
    let isCurrent = true;
    const query = {
      templateId,
      filterType,
      filterMonths: filterType === 'ALL' ? undefined : Number(filterMonths),
    };
    previewCampaign(query)
      .then((result) => {
        // Discard the result if a newer selection has superseded this request.
        if (isCurrent) {
          setRecipientCount(result.recipientCount);
          setExcludedForConsent(result.excludedForConsent ?? 0);
        }
      })
      .catch(() => {
        if (isCurrent) setRecipientCount(null);
      });
    return () => {
      isCurrent = false;
    };
  }, [templateId, filterType, filterMonths]);

  async function handleSend() {
    if (!templateId || !filterType) return;
    if (!window.confirm(`¿Enviar esta campaña a ${recipientCount ?? 0} huésped(es)? Esta acción no se puede deshacer.`)) {
      return;
    }
    setError(null);
    setSending(true);
    try {
      await sendCampaign({
        templateId,
        filterType,
        filterMonths: filterType === 'ALL' ? undefined : Number(filterMonths),
      });
      reloadHistory();
    } catch {
      setError('No se pudo enviar la campaña. Por favor, intentá de nuevo.');
    } finally {
      setSending(false);
    }
  }

  return (
    <PageContainer>
      <PageHeader title="Campañas" subtitle="Enviá emails masivos a huéspedes según su historial de estadías." />
      {error && <Alert>{error}</Alert>}
      <Card className="mb-6">
        <h2 className="mb-3 font-heading text-lg font-semibold text-heading">Redactar</h2>
        <div className="flex flex-col gap-4">
          <FormField label="Plantilla">
            <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">Seleccioná una plantilla</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Filtro">
            <Select value={filterType} onChange={(e) => setFilterType(e.target.value as CampaignFilterType | '')}>
              <option value="">Seleccioná un filtro</option>
              <option value="ALL">Todos los huéspedes</option>
              <option value="STAYED_WITHIN_MONTHS">Se hospedaron en los últimos N meses</option>
              <option value="NOT_STAYED_WITHIN_MONTHS">No se hospedaron en los últimos N meses</option>
            </Select>
          </FormField>
          {filterType !== 'ALL' && filterType !== '' && (
            <FormField label="N meses">
              <Input type="number" min={1} value={filterMonths} onChange={(e) => setFilterMonths(e.target.value)} />
            </FormField>
          )}
          {recipientCount !== null && (
            <p className="text-sm text-text-muted">{recipientCount} destinatario(s) coinciden con este filtro.</p>
          )}
          {recipientCount !== null && excludedForConsent > 0 && (
            <p className="text-sm text-text-muted">
              {excludedForConsent} huésped(es) más quedan afuera porque no aceptaron recibir promociones.
            </p>
          )}
          <div>
            <Button type="button" loading={sending} disabled={recipientCount === null} onClick={handleSend}>
              Enviar campaña
            </Button>
          </div>
        </div>
      </Card>
      <Card>
        <h2 className="mb-3 font-heading text-lg font-semibold text-heading">Historial</h2>
        {loadingHistory ? (
          <LoadingState />
        ) : history.length === 0 ? (
          <EmptyState message="Todavía no enviaste ninguna campaña." />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {history.map((c) => (
              <li key={c.id} className="py-4 first:pt-0 last:pb-0">
                <p>
                  {c.template.name} — {c.recipientCount} destinatario(s) — {formatDateTime(c.sentAt)}
                </p>
                <ul className="mt-2 flex flex-col gap-1">
                  {c.recipients.map((r) => (
                    <li key={r.id} className="flex items-center gap-2 text-sm">
                      <Badge tone={recipientStatusTone(r.status)}>{recipientStatusLabel(r.status)}</Badge>
                      {r.error ? <span>{r.error}</span> : null}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </PageContainer>
  );
}
