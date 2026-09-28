import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { cancelReservation, listReservations } from '../api/reservations';
import { Reservation, ReservationSource, ReservationStatus } from './types';
import {
  PageContainer,
  PageHeader,
  Button,
  Card,
  Badge,
  EmptyState,
  FormField,
  Input,
  LoadingState,
  Select,
  Alert,
  Table,
  tableThClass as thClass,
  tableTdClass as tdClass,
  useTwoStepConfirm,
} from '../ui';
import { formatDate } from '../lib/date';
import { shortId } from '../lib/id';
import { sourceLabel, statusLabel, statusBadgeTone, getReservationWarnings } from '../lib/labels';

// One useTwoStepConfirm() instance per row — a hook can't be called conditionally/in a loop
// directly inside the table body's .map(), so this is its own small component instead.
function CancelRowButton({ loading, onCancel }: { loading: boolean; onCancel: () => void }) {
  const { armed, armedLabel, handleClick } = useTwoStepConfirm(onCancel);
  return (
    <Button type="button" variant="danger" loading={loading} onClick={handleClick}>
      {armed ? armedLabel : 'Cancelar'}
    </Button>
  );
}

export function ReservationListPage() {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [source, setSource] = useState<ReservationSource | ''>('');
  const [status, setStatus] = useState<ReservationStatus | ''>('PENDING');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function load() {
    setError(null);
    setLoading(true);
    listReservations({
      source: source || undefined,
      status: status || undefined,
    })
      .then(setReservations)
      .catch((err) => {
        console.error('Failed to load reservations', err);
        setError('No se pudieron cargar las reservas.');
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, [source, status]);

  const filteredReservations = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return reservations;
    }
    return reservations.filter((r) => r.guestName.toLowerCase().includes(term));
  }, [reservations, search]);

  async function handleCancel(reservation: Reservation) {
    setCancellingId(reservation.id);
    setError(null);
    try {
      await cancelReservation(reservation.id);
      load();
    } catch (err) {
      console.error('Failed to cancel the reservation', err);
      setError('No se pudo cancelar la reserva. Por favor, intentá de nuevo.');
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <PageContainer>
      <PageHeader title="Reservas" subtitle="Todas las reservas del alojamiento, directas y por canal." />
      <Card>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-wrap gap-4">
            <FormField label="Buscar">
              <Input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Nombre del huésped"
              />
            </FormField>
            <FormField label="Canal">
              <Select value={source} onChange={(e) => setSource(e.target.value as ReservationSource | '')}>
                <option value="">Todos</option>
                <option value="BOOKING">Booking.com</option>
                <option value="AIRBNB">Airbnb</option>
                <option value="DIRECT">Directo</option>
                <option value="OTHER">Otro</option>
              </Select>
            </FormField>
            <FormField label="Estado">
              <Select value={status} onChange={(e) => setStatus(e.target.value as ReservationStatus | '')}>
                <option value="">Todos</option>
                <option value="PENDING">Pendiente</option>
                <option value="CONFIRMED">Confirmada</option>
                <option value="CANCELLED">Cancelada</option>
                <option value="COMPLETED">Completada</option>
              </Select>
            </FormField>
          </div>
          <Link to="/reservations/new">
            <Button type="button">Nueva reserva</Button>
          </Link>
        </div>
        {error && <Alert>{error}</Alert>}
        {!loading && filteredReservations.length > 0 && (
          <p className="mb-3 -mt-1 text-xs text-text-muted">
            {filteredReservations.length} {filteredReservations.length === 1 ? 'reserva' : 'reservas'}
          </p>
        )}
        {loading ? (
          <LoadingState />
        ) : reservations.length === 0 ? (
          <EmptyState message="No hay reservas que coincidan con estos filtros." />
        ) : filteredReservations.length === 0 ? (
          <EmptyState message="No hay reservas que coincidan con la búsqueda." />
        ) : (
        <Table>
          <thead>
            <tr>
              <th className={thClass}>
                <span className="sr-only">Alertas</span>
              </th>
              <th className={thClass}>ID</th>
              <th className={thClass}>Huésped</th>
              <th className={thClass}>Check-in</th>
              <th className={thClass}>Check-out</th>
              <th className={thClass}>Canal</th>
              <th className={thClass}>Precio</th>
              <th className={thClass}>Estado</th>
              <th className={thClass}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filteredReservations.map((r) => {
              const warnings = getReservationWarnings(r);
              return (
              <tr key={r.id}>
                <td className={tdClass}>
                  {warnings.length > 0 && (
                    <span
                      role="img"
                      aria-label={`Requiere atención: ${warnings.join('; ')}`}
                      title={warnings.join('\n')}
                      className="cursor-help text-warning"
                    >
                      ⚠️
                    </span>
                  )}
                </td>
                <td className={tdClass}>
                  <Link
                    to={`/reservations/${r.id}`}
                    title={r.id}
                    className="font-mono text-xs text-accent hover:underline"
                  >
                    {shortId(r.id)}
                  </Link>
                </td>
                <td className={tdClass}>
                  <Link to={`/reservations/${r.id}`} className="font-medium text-accent hover:underline">
                    {r.guestName}
                  </Link>
                  {r.missingFromChannelAt && (
                    <Badge tone="warning" className="ml-2">
                      ⚠ Ya no está en el calendario del canal
                    </Badge>
                  )}
                </td>
                <td className={tdClass}>{formatDate(r.checkIn)}</td>
                <td className={tdClass}>{formatDate(r.checkOut)}</td>
                <td className={tdClass}>{sourceLabel(r.source)}</td>
                <td className={tdClass}>
                  {Number(r.totalAmount) > 0
                    ? `${r.currency} ${Number(r.totalAmount).toLocaleString('es-AR')}`
                    : '—'}
                </td>
                <td className={tdClass}>
                  <Badge tone={statusBadgeTone(r.status)}>{statusLabel(r.status)}</Badge>
                </td>
                <td className={tdClass}>
                  {r.status !== 'CANCELLED' && r.status !== 'COMPLETED' && (
                    <CancelRowButton loading={cancellingId === r.id} onCancel={() => handleCancel(r)} />
                  )}
                </td>
              </tr>
              );
            })}
          </tbody>
        </Table>
        )}
      </Card>
    </PageContainer>
  );
}
