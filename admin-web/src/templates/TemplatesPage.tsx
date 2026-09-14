import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  listCampaignTemplates,
  createCampaignTemplate,
  deleteCampaignTemplate,
  CampaignTemplate,
} from '../api/campaign-templates';
import { PageContainer, PageHeader, Alert, Button, FormField, Input, Textarea } from '../ui';

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
    <PageContainer>
      <PageHeader
        title="Templates"
        nav={
          <Link to="/" className="text-accent hover:underline">
            Reservations
          </Link>
        }
      />
      {loadError && <Alert>{loadError}</Alert>}
      {actionError && <Alert>{actionError}</Alert>}
      <form onSubmit={handleCreate} className="mb-8 flex flex-col gap-4">
        <FormField label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField label="Subject">
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </FormField>
        <FormField label="Body">
          <Textarea value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)} rows={6} />
        </FormField>
        <p className="text-sm text-text-muted">
          Use <code className="rounded bg-surface px-1 py-0.5">{'{{guestName}}'}</code> in the subject or body to
          insert the guest's name.
        </p>
        <Button type="submit">Create template</Button>
      </form>
      <ul className="flex flex-col gap-2">
        {templates.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-4 border-b border-border pb-2">
            <span>
              <strong>{t.name}</strong> — {t.subject}
            </span>
            <Button type="button" variant="danger" onClick={() => handleDelete(t.id)}>
              Delete
            </Button>
          </li>
        ))}
      </ul>
    </PageContainer>
  );
}
