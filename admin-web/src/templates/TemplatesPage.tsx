import { FormEvent, useEffect, useState } from 'react';
import {
  listCampaignTemplates,
  createCampaignTemplate,
  deleteCampaignTemplate,
  CampaignTemplate,
} from '../api/campaign-templates';
import { PageContainer, PageHeader, Alert, Button, Card, EmptyState, FormField, Input, LoadingState, Textarea } from '../ui';

export function TemplatesPage() {
  const [templates, setTemplates] = useState<CampaignTemplate[]>([]);
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(true);

  function reload() {
    listCampaignTemplates()
      .then(setTemplates)
      .catch(() => setLoadError('No se pudieron cargar las plantillas. Por favor, recargá la página.'))
      .finally(() => setLoadingList(false));
  }

  useEffect(reload, []);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setActionError(null);
    setCreating(true);
    try {
      await createCampaignTemplate({ name, subject, bodyHtml });
      setName('');
      setSubject('');
      setBodyHtml('');
      reload();
    } catch {
      setActionError('No se pudo crear la plantilla. Por favor, intentá de nuevo.');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`¿Eliminar la plantilla "${name}"? Esta acción no se puede deshacer.`)) {
      return;
    }
    setActionError(null);
    setDeletingId(id);
    try {
      await deleteCampaignTemplate(id);
      reload();
    } catch {
      setActionError('No se pudo eliminar la plantilla — puede que ya esté en uso en una campaña.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <PageContainer>
      <PageHeader title="Plantillas" subtitle="Plantillas de email reutilizables para tus campañas." />
      {loadError && <Alert>{loadError}</Alert>}
      <Card className="mb-6">
        <h2 className="mb-4 font-heading text-lg font-semibold text-heading">Nueva plantilla</h2>
        {actionError && <Alert>{actionError}</Alert>}
        <form onSubmit={handleCreate} className="flex flex-col gap-4">
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
          <div>
            <Button type="submit" loading={creating}>
              Crear plantilla
            </Button>
          </div>
        </form>
      </Card>
      <Card>
        <h2 className="mb-4 font-heading text-lg font-semibold text-heading">Plantillas existentes</h2>
        {loadingList ? (
          <LoadingState />
        ) : templates.length === 0 ? (
          <EmptyState message="Todavía no creaste ninguna plantilla." />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {templates.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                <span>
                  <strong>{t.name}</strong> — {t.subject}
                </span>
                <Button
                  type="button"
                  variant="danger"
                  loading={deletingId === t.id}
                  onClick={() => handleDelete(t.id, t.name)}
                >
                  Eliminar
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </PageContainer>
  );
}
