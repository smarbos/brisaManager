import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CampaignFilterType, Guest, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GuestEventsService } from '../guest-events/guest-events.service';
import { DocumentCryptoService } from '../guest-documents/document-crypto.service';
import { DocumentInput, NormalizedDocument } from '../guest-documents/guest-documents';

interface SyncInput {
  email?: string | null;
  name: string;
  phone?: string | null;
  // The reservation's own guestId, when it already has one. Preferred over re-deriving
  // identity from email/phone: those can legitimately change on an existing reservation
  // (a staff correction, or a guest providing different contact info at check-in), and a
  // plain email/phone lookup would find nothing under the new value and create a duplicate
  // Guest instead of updating the one already on file.
  guestId?: string | null;
  // Who submitted this data — the staff member's email, "Huésped", or "Extensión de
  // Chrome" — carried onto any event this sync produces.
  actor?: string | null;
  // The identity document, already normalized. When present it's the primary key: same
  // document means the same person, regardless of email/phone (see resolveByDocument).
  document?: NormalizedDocument | null;
  // Set only by the guest check-in form: on a document-matched profile, write only fields
  // that are empty there — a token holder who types a stranger's DNI must not be able to
  // overwrite that stranger's name/phone/email.
  fillBlanksOnly?: boolean;
  // true sets marketingConsentAt once; never cleared here (withdrawing is the unsubscribe
  // link's job).
  marketingConsent?: boolean;
}

type ContactField = 'name' | 'phone' | 'email';

const CONTACT_FIELD_LABELS: Record<ContactField, string> = { name: 'Nombre', phone: 'Teléfono', email: 'Email' };

interface PendingEvent {
  type: 'CONTACT_INFO_NOT_APPLIED' | 'DOCUMENT_CHANGED';
  detail: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

interface Resolution {
  target: Guest | null;
  blanksOnly: boolean;
}

// A stay counts once it has actually happened and wasn't cancelled.
function completedStayWhere(now: Date): Prisma.ReservationWhereInput {
  return { status: { not: 'CANCELLED' }, checkOut: { lt: now } };
}

function formatPreviousValue(value: string | null): string {
  return value === null ? '(vacío)' : `"${value}"`;
}

@Injectable()
export class GuestsService {
  private readonly logger = new Logger(GuestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly guestEventsService: GuestEventsService,
    private readonly documentCrypto: DocumentCryptoService,
  ) {}

  async syncFromReservation(reservationId: string, input: SyncInput): Promise<void> {
    try {
      const email = input.email?.trim().toLowerCase() || null;
      const phone = input.phone?.trim() || null;
      const name = input.name.trim();
      const document = input.document ?? null;
      if (!document && !email && !phone) {
        return;
      }

      const linked = input.guestId ? await this.prisma.guest.findUnique({ where: { id: input.guestId } }) : null;
      const { target, blanksOnly } = document
        ? await this.resolveByDocument(document, linked, input.fillBlanksOnly ?? false)
        : await this.resolveByContact(linked, email, phone);

      const pending: PendingEvent[] = [];
      const data: { name?: string; phone?: string; email?: string } = {};

      const submitted: Record<ContactField, string | null> = { name, phone, email };
      for (const field of ['name', 'phone', 'email'] as ContactField[]) {
        const value = submitted[field];
        if (!value) {
          continue;
        }
        const stored = target ? target[field] : null;
        if (stored === value) {
          continue;
        }
        if (blanksOnly && stored) {
          pending.push(this.notApplied(field, stored, value, 'el perfil ya tiene otro valor'));
          continue;
        }
        if (field !== 'name' && (await this.belongsToAnotherGuest(field, value, target?.id))) {
          pending.push(this.notApplied(field, stored, value, 'pertenece a otro huésped'));
          continue;
        }
        data[field] = value;
      }

      const documentData = document ? this.documentChange(target, document, pending) : {};
      const consentData =
        input.marketingConsent && !target?.marketingConsentAt ? { marketingConsentAt: new Date() } : {};

      const guest = target
        ? await this.prisma.guest.update({
            where: { id: target.id },
            data: { ...data, ...documentData, ...consentData },
          })
        : await this.prisma.guest.create({
            // name is always present on SyncInput, so a new guest always gets one even if
            // every other contact field was dropped above.
            data: { ...data, name: data.name ?? name, ...documentData, ...consentData },
          });

      await this.prisma.reservation.update({
        where: { id: reservationId },
        data: { guestId: guest.id },
      });

      if (target) {
        await this.recordFieldChanges(guest.id, target, data, input.actor);
      }
      for (const event of pending) {
        await this.guestEventsService.record(
          guest.id,
          event.type,
          event.detail,
          event.field,
          event.oldValue,
          event.newValue,
          input.actor,
        );
      }
    } catch (error) {
      this.logger.error(`Guest sync failed for reservation ${reservationId}: ${(error as Error).message}`);
    }
  }

  // Spec section 4, in order. D = the guest whose documentHash matches, R = the reservation's
  // currently linked guest.
  private async resolveByDocument(
    document: NormalizedDocument,
    linked: Guest | null,
    fillBlanksOnly: boolean,
  ): Promise<Resolution> {
    const matched = await this.prisma.guest.findUnique({ where: { documentHash: this.documentCrypto.hash(document) } });
    if (matched) {
      return { target: matched, blanksOnly: fillBlanksOnly };
    }
    if (linked && !linked.documentHash) {
      // R is this reservation's own profile, just without a document yet.
      return { target: linked, blanksOnly: false };
    }
    // R carries a different document (a different person), or there's no R at all.
    return { target: null, blanksOnly: false };
  }

  // No document (imports, staff reservations entered without one): the linked guest, else
  // the email → phone fallback.
  private async resolveByContact(linked: Guest | null, email: string | null, phone: string | null): Promise<Resolution> {
    if (linked) {
      return { target: linked, blanksOnly: false };
    }
    // Airbnb's hosting messages page never exposes the guest's email, only their phone —
    // look up by whichever identifier is actually present.
    const found = email
      ? await this.prisma.guest.findUnique({ where: { email } })
      : await this.prisma.guest.findUnique({ where: { phone: phone as string } });
    return { target: found, blanksOnly: false };
  }

  // Writing a value another guest already holds would hit the unique constraint and fail
  // the whole sync, so it's dropped and logged instead.
  private async belongsToAnotherGuest(field: 'phone' | 'email', value: string, guestId?: string): Promise<boolean> {
    const owner =
      field === 'email'
        ? await this.prisma.guest.findUnique({ where: { email: value } })
        : await this.prisma.guest.findUnique({ where: { phone: value } });
    return owner !== null && owner.id !== guestId;
  }

  private notApplied(field: ContactField, stored: string | null, submitted: string, reason: string): PendingEvent {
    return {
      type: 'CONTACT_INFO_NOT_APPLIED',
      detail: `${CONTACT_FIELD_LABELS[field]} no aplicado (${reason}): "${submitted}"`,
      field,
      oldValue: stored,
      newValue: submitted,
    };
  }

  // The document columns to write, if they differ from what the target already holds. A
  // replaced document is logged with masked values only.
  private documentChange(target: Guest | null, document: NormalizedDocument, pending: PendingEvent[]) {
    const encoded = this.documentCrypto.encode(document);
    if (target?.documentHash === encoded.documentHash) {
      return {};
    }
    if (target) {
      const previous = this.documentCrypto.maskStored(target);
      const next = this.documentCrypto.mask(document);
      pending.push({
        type: 'DOCUMENT_CHANGED',
        detail: `Documento: ${previous ?? '(vacío)'} → ${next}`,
        field: 'document',
        oldValue: previous,
        newValue: next,
      });
    }
    return encoded;
  }

  // Only records a field as changed when this sync actually wrote it.
  private async recordFieldChanges(
    guestId: string,
    existing: Guest,
    written: { name?: string; phone?: string; email?: string },
    actor?: string | null,
  ): Promise<void> {
    if (written.name !== undefined) {
      await this.guestEventsService.record(
        guestId,
        'NAME_CHANGED',
        `Nombre: "${existing.name}" → "${written.name}"`,
        'name',
        existing.name,
        written.name,
        actor,
      );
    }
    if (written.phone !== undefined) {
      await this.guestEventsService.record(
        guestId,
        'PHONE_CHANGED',
        `Teléfono: ${formatPreviousValue(existing.phone)} → "${written.phone}"`,
        'phone',
        existing.phone,
        written.phone,
        actor,
      );
    }
    if (written.email !== undefined) {
      await this.guestEventsService.record(
        guestId,
        'EMAIL_CHANGED',
        `Email: ${formatPreviousValue(existing.email)} → "${written.email}"`,
        'email',
        existing.email,
        written.email,
        actor,
      );
    }
  }

  // totalStays/lastStayAt are computed from completed stays on every read. The guest table is
  // small (one property), so sorting in memory is fine.
  async findAll(document?: DocumentInput) {
    const where: Prisma.GuestWhereInput = document
      ? { documentHash: this.documentCrypto.hash(this.documentCrypto.normalize(document)) }
      : {};
    const guests = await this.prisma.guest.findMany({
      where,
      include: { reservations: { where: completedStayWhere(new Date()), select: { checkOut: true } } },
    });

    return guests
      .map(({ reservations, ...guest }) => ({
        ...this.documentCrypto.toListView(guest),
        ...this.stayStats(reservations),
      }))
      .sort((a, b) => (b.lastStayAt?.getTime() ?? -Infinity) - (a.lastStayAt?.getTime() ?? -Infinity));
  }

  async findOne(id: string) {
    const guest = await this.prisma.guest.findUnique({
      where: { id },
      include: { reservations: { orderBy: { checkIn: 'desc' } } },
    });
    if (!guest) {
      throw new NotFoundException(`Guest ${id} not found`);
    }
    const now = new Date();
    const completed = guest.reservations.filter((r) => r.status !== 'CANCELLED' && r.checkOut < now);
    const { reservations, ...rest } = guest;
    return {
      ...this.documentCrypto.toDetailView(rest),
      ...this.stayStats(completed),
      reservations: reservations.map((r) => this.documentCrypto.toListView(r)),
    };
  }

  private stayStats(completed: { checkOut: Date }[]) {
    const lastStayAt = completed.reduce<Date | null>(
      (latest, r) => (latest === null || r.checkOut > latest ? r.checkOut : latest),
      null,
    );
    return { totalStays: completed.length, lastStayAt };
  }

  // Campaigns are email-only, and only reach guests who opted in at check-in (Ley 25.326).
  // requireConsent: false exists solely so the campaign preview can say how many otherwise
  // eligible guests are left out for lack of consent.
  findEligibleForCampaign(filterType: CampaignFilterType, filterMonths?: number, { requireConsent = true } = {}) {
    const where: Prisma.GuestWhereInput = {
      unsubscribedAt: null,
      email: { not: null },
      ...(requireConsent ? { marketingConsentAt: { not: null } } : {}),
    };

    if (filterType === 'STAYED_WITHIN_MONTHS' || filterType === 'NOT_STAYED_WITHIN_MONTHS') {
      const now = new Date();
      const cutoff = new Date(now);
      cutoff.setMonth(cutoff.getMonth() - (filterMonths as number));
      const recentStay: Prisma.ReservationWhereInput = { ...completedStayWhere(now), checkOut: { lt: now, gte: cutoff } };
      // NOT_STAYED keeps its meaning: no stay since the cutoff, including never stayed.
      where.reservations = filterType === 'STAYED_WITHIN_MONTHS' ? { some: recentStay } : { none: recentStay };
    }

    return this.prisma.guest.findMany({ where });
  }

  async unsubscribeByToken(token: string): Promise<void> {
    // A findFirst-then-update (rather than the previous anonymous updateMany) is what gives
    // us a guest id to attach the GuestEvent to — the "never leak whether a token is valid"
    // behavior is unchanged: an unknown token still silently no-ops with no error either way.
    const guest = await this.prisma.guest.findFirst({ where: { unsubscribeToken: token } });
    if (!guest) {
      return;
    }
    await this.prisma.guest.update({
      where: { id: guest.id },
      data: { unsubscribedAt: new Date() },
    });
    await this.guestEventsService.record(guest.id, 'UNSUBSCRIBED');
  }
}
