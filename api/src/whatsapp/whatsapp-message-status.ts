// Twilio reports a message's lifecycle through its status callback, but callbacks can
// arrive out of order (a late "sent" after "delivered"). Statuses only ever move forward
// by this rank; anything Twilio sends that isn't listed here is ignored.
//
// Failures rank below "delivered": a real failure never follows a delivery, so a stray
// failure callback after one is ignored, while a delivery reported after a failure (which
// Twilio shouldn't do) is still taken as the truth.
const STATUS_RANK: Record<string, number> = {
  accepted: 0,
  scheduled: 0,
  queued: 0,
  sending: 1,
  sent: 2,
  failed: 3,
  undelivered: 3,
  canceled: 3,
  delivered: 4,
  read: 5,
};

// "rejected" is ours, not Twilio's: the send never got a Twilio message SID at all.
export const REJECTED_STATUS = 'rejected';

const UNDELIVERED_STATUSES = new Set(['failed', 'undelivered', 'canceled']);

export function isKnownTwilioStatus(status: string): boolean {
  return status in STATUS_RANK;
}

export function shouldApplyStatus(current: string, next: string): boolean {
  if (!isKnownTwilioStatus(next)) {
    return false;
  }
  return STATUS_RANK[next] > (STATUS_RANK[current] ?? -1);
}

// Twilio said it couldn't deliver it (as opposed to our own send-time rejection).
export function isUndeliveredStatus(status: string): boolean {
  return UNDELIVERED_STATUSES.has(status);
}

// Any status the admin should flag: rejected at send time, or undelivered afterwards.
export function isProblemStatus(status: string): boolean {
  return status === REJECTED_STATUS || isUndeliveredStatus(status);
}

// The public URL Twilio posts status updates to. Built only from the configured
// API_ORIGIN — never from a request's Host header — since it's also the URL the webhook's
// signature check is computed against. Only an https origin: Twilio can't reach a local
// http://localhost dev API, so there's nothing to register there.
export function whatsappStatusCallbackUrl(): string | null {
  const origin = process.env.API_ORIGIN?.trim().replace(/\/+$/, '');
  if (!origin || !origin.startsWith('https://')) {
    return null;
  }
  return `${origin}/webhooks/twilio/whatsapp-status`;
}
