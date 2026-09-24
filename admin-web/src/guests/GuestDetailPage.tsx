import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getGuest, listGuestEvents, GuestEvent, GuestWithReservations } from '../api/guests';
import {
  PageContainer,
  PageHeader,
  Alert,
  Badge,
  Card,
  EmptyState,
  LoadingState,
  Table,
  tableThClass as thClass,
  tableTdClass as tdClass,
} from '../ui';
import { formatDate, formatDateTime } from '../lib/date';
import { shortId } from '../lib/id';
import { sourceLabel, statusLabel, statusBadgeTone, guestEventTypeLabel } from '../lib/labels';

export function GuestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [guest, setGuest] = useState<GuestWithReservations | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<GuestEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    getGuest(id)
      .then(setGuest)
      .catch(() => setError('No se pudo cargar el huésped.'));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    listGuestEvents(id)
      .then(setEvents)
      .catch(() => {
        // Secondary section — a failed history fetch shouldn't block the rest of the page.
      })
      .finally(() => setEventsLoading(false));
  }, [id]);

  if (error) {
    return (
      <PageContainer>
        <Alert>{error}</Alert>
      </PageContainer>
    );
  }

  if (!guest) {
    return (
      <PageContainer>
        <p className="text-text-muted">Cargando...</p>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title={guest.name}
        subtitle={`ID de cliente: ${shortId(guest.id)}`}
        backTo="/guests"
        backLabel="Volver a huéspedes"
      />

      <Card className="mb-6">
        <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase text-text-muted">Email</dt>
            <dd className="text-text">{guest.email ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-text-muted">Teléfono</dt>
            <dd className="text-text">{guest.phone ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-text-muted">Estadías totales</dt>
            <dd className="text-text">{guest.totalStays}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-text-muted">Última estadía</dt>
            <dd className="text-text">{guest.lastStayAt ? formatDate(guest.lastStayAt) : '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-text-muted">Estado de suscripción</dt>
            <dd>
              <Badge tone={guest.unsubscribedAt ? 'warning' : 'success'}>
                {guest.unsubscribedAt ? `Dado de baja el ${formatDateTime(guest.unsubscribedAt)}` : 'Suscripto'}
              </Badge>
            </dd>
          </div>
        </dl>
      </Card>

      <Card className="mb-6">
        <h2 className="mb-3 font-heading text-lg font-semibold text-heading">Reservas</h2>
        {guest.reservations.length === 0 ? (
          <p className="text-text-muted">Este huésped todavía no tiene reservas.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={thClass}>ID</th>
                <th className={thClass}>Check-in</th>
                <th className={thClass}>Check-out</th>
                <th className={thClass}>Canal</th>
                <th className={thClass}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {guest.reservations.map((r) => (
                <tr key={r.id}>
                  <td className={tdClass}>
                    <Link
                      to={`/reservations/${r.id}`}
                      title={r.id}
                      className="font-mono text-xs text-accent hover:underline"
                    >
                      {shortId(r.id)}
                    </Link>
                  </td>
                  <td className={tdClass}>{formatDate(r.checkIn)}</td>
                  <td className={tdClass}>{formatDate(r.checkOut)}</td>
                  <td className={tdClass}>{sourceLabel(r.source)}</td>
                  <td className={tdClass}>
                    <Badge tone={statusBadgeTone(r.status)}>{statusLabel(r.status)}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 font-heading text-lg font-semibold text-heading">Historial de cambios</h2>
        {eventsLoading ? (
          <LoadingState />
        ) : events.length === 0 ? (
          <EmptyState message="Sin cambios registrados." />
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={thClass}>Cuándo</th>
                <th className={thClass}>Cambio</th>
                <th className={thClass}>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td className={tdClass}>{formatDateTime(event.createdAt)}</td>
                  <td className={tdClass}>{guestEventTypeLabel(event.type)}</td>
                  <td className={tdClass}>{event.detail ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </PageContainer>
  );
}
