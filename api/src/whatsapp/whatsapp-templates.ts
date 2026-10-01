import { Reservation } from '@prisma/client';

// One WhatsApp message, ready for WhatsappService.sendTemplate(): the Meta-approved
// template to send (Twilio Content SID, from env) with its numbered variables, plus the
// equivalent freeform text sent instead when no SID is configured (local dev, Twilio
// Sandbox). The approved templates' wording lives in Twilio — see
// docs/superpowers/specs/2026-09-30-whatsapp-checkin-link-design.md.
export interface TemplateMessage {
  templateSid: string | undefined;
  variables: Record<string, string>;
  fallbackBody: string;
}

export function formatDateOnly(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC' }).format(date);
}

// Read at call time (not module load) so a changed .env applies on restart without code
// changes, and tests can set it per case. An empty value counts as unset.
function templateSid(envVar: string): string | undefined {
  return process.env[envVar] || undefined;
}

// Only used in fallback text: the approved templates carry the guest link as a URL button
// with the domain fixed inside the template, so only the token is a variable there.
function guestLink(token: string): string {
  return `${process.env.GUEST_WEB_ORIGIN}/r/${token}`;
}

type StayReservation = Pick<Reservation, 'guestName' | 'checkIn' | 'checkOut' | 'confirmationToken'>;

// Template `checkin_link`.
export function checkinLinkMessage(reservation: StayReservation): TemplateMessage {
  const checkIn = formatDateOnly(reservation.checkIn);
  const checkOut = formatDateOnly(reservation.checkOut);
  return {
    templateSid: templateSid('TWILIO_TEMPLATE_CHECKIN_LINK'),
    variables: { '1': reservation.guestName, '2': checkIn, '3': checkOut, '4': reservation.confirmationToken },
    fallbackBody:
      `Hola ${reservation.guestName}, ¡gracias por reservar en La Brisa de Mar del Plata! ` +
      `Tu estadía del ${checkIn} al ${checkOut} ya está registrada. ` +
      `Para completar el check-in, entrá acá: ${guestLink(reservation.confirmationToken)}`,
  };
}

// Template `reservation_reminder`.
export function reservationReminderMessage(reservation: StayReservation): TemplateMessage {
  const checkIn = formatDateOnly(reservation.checkIn);
  const checkOut = formatDateOnly(reservation.checkOut);
  return {
    templateSid: templateSid('TWILIO_TEMPLATE_RESERVATION_REMINDER'),
    variables: { '1': reservation.guestName, '2': checkIn, '3': checkOut, '4': reservation.confirmationToken },
    fallbackBody:
      `Hola ${reservation.guestName}! Te recordamos tu reserva en La Brisa de Mar del Plata ` +
      `del ${checkIn} al ${checkOut}. En el link de tu reserva tenés la dirección y cómo llegar: ` +
      guestLink(reservation.confirmationToken),
  };
}

// Template `deposit_reminder`. Links to the guest page's payment step rather than carrying
// Settings.paymentInstructions: those are multi-line bank details, and Meta doesn't allow
// newlines inside template variables.
export function depositReminderMessage(
  reservation: Pick<Reservation, 'guestName' | 'checkIn' | 'confirmationToken'>,
): TemplateMessage {
  const checkIn = formatDateOnly(reservation.checkIn);
  return {
    templateSid: templateSid('TWILIO_TEMPLATE_DEPOSIT_REMINDER'),
    variables: { '1': reservation.guestName, '2': checkIn, '3': reservation.confirmationToken },
    fallbackBody:
      `Hola ${reservation.guestName}, todavía no registramos el pago de tu reserva del ${checkIn}. ` +
      `Encontrás los datos para transferir acá: ${guestLink(reservation.confirmationToken)}`,
  };
}
