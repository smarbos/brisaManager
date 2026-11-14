import { ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listReservations } from '../api/reservations';
import { Reservation } from '../reservations/types';
import { Alert, Badge, Card, EmptyState, LoadingState, PageContainer, PageHeader } from '../ui';
import { statusBadgeTone, statusLabel, sourceLabel } from '../lib/labels';
import {
  DayKey,
  Movement,
  dayKey,
  daysBetween,
  formatLongDay,
  formatShortDay,
  getMovements,
  getOccupancySnapshot,
  localTodayKey,
  nightsLabel,
  relativeDayLabel,
} from '../lib/occupancy';

// A wall-screen style view staff may leave open all day: refreshing also rolls "today" over
// at midnight. Polled for the same reasons as AppNav's unread count (no push channel).
const REFRESH_POLL_MS = 5 * 60_000;

// How far ahead the "Próximos movimientos" agenda looks.
const AGENDA_DAYS = 14;

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function paxLabel(pax: number): string {
  return `${pax} ${pax === 1 ? 'huésped' : 'huéspedes'}`;
}

function GuestLink({ reservation, className = '' }: { reservation: Reservation; className?: string }) {
  return (
    <Link to={`/reservations/${reservation.id}`} className={`text-accent hover:underline ${className}`}>
      {reservation.guestName}
    </Link>
  );
}

function StatusCard({
  title,
  tone = 'default',
  children,
}: {
  title: string;
  tone?: 'default' | 'warning' | 'danger' | 'success';
  children: ReactNode;
}) {
  const border = {
    default: 'border-t-accent',
    warning: 'border-t-warning',
    danger: 'border-t-danger',
    success: 'border-t-success',
  }[tone];
  return (
    <section aria-label={title} className={`flex flex-col gap-2 rounded-xl border-t-4 bg-surface p-5 shadow-sm ${border}`}>
      <h2 className="text-xs font-bold uppercase tracking-wider text-text-muted">{title}</h2>
      {children}
    </section>
  );
}

function BigLine({ children }: { children: ReactNode }) {
  return <p className="font-heading text-2xl font-semibold leading-tight text-heading">{children}</p>;
}

function Detail({ children }: { children: ReactNode }) {
  return <p className="text-sm text-text">{children}</p>;
}

function NowCard({ current, departingToday, today }: { current: Reservation | null; departingToday: Reservation | null; today: DayKey }) {
  const leavingBeforeArrival = departingToday && departingToday !== current ? departingToday : null;
  if (!current) {
    return (
      <StatusCard title="En la casa ahora" tone="success">
        <BigLine>Desocupada</BigLine>
        {leavingBeforeArrival ? (
          <Detail>
            <GuestLink reservation={leavingBeforeArrival} /> se va hoy.
          </Detail>
        ) : (
          <Detail>No hay nadie alojado esta noche.</Detail>
        )}
      </StatusCard>
    );
  }
  const checkIn = dayKey(current.checkIn);
  const checkOut = dayKey(current.checkOut);
  const nightsLeft = daysBetween(today, checkOut);
  return (
    <StatusCard title="En la casa ahora">
      <BigLine>
        <GuestLink reservation={current} />
      </BigLine>
      <Detail>
        {paxLabel(current.paxCount)} · {sourceLabel(current.source)}
      </Detail>
      <Detail>
        {checkIn === today ? <strong>Llega hoy</strong> : <>Llegó el {formatShortDay(checkIn)}</>}
      </Detail>
      <Detail>
        <strong>Se va {relativeDayLabel(today, checkOut)}</strong>: {formatLongDay(checkOut)}
        {nightsLeft > 1 && <span className="text-text-muted"> (quedan {nightsLabel(nightsLeft)})</span>}
      </Detail>
      {leavingBeforeArrival && (
        <Detail>
          <span className="text-text-muted">Antes, </span>
          <GuestLink reservation={leavingBeforeArrival} />
          <span className="text-text-muted"> se va hoy.</span>
        </Detail>
      )}
    </StatusCard>
  );
}

function NextCard({ next, today }: { next: Reservation | null; today: DayKey }) {
  if (!next) {
    return (
      <StatusCard title="Próximo huésped">
        <BigLine>Sin reservas</BigLine>
        <Detail>No hay próximas llegadas cargadas.</Detail>
      </StatusCard>
    );
  }
  const checkIn = dayKey(next.checkIn);
  const checkOut = dayKey(next.checkOut);
  return (
    <StatusCard title="Próximo huésped" tone={next.status === 'PENDING' ? 'warning' : 'default'}>
      <BigLine>
        <GuestLink reservation={next} />
      </BigLine>
      <Detail>
        {paxLabel(next.paxCount)} · {nightsLabel(daysBetween(checkIn, checkOut))} · {sourceLabel(next.source)}
      </Detail>
      <Detail>
        <strong>Llega {relativeDayLabel(today, checkIn)}</strong>: {formatLongDay(checkIn)}
      </Detail>
      <div>
        <Badge tone={statusBadgeTone(next.status)}>{statusLabel(next.status)}</Badge>
      </div>
    </StatusCard>
  );
}

function CleaningCard({ snapshot }: { snapshot: ReturnType<typeof getOccupancySnapshot> }) {
  const { cleaning, today } = snapshot;
  const sameDay = cleaning.freeNights === 0;
  const startsToday = cleaning.from === today;
  return (
    <StatusCard title="Limpieza" tone={sameDay ? 'danger' : startsToday ? 'warning' : 'default'}>
      <BigLine>{sameDay ? `Recambio ${relativeDayLabel(today, cleaning.from)}` : `Desde ${relativeDayLabel(today, cleaning.from)}`}</BigLine>
      {sameDay ? (
        <Detail>
          Sale un huésped y llega otro el mismo día ({formatLongDay(cleaning.from)}): limpiar entre la salida y la
          llegada.
        </Detail>
      ) : cleaning.until === null ? (
        <Detail>
          Libre desde el {formatLongDay(cleaning.from)}. No hay próxima llegada, sin apuro.
        </Detail>
      ) : (
        <>
          <Detail>
            Ventana: del {formatShortDay(cleaning.from)} al {formatShortDay(cleaning.until)}
          </Detail>
          <Detail>
            <strong>{nightsLabel(cleaning.freeNights!)} libres</strong> antes de la próxima llegada.
          </Detail>
        </>
      )}
    </StatusCard>
  );
}

function MovementRow({ movement, turnover }: { movement: Movement; turnover: boolean }) {
  const { reservation, kind } = movement;
  const nights = daysBetween(dayKey(reservation.checkIn), dayKey(reservation.checkOut));
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
      <span
        className={`inline-flex w-16 justify-center rounded-full px-2 py-0.5 text-xs font-semibold ${
          kind === 'in' ? 'bg-success-bg text-success' : 'bg-zone text-accent'
        }`}
      >
        {kind === 'in' ? 'Llega' : 'Sale'}
      </span>
      <GuestLink reservation={reservation} className="font-medium" />
      <span className="text-sm text-text-muted">
        {kind === 'in' ? `${paxLabel(reservation.paxCount)} · ${nightsLabel(nights)}` : `después de ${nightsLabel(nights)}`}
      </span>
      {reservation.status === 'PENDING' && <Badge tone="warning">Pendiente</Badge>}
      {turnover && kind === 'in' && <Badge tone="danger">Recambio mismo día</Badge>}
    </li>
  );
}

function Agenda({ reservations, today }: { reservations: Reservation[]; today: DayKey }) {
  const movements = getMovements(reservations, today, AGENDA_DAYS);
  if (movements.length === 0) {
    return <EmptyState message={`No hay llegadas ni salidas en los próximos ${AGENDA_DAYS} días.`} />;
  }
  const byDay = new Map<DayKey, Movement[]>();
  for (const movement of movements) byDay.set(movement.date, [...(byDay.get(movement.date) ?? []), movement]);
  return (
    <ol className="divide-y divide-border">
      {[...byDay.entries()].map(([day, dayMovements]) => {
        const turnover = dayMovements.some((m) => m.kind === 'in') && dayMovements.some((m) => m.kind === 'out');
        return (
          <li key={day} className="grid gap-1 py-3 sm:grid-cols-[180px_1fr] sm:gap-4">
            <div className={`text-sm font-semibold ${day === today ? 'text-accent' : 'text-heading'}`}>
              {capitalize(relativeDayLabel(today, day))}
              <span className="block text-xs font-normal text-text-muted">{formatLongDay(day)}</span>
            </div>
            <ul>
              {dayMovements.map((movement) => (
                <MovementRow key={`${movement.kind}-${movement.reservation.id}`} movement={movement} turnover={turnover} />
              ))}
            </ul>
          </li>
        );
      })}
    </ol>
  );
}

export function TodayPage() {
  const [reservations, setReservations] = useState<Reservation[] | null>(null);
  const [today, setToday] = useState(localTodayKey);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function refresh() {
      setToday(localTodayKey());
      listReservations()
        .then((result) => {
          setReservations(result);
          setError(null);
        })
        .catch((err) => {
          console.error('Failed to load reservations', err);
          setError('No se pudieron cargar las reservas.');
        });
    }
    refresh();
    const interval = setInterval(refresh, REFRESH_POLL_MS);
    return () => clearInterval(interval);
  }, []);

  const snapshot = reservations ? getOccupancySnapshot(reservations, today) : null;

  return (
    <PageContainer>
      <PageHeader
        title="Hoy"
        subtitle={capitalize(formatLongDay(today))}
        nav={
          <Link to="/timeline" className="text-accent hover:underline">
            Ver línea de tiempo →
          </Link>
        }
      />
      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}
      {!snapshot ? (
        !error && <LoadingState />
      ) : (
        <>
          <div className="mb-6 grid gap-4 md:grid-cols-3">
            <NowCard current={snapshot.current} departingToday={snapshot.departingToday} today={today} />
            <NextCard next={snapshot.next} today={today} />
            <CleaningCard snapshot={snapshot} />
          </div>
          <Card>
            <h2 className="mb-2 font-heading text-lg font-semibold text-heading">
              Próximos movimientos <span className="text-sm font-normal text-text-muted">({AGENDA_DAYS} días)</span>
            </h2>
            <Agenda reservations={reservations!} today={today} />
          </Card>
        </>
      )}
    </PageContainer>
  );
}
