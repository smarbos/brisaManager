import { useEffect, useState } from 'react';
import { listCampaignTemplates, CampaignTemplate } from '../api/campaign-templates';
import {
  previewCampaign,
  sendCampaign,
  listCampaignHistory,
  Campaign,
  CampaignFilterType,
} from '../api/campaigns';
import { PageContainer, PageHeader, Alert, Badge, Button, FormField, Input, Select } from '../ui';

export function CampaignsPage() {
  const [templates, setTemplates] = useState<CampaignTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [filterType, setFilterType] = useState<CampaignFilterType | ''>('');
  const [filterMonths, setFilterMonths] = useState('6');
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [history, setHistory] = useState<Campaign[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    listCampaignTemplates()
      .then(setTemplates)
      .catch(() => setError('Could not load templates.'));
    reloadHistory();
  }, []);

  function reloadHistory() {
    listCampaignHistory()
      .then(setHistory)
      .catch(() => setError('Could not load campaign history.'));
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
        if (isCurrent) setRecipientCount(result.recipientCount);
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
    if (!window.confirm(`Send this campaign to ${recipientCount ?? 0} guest(s)? This cannot be undone.`)) {
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
      setError('Could not send the campaign. Please try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <PageContainer>
      <PageHeader title="Campaigns" />
      {error && <Alert>{error}</Alert>}
      <section className="mb-8">
        <h2 className="mb-3 font-heading text-lg font-semibold text-heading">Compose</h2>
        <div className="flex flex-col gap-4">
          <FormField label="Template">
            <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">Select a template</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Filter">
            <Select value={filterType} onChange={(e) => setFilterType(e.target.value as CampaignFilterType | '')}>
              <option value="">Select a filter</option>
              <option value="ALL">All guests</option>
              <option value="STAYED_WITHIN_MONTHS">Stayed within the last N months</option>
              <option value="NOT_STAYED_WITHIN_MONTHS">Not stayed within the last N months</option>
            </Select>
          </FormField>
          {filterType !== 'ALL' && filterType !== '' && (
            <FormField label="N months">
              <Input type="number" min={1} value={filterMonths} onChange={(e) => setFilterMonths(e.target.value)} />
            </FormField>
          )}
          {recipientCount !== null && (
            <p className="text-sm text-text-muted">{recipientCount} recipient(s) match this filter.</p>
          )}
          <Button type="button" onClick={handleSend} disabled={sending || recipientCount === null}>
            Send campaign
          </Button>
        </div>
      </section>
      <section>
        <h2 className="mb-3 font-heading text-lg font-semibold text-heading">History</h2>
        <ul className="flex flex-col gap-4">
          {history.map((c) => (
            <li key={c.id} className="border-b border-border pb-4">
              <p>
                {c.template.name} — {c.recipientCount} recipient(s) — {new Date(c.sentAt).toLocaleString()}
              </p>
              <ul className="mt-2 flex flex-col gap-1">
                {c.recipients.map((r) => (
                  <li key={r.id} className="flex items-center gap-2 text-sm">
                    <Badge tone={r.status === 'SENT' ? 'success' : 'danger'}>{r.status}</Badge>
                    {r.error ? <span>{r.error}</span> : null}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>
    </PageContainer>
  );
}
