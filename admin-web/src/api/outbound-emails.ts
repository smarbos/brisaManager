import { apiClient } from './client';

export type OutboundEmailKind =
  | 'INITIAL_CONFIRMATION'
  | 'FINAL_CONFIRMATION'
  | 'CANCELLATION'
  | 'MARKETING'
  | 'ALERT'
  | 'INBOUND_FORWARD';

export type OutboundEmailStatus = 'SCHEDULED' | 'SENDING' | 'SENT' | 'FAILED' | 'ABORTED';

// An email in the outbox: it waits 5 minutes after being created (except forwards of received
// emails, which go right away) and can be aborted until then. `to` is the real recipient;
// `sentTo` is where it actually went, which differs in debug mode.
export interface OutboundEmail {
  id: string;
  kind: OutboundEmailKind;
  status: OutboundEmailStatus;
  to: string;
  sentTo: string | null;
  subject: string;
  html: string;
  replyTo: string | null;
  sendAt: string;
  sentAt: string | null;
  abortedAt: string | null;
  attempts: number;
  lastError: string | null;
  reservationId: string | null;
  resentFromId: string | null;
  createdAt: string;
}

export interface OutboundEmailFilter {
  status?: OutboundEmailStatus;
  reservationId?: string;
}

export function listOutboundEmails(filter: OutboundEmailFilter = {}): Promise<OutboundEmail[]> {
  const params = new URLSearchParams();
  if (filter.status) params.set('status', filter.status);
  if (filter.reservationId) params.set('reservationId', filter.reservationId);
  const query = params.toString();
  return apiClient.request(`/outbound-emails${query ? `?${query}` : ''}`);
}

export function abortOutboundEmail(id: string): Promise<OutboundEmail> {
  return apiClient.request(`/outbound-emails/${id}/abort`, { method: 'POST' });
}

export function retryOutboundEmail(id: string): Promise<OutboundEmail> {
  return apiClient.request(`/outbound-emails/${id}/retry`, { method: 'POST' });
}

export function resendOutboundEmail(id: string): Promise<OutboundEmail> {
  return apiClient.request(`/outbound-emails/${id}/resend`, { method: 'POST' });
}
