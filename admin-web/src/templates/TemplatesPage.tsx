import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  listCampaignTemplates,
  createCampaignTemplate,
  deleteCampaignTemplate,
  CampaignTemplate,
} from '../api/campaign-templates';

export function TemplatesPage() {
  const [templates, setTemplates] = useState<CampaignTemplate[]>([]);
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  function reload() {
    listCampaignTemplates()
      .then(setTemplates)
      .catch(() => setLoadError('Could not load the templates. Please reload the page.'));
  }

  useEffect(reload, []);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setActionError(null);
    try {
      await createCampaignTemplate({ name, subject, bodyHtml });
      setName('');
      setSubject('');
      setBodyHtml('');
      reload();
    } catch {
      setActionError('Could not create the template. Please try again.');
    }
  }

  async function handleDelete(id: string) {
    setActionError(null);
    try {
      await deleteCampaignTemplate(id);
      reload();
    } catch {
      setActionError('Could not delete the template — it may already be used in a campaign.');
    }
  }

  return (
    <div>
      <h1>Templates</h1>
      <Link to="/">Reservations</Link>
      {loadError && <p role="alert">{loadError}</p>}
      {actionError && <p role="alert">{actionError}</p>}
      <form onSubmit={handleCreate}>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Subject
          <input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <label>
          Body
          <textarea value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)} rows={6} />
        </label>
        <p>Use <code>{'{{guestName}}'}</code> in the subject or body to insert the guest's name.</p>
        <button type="submit">Create template</button>
      </form>
      <ul>
        {templates.map((t) => (
          <li key={t.id}>
            <strong>{t.name}</strong> — {t.subject}
            <button type="button" onClick={() => handleDelete(t.id)}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
