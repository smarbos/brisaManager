import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listReservations } from '../api/reservations';
import { Reservation, ReservationStatus } from '../reservations/types';
import { Alert, Button, Card, FormField, LoadingState, PageContainer, PageHeader, Select } from '../ui';
import { statusLabel } from '../lib/labels';
import {
  DayKey,
  LanedStay,
  addDays,
  assignLanes,
  dayKey,
  daysBetween,
  formatShortDay,
  localTodayKey,
  nightsLabel,
} from '../lib/occupancy';

// Days shown before today, so the stay in progress (and the last departure) stay in view.
const DAYS_BEFORE_TODAY = 3;

const RANGE_OPTIONS = [30, 60, 90] as const;
type RangeDays = (typeof RANGE_OPTIONS)[number];

// Narrower columns for longer ranges, so 90 days still mostly fits on a laptop screen.
const DAY_WIDTH: Record<RangeDays, number> = { 30: 40, 60: 28, 90: 20 };
const LANE_HEIGHT = 52;

const BAR_CLASSES: Record<ReservationStatus, string> = {
  CONFIRMED: 'bg-accent text-accent-fg',
  PENDING: 'border border-dashed border-warning bg-warning-bg text-warning',
  COMPLETED: 'bg-zone text-text-muted',
  CANCELLED: '',
};

const MONTH_FORMATTER = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const WEEKDAY_FORMATTER = new Intl.DateTimeFormat('es-AR', { weekday: 'narrow', timeZone: 'UTC' });

function dayDate(key: DayKey): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

function isWeekend(key: DayKey): boolean {
  const day = dayDate(key).getUTCDay();
  return day === 0 || day === 6;
}

// Fraction of the local day already gone, so the "ahora" line sits at the actual time of day.
function dayFraction(now: Date): number {
  return (now.getHours() * 60 + now.getMinutes()) / (24 * 60);
}

interface Gap {
  from: DayKey;
  until: DayKey;
  nights: number;
}

// Empty stretches between consecutive stays on the main row — the cleaning windows.
function gapsBetween(stays: LanedStay[]): Gap[] {
  const mainRow = stays.filter((s) => s.lane === 0).map((s) => s.reservation);
  const gaps: Gap[] = [];
  for (let i = 1; i < mainRow.length; i++) {
    const from = dayKey(mainRow[i - 1].checkOut);
    const until = dayKey(mainRow[i].checkIn);
    gaps.push({ from, until, nights: daysBetween(from, until) });
  }
  return gaps;
}

function StayBar({
  stay,
  start,
  days,
  dayWidth,
  today,
}: {
  stay: LanedStay;
  start: DayKey;
  days: number;
  dayWidth: number;
  today: DayKey;
}) {
  const { reservation, lane } = stay;
  const checkIn = dayKey(reservation.checkIn);
  const checkOut = dayKey(reservation.checkOut);
  // Guests arrive in the afternoon and leave in the morning, so a bar runs from the middle of
  // its check-in day to the middle of its check-out day — back-to-back stays then visibly
  // share their turnover day instead of looking like one long booking.
  const rawLeft = (daysBetween(start, checkIn) + 0.5) * dayWidth;
  const rawRight = (daysBetween(start, checkOut) + 0.5) * dayWidth;
  const left = Math.max(rawLeft, 0);
  const right = Math.min(rawRight, days * dayWidth);
  if (right <= left) return null;

  const nights = daysBetween(checkIn, checkOut);
  const isCurrent = checkIn <= today && today < checkOut;
  const overlaps = lane > 0;
  const description = `${reservation.guestName}: ${formatShortDay(checkIn)} → ${formatShortDay(checkOut)}, ${nightsLabel(nights)}, ${reservation.paxCount} pax, ${statusLabel(reservation.status)}${overlaps ? ' — se superpone con otra reserva' : ''}`;

  return (
    <Link
      to={`/reservations/${reservation.id}`}
      aria-label={description}
      title={description}
      className={`absolute flex items-center gap-1 overflow-hidden whitespace-nowrap px-2 text-xs font-medium shadow-sm transition-[filter] hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-heading ${
        BAR_CLASSES[reservation.status]
      } ${rawLeft < 0 ? 'rounded-r-md' : rawRight > days * dayWidth ? 'rounded-l-md' : 'rounded-md'} ${
        overlaps ? 'ring-2 ring-danger' : ''
      } ${isCurrent ? 'font-semibold' : ''}`}
      style={{ left, width: right - left, top: lane * LANE_HEIGHT + 8, height: LANE_HEIGHT - 16 }}
    >
      {rawLeft < 0 && <span aria-hidden="true">‹</span>}
      <span className="truncate">{reservation.guestName}</span>
      <span aria-hidden="true" className="shrink-0 opacity-75">
        · {reservation.paxCount}p
      </span>
    </Link>
  );
}

export function TimelinePage() {
  const [reservations, setReservations] = useState<Reservation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<RangeDays>(30);
  const [now] = useState(() => new Date());
  const today = localTodayKey(now);
  const [start, setStart] = useState<DayKey>(() => addDays(today, -DAYS_BEFORE_TODAY));

  useEffect(() => {
    listReservations()
      .then(setReservations)
      .catch((err) => {
        console.error('Failed to load reservations', err);
        setError('No se pudieron cargar las reservas.');
      });
  }, []);

  const dayWidth = DAY_WIDTH[range];
  const width = range * dayWidth;
  const end = addDays(start, range);
  const dayKeys = useMemo(() => Array.from({ length: range }, (_, i) => addDays(start, i)), [start, range]);

  const { stays, laneCount } = useMemo(() => {
    const visible = (reservations ?? []).filter(
      (r) => dayKey(r.checkOut) >= start && dayKey(r.checkIn) <= end,
    );
    return assignLanes(visible);
  }, [reservations, start, end]);
  const gaps = useMemo(() => gapsBetween(stays), [stays]);
  const hasOverlaps = laneCount > 1;

  // Booked nights from today to the end of the window — how full the coming weeks are.
  const occupancy = useMemo(() => {
    const from = today > start ? today : start;
    const total = Math.max(0, daysBetween(from, end));
    let booked = 0;
    for (let day = from; day < end; day = addDays(day, 1)) {
      if (stays.some(({ reservation }) => dayKey(reservation.checkIn) <= day && day < dayKey(reservation.checkOut))) {
        booked++;
      }
    }
    return { booked, total };
  }, [stays, today, start, end]);

  const months = dayKeys.filter((key, i) => i === 0 || key.endsWith('-01'));
  const todayOffset = daysBetween(start, today);
  const nowLeft = (todayOffset + dayFraction(now)) * dayWidth;
  const lanesHeight = laneCount * LANE_HEIGHT;

  function shift(days: number) {
    setStart((s) => addDays(s, days));
  }

  return (
    <PageContainer>
      <PageHeader
        title="Línea de tiempo"
        subtitle="Estadías actuales y próximas, con los días libres entre una y otra."
        nav={
          <Link to="/today" className="text-accent hover:underline">
            ← Situación de hoy
          </Link>
        }
      />
      <Card>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" onClick={() => shift(-Math.round(range / 2))}>
              ← Anterior
            </Button>
            <Button type="button" variant="secondary" onClick={() => setStart(addDays(today, -DAYS_BEFORE_TODAY))}>
              Hoy
            </Button>
            <Button type="button" variant="secondary" onClick={() => shift(Math.round(range / 2))}>
              Siguiente →
            </Button>
          </div>
          <FormField label="Rango">
            <Select value={range} onChange={(e) => setRange(Number(e.target.value) as RangeDays)}>
              {RANGE_OPTIONS.map((days) => (
                <option key={days} value={days}>
                  {days} días
                </option>
              ))}
            </Select>
          </FormField>
        </div>

        {error && <Alert>{error}</Alert>}
        {hasOverlaps && (
          <div className="mb-3">
            <Alert>Hay reservas superpuestas en este período (marcadas en rojo).</Alert>
          </div>
        )}

        {!reservations ? (
          !error && <LoadingState />
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-border">
              <div className="relative select-none" style={{ width }}>
                {/* Month labels */}
                <div className="relative h-7 border-b border-border bg-bg">
                  {months.map((key) => (
                    <span
                      key={key}
                      className="absolute top-1 whitespace-nowrap border-l border-border pl-1.5 text-xs font-semibold capitalize text-heading"
                      style={{ left: daysBetween(start, key) * dayWidth }}
                    >
                      {MONTH_FORMATTER.format(dayDate(key))}
                    </span>
                  ))}
                </div>
                {/* Day labels */}
                <div className="flex border-b border-border">
                  {dayKeys.map((key) => (
                    <div
                      key={key}
                      className={`flex shrink-0 flex-col items-center py-1 text-[11px] leading-tight ${
                        key === today
                          ? 'bg-accent font-bold text-accent-fg'
                          : isWeekend(key)
                            ? 'bg-bg text-heading'
                            : 'text-text-muted'
                      }`}
                      style={{ width: dayWidth }}
                    >
                      {dayWidth >= 28 && <span className="uppercase">{WEEKDAY_FORMATTER.format(dayDate(key))}</span>}
                      <span>{dayDate(key).getUTCDate()}</span>
                    </div>
                  ))}
                </div>
                {/* Stays */}
                <div className="relative" style={{ height: lanesHeight + 24 }}>
                  {dayKeys.map((key, i) => (
                    <div
                      key={key}
                      aria-hidden="true"
                      className={`absolute inset-y-0 border-r border-border/50 ${
                        key === today ? 'bg-zone/60' : isWeekend(key) ? 'bg-bg/70' : ''
                      }`}
                      style={{ left: i * dayWidth, width: dayWidth }}
                    />
                  ))}
                  {gaps.map((gap) => {
                    const left = (daysBetween(start, gap.from) + 0.5) * dayWidth;
                    const right = (daysBetween(start, gap.until) + 0.5) * dayWidth;
                    if (right < 0 || left > width) return null;
                    if (gap.nights === 0) {
                      return (
                        <span
                          key={gap.from}
                          title={`Recambio el mismo día (${formatShortDay(gap.from)})`}
                          className="absolute z-10 -translate-x-1/2 rounded-full bg-danger px-1.5 text-[10px] font-bold text-white"
                          style={{ left, top: LANE_HEIGHT - 6 }}
                        >
                          ↻
                        </span>
                      );
                    }
                    return (
                      <span
                        key={gap.from}
                        className="absolute overflow-hidden whitespace-nowrap text-center text-[11px] text-text-muted"
                        style={{ left, width: right - left, top: LANE_HEIGHT / 2 - 8 }}
                        title={`${nightsLabel(gap.nights)} libres para limpiar: ${formatShortDay(gap.from)} → ${formatShortDay(gap.until)}`}
                      >
                        {right - left >= 56 ? `${gap.nights} libres` : gap.nights}
                      </span>
                    );
                  })}
                  {stays.map((stay) => (
                    <StayBar
                      key={stay.reservation.id}
                      stay={stay}
                      start={start}
                      days={range}
                      dayWidth={dayWidth}
                      today={today}
                    />
                  ))}
                  {nowLeft >= 0 && nowLeft <= width && (
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-danger"
                      style={{ left: nowLeft }}
                    >
                      <span className="absolute bottom-0.5 left-1 rounded bg-danger px-1 text-[10px] font-bold text-white">
                        ahora
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-4 text-xs text-text-muted">
              <ul className="flex flex-wrap items-center gap-4" aria-label="Referencias">
                <li className="flex items-center gap-1.5">
                  <span className={`h-3 w-6 rounded ${BAR_CLASSES.CONFIRMED}`} /> Confirmada
                </li>
                <li className="flex items-center gap-1.5">
                  <span className={`h-3 w-6 rounded ${BAR_CLASSES.PENDING}`} /> Pendiente
                </li>
                <li className="flex items-center gap-1.5">
                  <span className={`h-3 w-6 rounded ${BAR_CLASSES.COMPLETED}`} /> Completada
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="rounded-full bg-danger px-1.5 text-[10px] font-bold text-white">↻</span> Recambio
                  el mismo día
                </li>
              </ul>
              {occupancy.total > 0 && (
                <p>
                  Ocupación desde hoy: <strong className="text-heading">{occupancy.booked}</strong> de {occupancy.total}{' '}
                  noches ({Math.round((occupancy.booked / occupancy.total) * 100)}%)
                </p>
              )}
            </div>
          </>
        )}
      </Card>
    </PageContainer>
  );
}
