import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  OutboundEmail,
  abortOutboundEmail,
  resendOutboundEmail,
  retryOutboundEmail,
} from '../api/outbound-emails';
import { ApiError } from '../api/client';
import { Alert, Badge, Button } from '../ui';
import { formatDateTime } from '../lib/date';
import { outboundEmailKindLabel, outboundEmailStatusLabel, outboundEmailStatusTone } from '../lib/labels';

type Action = 'abort' | 'retry' | 'resend';

function callAction(action: Action, id: string): Promise<OutboundEmail> {
  switch (action) {
    case 'abort':
      return abortOutboundEmail(id);
    case 'retry':
      return retryOutboundEmail(id);
    case 'resend':
      return resendOutboundEmail(id);
  }
}

// The API's 409/404 bodies are Nest's JSON error ({ message }); show that, not raw JSON.
function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    try {
      const body = JSON.parse(error.message) as { message?: string | string[] };
      if (body.message) return Array.isArray(body.message) ? body.message.join(' ') : body.message;
    } catch {
      // Not JSON — fall through to the generic message.
    }
  }
  return 'No se pudo completar la acción. Por favor, intentá de nuevo.';
}

function countdown(sendAt: string, now: number): string {
  const remainingMs = new Date(sendAt).getTime() - now;
  if (remainingMs <= 0) return 'Se envía en instantes';
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `Se envía en ${minutes}:${String(seconds).padStart(2, '0')}`;
}

function timing(email: OutboundEmail, now: number): string {
  switch (email.status) {
    case 'SCHEDULED':
      return countdown(email.sendAt, now);
    case 'SENDING':
      return 'Enviando…';
    case 'SENT':
      return email.sentAt ? `Enviado el ${formatDateTime(email.sentAt)}` : 'Enviado';
    case 'ABORTED':
      return email.abortedAt ? `Abortado el ${formatDateTime(email.abortedAt)}` : 'Abortado';
    case 'FAILED':
      return `Falló (${email.attempts} ${email.attempts === 1 ? 'intento' : 'intentos'})`;
  }
}

interface OutboundEmailListProps {
  emails: OutboundEmail[];
  // Called after any action so the parent reloads the list.
  onChanged: () => void;
  // The reservation page already is the reservation — no link back to it there.
  showReservationLink?: boolean;
}

// Outbox entries with the operator's actions: Abortar while waiting, Reintentar after a failure,
// Reenviar (a new copy that waits 5 minutes again) once it's done.
export function OutboundEmailList({ emails, onChanged, showReservationLink = true }: OutboundEmailListProps) {
  const [now, setNow] = useState(() => Date.now());
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

  // Keeps the "Se envía en m:ss" countdowns ticking.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  async function run(action: Action, id: string) {
    setError(null);
    setPending(`${action}:${id}`);
    try {
      await callAction(action, id);
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <Alert>{error}</Alert>}
      <ul className="flex flex-col divide-y divide-border">
        {emails.map((email) => (
          <li key={email.id} data-testid={`outbound-email-${email.id}`} className="flex flex-col gap-2 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={outboundEmailStatusTone(email.status)}>{outboundEmailStatusLabel(email.status)}</Badge>
              <Badge>{outboundEmailKindLabel(email.kind)}</Badge>
              <span className="text-xs text-text-muted">{timing(email, now)}</span>
            </div>
            <p className="font-medium text-text">{email.subject}</p>
            <p className="text-sm text-text-muted">
              Para: {email.to}
              {email.sentTo && email.sentTo !== email.to && ` (enviado a ${email.sentTo} por modo debug)`}
              {showReservationLink && email.reservationId && (
                <>
                  {' · '}
                  <Link to={`/reservations/${email.reservationId}`} className="text-accent hover:underline">
                    Ver reserva
                  </Link>
                </>
              )}
            </p>
            {email.lastError && <p className="text-sm text-danger">Error: {email.lastError}</p>}
            <div className="flex flex-wrap gap-2">
              {email.kind !== 'INBOUND_FORWARD' && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPreviewId(previewId === email.id ? null : email.id)}
                >
                  {previewId === email.id ? 'Ocultar' : 'Ver'}
                </Button>
              )}
              {email.status === 'SCHEDULED' && (
                <Button
                  type="button"
                  variant="danger"
                  loading={pending === `abort:${email.id}`}
                  onClick={() => run('abort', email.id)}
                >
                  Abortar
                </Button>
              )}
              {email.status === 'FAILED' && (
                <Button
                  type="button"
                  variant="secondary"
                  loading={pending === `retry:${email.id}`}
                  onClick={() => run('retry', email.id)}
                >
                  Reintentar
                </Button>
              )}
              {(email.status === 'ABORTED' || email.status === 'SENT' || email.status === 'FAILED') && (
                <Button
                  type="button"
                  variant="secondary"
                  loading={pending === `resend:${email.id}`}
                  onClick={() => run('resend', email.id)}
                >
                  Reenviar
                </Button>
              )}
            </div>
            {previewId === email.id && (
              // sandbox="" — no scripts, forms or navigation: the HTML includes guest-provided
              // text (escaped when rendered, but the preview shouldn't depend on that).
              <iframe
                title={`Vista previa: ${email.subject}`}
                sandbox=""
                srcDoc={email.html}
                className="h-80 w-full rounded border border-border bg-white"
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
