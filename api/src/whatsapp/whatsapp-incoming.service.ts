import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { escapeHtml } from '../common/escape-html';
import { normalizePhoneForWhatsapp } from './phone-normalizer';

// The params Twilio posts for an incoming WhatsApp message (only the ones used here).
export interface IncomingWhatsappParams {
  From?: string;
  Body?: string;
  ProfileName?: string;
  NumMedia?: string;
}

// How many reservations with a phone are compared against the sender. Phones are stored as
// typed, so the match is done on the normalized number in code rather than in the query.
const CANDIDATE_LIMIT = 1000;

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC' }).format(date);
}

// A guest who answers one of our WhatsApp messages reaches nobody unless it's passed on: the
// reply is emailed to the contact mailbox, with the guest's reservation when the phone matches
// one. Staff answer from their own WhatsApp.
@Injectable()
export class WhatsappIncomingService {
  private readonly logger = new Logger(WhatsappIncomingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  async forwardReply(params: IncomingWhatsappParams): Promise<void> {
    const from = params.From?.trim();
    if (!from) {
      return;
    }
    const number = from.replace(/^whatsapp:/, '');
    const to = process.env.EMAIL_INBOUND_ADDRESS || process.env.ALERT_EMAIL || process.env.ADMIN_SEED_EMAIL;
    if (!to) {
      this.logger.warn(`WhatsApp reply from ${number} not forwarded: no EMAIL_INBOUND_ADDRESS or ALERT_EMAIL.`);
      return;
    }

    const reservation = await this.findReservation(from);
    const name = reservation?.guestName || params.ProfileName?.trim() || 'un número desconocido';
    const subject = `WhatsApp de ${name} (${number})`;

    const paragraphs: string[] = [];
    if (reservation) {
      const adminOrigin = process.env.ADMIN_WEB_ORIGIN?.replace(/\/+$/, '');
      const link = adminOrigin ? `${adminOrigin}/reservations/${reservation.id}` : null;
      paragraphs.push(
        `<p><strong>${escapeHtml(reservation.guestName)}</strong> · ${escapeHtml(number)}<br>` +
          `Reserva del ${formatDate(reservation.checkIn)} al ${formatDate(reservation.checkOut)}` +
          (link ? `<br><a href="${escapeHtml(link)}">${escapeHtml(link)}</a>` : '') +
          '</p>',
      );
    } else {
      paragraphs.push(
        `<p><strong>${escapeHtml(name)}</strong> · ${escapeHtml(number)}<br>No encontramos una reserva con este número.</p>`,
      );
    }

    const body = params.Body?.trim();
    if (body) {
      paragraphs.push(`<blockquote>${escapeHtml(body).replace(/\r?\n/g, '<br>')}</blockquote>`);
    }
    const media = Number(params.NumMedia ?? 0);
    if (media > 0) {
      paragraphs.push(`<p>Mandó ${media} archivo(s) adjunto(s): se ven en la consola de Twilio (Monitor → Messaging).</p>`);
    }
    paragraphs.push('<p>Para responder, escribile desde el WhatsApp de La Brisa. Responder este email no le llega.</p>');

    await this.emailService.sendStaffNotice(to, subject, paragraphs.join('\n'), reservation?.id ?? null);
  }

  private async findReservation(from: string) {
    const candidates = await this.prisma.reservation.findMany({
      where: { guestPhone: { not: null } },
      orderBy: { checkIn: 'desc' },
      take: CANDIDATE_LIMIT,
      select: { id: true, guestName: true, guestPhone: true, checkIn: true, checkOut: true, status: true },
    });
    const matches = candidates.filter((r) => normalizePhoneForWhatsapp(r.guestPhone as string) === from);
    // Latest stay first (the query's order); a cancelled one only if nothing else matches.
    return matches.find((r) => r.status !== 'CANCELLED') ?? matches[0] ?? null;
  }
}
