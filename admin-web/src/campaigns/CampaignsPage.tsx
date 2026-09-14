import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listCampaignTemplates, CampaignTemplate } from '../api/campaign-templates';
import {
  previewCampaign,
  sendCampaign,
  listCampaignHistory,
  Campaign,
  CampaignFilterType,
} from '../api/campaigns';

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
    <div>
      <h1>Campaigns</h1>
      <Link to="/">Reservations</Link>
      {error && <p role="alert">{error}</p>}
      <section>
        <h2>Compose</h2>
        <label>
          Template
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">Select a template</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Filter
          <select value={filterType} onChange={(e) => setFilterType(e.target.value as CampaignFilterType | '')}>
            <option value="">Select a filter</option>
            <option value="ALL">All guests</option>
            <option value="STAYED_WITHIN_MONTHS">Stayed within the last N months</option>
            <option value="NOT_STAYED_WITHIN_MONTHS">Not stayed within the last N months</option>
          </select>
        </label>
        {filterType !== 'ALL' && filterType !== '' && (
          <label>
            N months
            <input type="number" min={1} value={filterMonths} onChange={(e) => setFilterMonths(e.target.value)} />
          </label>
        )}
        {recipientCount !== null && <p>{recipientCount} recipient(s) match this filter.</p>}
        <button type="button" onClick={handleSend} disabled={sending || recipientCount === null}>
          Send campaign
        </button>
      </section>
      <section>
        <h2>History</h2>
        <ul>
          {history.map((c) => (
            <li key={c.id}>
              {c.template.name} — {c.recipientCount} recipient(s) — {new Date(c.sentAt).toLocaleString()}
              <ul>
                {c.recipients.map((r) => (
                  <li key={r.id}>
                    {r.status}
                    {r.error ? `: ${r.error}` : ''}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
