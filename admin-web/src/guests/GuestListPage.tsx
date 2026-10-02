import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listGuests, GuestDocumentSearch, GuestWithDocument } from '../api/guests';
import { ApiError } from '../api/client';
import type { DocumentType } from '../reservations/types';
import { COUNTRIES, documentErrorMessage, formatDocument } from '../lib/document';
import {
  PageContainer,
  PageHeader,
  Alert,
  Card,
  EmptyState,
  LoadingState,
  Table,
  Badge,
  FormField,
  Input,
  Select,
  Button,
  tableThClass as thClass,
  tableTdClass as tdClass,
} from '../ui';
import { formatDate } from '../lib/date';
import { shortId } from '../lib/id';

export function GuestListPage() {
  const [guests, setGuests] = useState<GuestWithDocument[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [documentType, setDocumentType] = useState<DocumentType>('DNI');
  const [documentCountry, setDocumentCountry] = useState('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [documentSearch, setDocumentSearch] = useState<GuestDocumentSearch | null>(null);
  const [documentError, setDocumentError] = useState<string | null>(null);

  // Document search is server-side: the API hashes the full number and matches it exactly
  // (it never stores the number in plain form, so there's nothing to filter on here).
  useEffect(() => {
    setLoading(true);
    setDocumentError(null);
    listGuests(documentSearch ?? undefined)
      .then(setGuests)
      .catch((err) => {
        if (documentSearch && err instanceof ApiError && err.status === 400) {
          setDocumentError(documentErrorMessage(err.message));
        } else {
          setError('No se pudieron cargar los huéspedes. Por favor, recargá la página.');
        }
      })
      .finally(() => setLoading(false));
  }, [documentSearch]);

  function handleDocumentSearch(event: FormEvent) {
    event.preventDefault();
    if (!documentNumber.trim()) {
      setDocumentSearch(null);
      return;
    }
    setDocumentSearch({
      documentType,
      document: documentNumber.trim(),
      ...(documentType === 'PASAPORTE' ? { documentCountry } : {}),
    });
  }

  function clearDocumentSearch() {
    setDocumentNumber('');
    setDocumentSearch(null);
  }

  const filteredGuests = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return guests;
    }
    return guests.filter((g) =>
      [g.name, g.email, g.phone].some((field) => field?.toLowerCase().includes(term)),
    );
  }, [guests, search]);

  return (
    <PageContainer>
      <PageHeader title="Huéspedes" subtitle="Todos los huéspedes que se alojaron o reservaron en el alojamiento." />
      {error && <Alert>{error}</Alert>}
      <Card>
        <div className="mb-4">
          <FormField label="Buscar">
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nombre, email o teléfono"
            />
          </FormField>
        </div>
        <form onSubmit={handleDocumentSearch} className="mb-4 flex flex-wrap items-end gap-3">
          <FormField label="Tipo de documento">
            <Select value={documentType} onChange={(e) => setDocumentType(e.target.value as DocumentType)}>
              <option value="DNI">DNI</option>
              <option value="PASAPORTE">Pasaporte</option>
            </Select>
          </FormField>
          {documentType === 'PASAPORTE' && (
            <FormField label="País emisor">
              <Select value={documentCountry} onChange={(e) => setDocumentCountry(e.target.value)}>
                <option value="">Elegí un país</option>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </FormField>
          )}
          <FormField label="Buscar por documento" error={documentError}>
            <Input
              value={documentNumber}
              onChange={(e) => setDocumentNumber(e.target.value)}
              placeholder="Número completo"
            />
          </FormField>
          <Button type="submit">Buscar</Button>
          {documentSearch && (
            <Button type="button" variant="secondary" onClick={clearDocumentSearch}>
              Ver todos
            </Button>
          )}
        </form>
        {loading ? (
          <LoadingState />
        ) : guests.length === 0 ? (
          <EmptyState
            message={documentSearch ? 'Ningún huésped tiene ese documento.' : 'Todavía no hay huéspedes registrados.'}
          />
        ) : filteredGuests.length === 0 ? (
          <EmptyState message="No hay huéspedes que coincidan con la búsqueda." />
        ) : (
        <Table>
          <thead>
            <tr>
              <th className={thClass}>ID</th>
              <th className={thClass}>Nombre</th>
              <th className={thClass}>Email</th>
              <th className={thClass}>Teléfono</th>
              <th className={thClass}>Documento</th>
              <th className={thClass}>Estadías totales</th>
              <th className={thClass}>Última estadía</th>
              <th className={thClass}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {filteredGuests.map((g) => (
              <tr key={g.id}>
                <td className={tdClass}>
                  <Link
                    to={`/guests/${g.id}`}
                    title={g.id}
                    className="font-mono text-xs text-accent hover:underline"
                  >
                    {shortId(g.id)}
                  </Link>
                </td>
                <td className={tdClass}>
                  <Link to={`/guests/${g.id}`} className="font-medium text-accent hover:underline">
                    {g.name}
                  </Link>
                </td>
                <td className={tdClass}>{g.email ?? '—'}</td>
                <td className={tdClass}>{g.phone ?? '—'}</td>
                <td className={tdClass}>{formatDocument(g)}</td>
                <td className={tdClass}>{g.totalStays}</td>
                <td className={tdClass}>{g.lastStayAt ? formatDate(g.lastStayAt) : '—'}</td>
                <td className={tdClass}>
                  <Badge tone={g.unsubscribedAt ? 'warning' : 'success'}>
                    {g.unsubscribedAt ? 'Dado de baja' : 'Suscripto'}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        )}
      </Card>
    </PageContainer>
  );
}
