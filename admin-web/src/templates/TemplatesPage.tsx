import { FormEvent, useEffect, useState } from 'react';
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
      .catch(() => setLoadError('No se pudieron cargar las plantillas. Por favor, recargá la página.'));
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
      setActionError('No se pudo crear la plantilla. Por favor, intentá de nuevo.');
    }
  }

  async function handleDelete(id: string) {
    setActionError(null);
    try {
      await deleteCampaignTemplate(id);
      reload();
    } catch {
      setActionError('No se pudo eliminar la plantilla — puede que ya esté en uso en una campaña.');
    }
  }

  return (
    <PageContainer>
      <PageHeader title="Plantillas" />
      {loadError && <Alert>{loadError}</Alert>}
      {actionError && <Alert>{actionError}</Alert>}
      <form onSubmit={handleCreate} className="mb-8 flex flex-col gap-4">
        <FormField label="Nombre">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField label="Asunto">
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </FormField>
        <FormField label="Cuerpo">
          <Textarea value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)} rows={6} />
        </FormField>
        <p className="text-sm text-text-muted">
          Usá <code className="rounded bg-surface px-1 py-0.5">{'{{guestName}}'}</code> en el asunto o el cuerpo
          para insertar el nombre del huésped.
        </p>
        <Button type="submit">Crear plantilla</Button>
      </form>
      <ul className="flex flex-col gap-2">
        {templates.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-4 border-b border-border pb-2">
            <span>
              <strong>{t.name}</strong> — {t.subject}
            </span>
            <Button type="button" variant="danger" onClick={() => handleDelete(t.id)}>
              Eliminar
            </Button>
          </li>
        ))}
      </ul>
    </PageContainer>
  );
}
