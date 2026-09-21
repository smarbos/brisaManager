import { useEffect, useState } from 'react';
import { listExtensionErrors, ExtensionErrorEntry } from '../api/extension-errors';
import { Alert, EmptyState, LoadingState, Table, tableThClass as thClass, tableTdClass as tdClass } from '../ui';
import { formatDateTime } from '../lib/date';
import { extensionErrorOperationLabel, extensionErrorSourceLabel } from '../lib/labels';

// Reported by the Chrome extension (background.js) whenever it fails to check or submit a
// reservation — not tied to a Reservation record, unlike the events tab, since a failure can
// happen before one exists (e.g. the passive "already loaded?" check on page load).
export function ExtensionErrorsTab() {
  const [entries, setEntries] = useState<ExtensionErrorEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listExtensionErrors()
      .then(setEntries)
      .catch(() => setError('No se pudieron cargar los errores del plugin. Por favor, recargá la página.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <LoadingState />;
  }

  return (
    <>
      {error && <Alert>{error}</Alert>}
      {!error && entries.length === 0 ? (
        <EmptyState message="Todavía no se reportaron errores del plugin." />
      ) : (
        !error && (
          <Table>
            <thead>
              <tr>
                <th className={thClass}>Cuándo</th>
                <th className={thClass}>Origen</th>
                <th className={thClass}>Operación</th>
                <th className={thClass}>Id de reserva</th>
                <th className={thClass}>Mensaje</th>
                <th className={thClass}>Detalle</th>
                <th className={thClass}>Versión</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className={tdClass}>{formatDateTime(entry.createdAt)}</td>
                  <td className={tdClass}>{extensionErrorSourceLabel(entry.source)}</td>
                  <td className={tdClass}>{extensionErrorOperationLabel(entry.operation)}</td>
                  <td className={tdClass}>
                    {entry.resId ? (
                      <a href={entry.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                        {entry.resId}
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className={tdClass}>{entry.message}</td>
                  <td className={`${tdClass} max-w-xs break-words`}>{entry.detail ?? '—'}</td>
                  <td className={tdClass}>{entry.extensionVersion ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )
      )}
    </>
  );
}
