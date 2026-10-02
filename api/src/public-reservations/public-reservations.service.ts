import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ReservationEventsService } from '../reservation-events/reservation-events.service';
import { ReservationConfirmationService } from '../reservation-confirmation/reservation-confirmation.service';
import { GuestsService } from '../guests/guests.service';
import { ReservationImagesService } from '../reservation-images/reservation-images.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AmbientService } from '../ambient/ambient.service';
import { parsePercentage, resolveFeeAmount } from '../settings/fee-value';
import { diffReservationFields, reservationFieldLabel } from '../reservations/reservation-field-changes';
import { DocumentCryptoService } from '../guest-documents/document-crypto.service';
import { ConfirmDatesDto } from './dto/confirm-dates.dto';

// This controller has no auth guard at all — the confirmationToken in the URL is the only
// gate — so every write here is, by definition, the guest acting on their own reservation.
const GUEST_ACTOR = 'Huésped';

// A guest's link is only a credential for as long as they plausibly need it: it grants the
// property's bank details, their own contact info and receipts, and uploads. Long enough after
// check-out to settle the security-deposit return, then it stops working for good.
export const TOKEN_VALID_DAYS_AFTER_CHECKOUT = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class PublicReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly eventsService: ReservationEventsService,
    private readonly confirmationService: ReservationConfirmationService,
    private readonly guestsService: GuestsService,
    private readonly reservationImagesService: ReservationImagesService,
    private readonly notificationsService: NotificationsService,
    private readonly ambientService: AmbientService,
    private readonly documentCrypto: DocumentCryptoService,
  ) {}

  // Also used by PublicReservationTokenGuard, so an unknown or expired token is rejected
  // before any request body (e.g. a multipart upload) is even read. An expired link gets the
  // same 404 as an unknown one — guest-web already shows "link no válido" for that.
  async findByToken(token: string) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { confirmationToken: token },
    });
    if (!reservation) {
      throw new NotFoundException('Reservation not found');
    }
    const expiresAt =
      reservation.checkOut.getTime() + TOKEN_VALID_DAYS_AFTER_CHECKOUT * DAY_MS;
    if (Date.now() > expiresAt) {
      throw new NotFoundException('Reservation not found');
    }
    return reservation;
  }

  async getByToken(token: string) {
    const reservation = await this.findByToken(token);
    const settings = await this.settingsService.get();

    return {
      guestName: reservation.guestName,
      checkIn: reservation.checkIn,
      checkOut: reservation.checkOut,
      paxCount: reservation.paxCount,
      // Cast from Prisma's Decimal: left as-is, it serializes to a JSON *string*, which
      // silently breaks guest-web's `amount.toLocaleString('es-AR')` (a string's
      // toLocaleString() just falls back to toString(), no thousands separators) —
      // confirmationPaymentAmount/securityDepositAmount below never had this problem since
      // resolveFeeAmount() already returns a real number.
      totalAmount: Number(reservation.totalAmount),
      confirmationPaymentAmount: resolveFeeAmount(
        settings.confirmationPaymentValue,
        Number(reservation.totalAmount),
      ),
      confirmationPaymentPercentage: parsePercentage(
        settings.confirmationPaymentValue,
      ),
      currency: reservation.currency,
      datesConfirmedAt: reservation.datesConfirmedAt,
      contractAcceptedAt: reservation.contractAcceptedAt,
      contractAcceptedName: reservation.contractAcceptedName,
      contractSnapshot: reservation.contractSnapshot,
      confirmationPaymentReceivedAt: reservation.confirmationPaymentReceivedAt,
      depositReceivedAt: reservation.depositReceivedAt,
      houseRulesText: settings.houseRulesText,
      paymentInstructions: settings.paymentInstructions,
      depositInstructions: settings.depositInstructions,
      confirmationStepText: settings.confirmationStepText,
      bankAccountHolder: settings.bankAccountHolder,
      bankCuil: settings.bankCuil,
      bankAccountNumber: settings.bankAccountNumber,
      bankCbu: settings.bankCbu,
      bankAlias: settings.bankAlias,
      bankName: settings.bankName,
      securityDepositAmount: resolveFeeAmount(
        settings.securityDepositValue,
        Number(reservation.totalAmount),
      ),
    };
  }

  // The response carries only datesConfirmedAt — never the document (no /public/* response
  // ever contains a document number, hash or ciphertext).
  async confirmDates(token: string, input: ConfirmDatesDto) {
    const { fullName, phone, email } = input;
    const reservation = await this.findByToken(token);

    // A resubmission after check-in changes nothing — including which guest this stay is
    // linked to.
    if (reservation.datesConfirmedAt) {
      return { datesConfirmedAt: reservation.datesConfirmedAt };
    }

    // Throws the Spanish 400 the form shows inline.
    const document = this.documentCrypto.normalize({
      type: input.documentType,
      country: input.documentCountry,
      number: input.documentNumber,
    });
    const encodedDocument = this.documentCrypto.encode(document);

    const normalizedEmail = email.trim().toLowerCase();

    // The guest is the authoritative source for their own name/contact info at this point —
    // this overwrites whatever was there before (a Booking.com placeholder, a typo from
    // manual entry, or nothing at all), not just fills a gap.
    const updated = await this.prisma.reservation.update({
      where: { id: reservation.id },
      data: {
        datesConfirmedAt: new Date(),
        guestName: fullName,
        guestPhone: phone,
        guestEmail: normalizedEmail,
        ...encodedDocument,
      },
    });

    await this.eventsService.record(reservation.id, 'DATES_CONFIRMED');

    const changes = diffReservationFields(reservation, {
      guestName: fullName,
      guestPhone: phone,
      guestEmail: normalizedEmail,
    });
    for (const change of changes) {
      await this.eventsService.record(
        reservation.id,
        'FIELD_CHANGED',
        `${reservationFieldLabel(change.field)}: "${change.oldValue}" → "${change.newValue}"`,
        change.field,
        change.oldValue,
        change.newValue,
        GUEST_ACTOR,
      );
    }

    if (reservation.documentHash !== encodedDocument.documentHash) {
      const previous = this.documentCrypto.maskStored(reservation) ?? '(vacío)';
      const next = this.documentCrypto.mask(document);
      await this.eventsService.record(
        reservation.id,
        'FIELD_CHANGED',
        `${reservationFieldLabel('document')}: "${previous}" → "${next}"`,
        'document',
        previous,
        next,
        GUEST_ACTOR,
      );
    }

    await this.confirmationService.maybeAutoConfirm(reservation.id);

    // fillBlanksOnly: whoever holds this link may type someone else's document, so a matched
    // profile only gets its empty fields filled — see GuestsService.syncFromReservation.
    void this.guestsService.syncFromReservation(updated.id, {
      email: normalizedEmail,
      name: fullName,
      phone,
      guestId: updated.guestId,
      actor: GUEST_ACTOR,
      document,
      fillBlanksOnly: true,
      marketingConsent: input.marketingConsent === true,
    });

    return { datesConfirmedAt: updated.datesConfirmedAt };
  }

  async acceptContract(token: string) {
    const reservation = await this.findByToken(token);

    if (reservation.contractAcceptedAt) {
      return { contractAcceptedAt: reservation.contractAcceptedAt };
    }

    const settings = await this.settingsService.get();

    const updated = await this.prisma.reservation.update({
      where: { id: reservation.id },
      data: {
        contractAcceptedAt: new Date(),
        contractAcceptedName: reservation.guestName,
        contractSnapshot: settings.houseRulesText,
      },
    });

    await this.eventsService.record(reservation.id, 'CONTRACT_ACCEPTED');
    await this.confirmationService.maybeAutoConfirm(reservation.id);

    return { contractAcceptedAt: updated.contractAcceptedAt };
  }

  // A single submission from the check-in page's "Actualizar datos de pagos" form: zero or
  // more receipt images, an optional shared note, or both — but never neither (the button is
  // disabled client-side unless at least one is present; this is the server-side backstop).
  // Sends exactly one staff notification for the whole batch, not one per image, whether or
  // not any files were attached.
  async submitPaymentUpdate(
    token: string,
    files: Express.Multer.File[],
    message?: string,
  ) {
    if (files.length === 0 && !message) {
      throw new BadRequestException('Either a file or a message is required');
    }

    this.reservationImagesService.assertAllowedImages(files);

    const reservation = await this.findByToken(token);
    const images = await Promise.all(
      files.map((file) =>
        this.reservationImagesService.upload(reservation.id, file, message),
      ),
    );

    if (images.length > 0) {
      const countLabel =
        images.length > 1 ? `${images.length} comprobantes` : 'un comprobante';
      await this.notificationsService.create({
        type: 'PAYMENT_RECEIPT_UPLOADED',
        message: `${reservation.guestName} subió ${countLabel} de pago.${message ? ` Nota: "${message}"` : ''}`,
        reservationId: reservation.id,
      });
    } else {
      await this.notificationsService.create({
        type: 'GUEST_MESSAGE',
        message: `${reservation.guestName} escribió: "${message}"`,
        reservationId: reservation.id,
      });
    }

    return { images };
  }

  async listImages(token: string) {
    const reservation = await this.findByToken(token);
    return this.reservationImagesService.listAvailableForReservation(reservation.id);
  }

  async getImageFile(token: string, imageId: string) {
    const reservation = await this.findByToken(token);
    const image = await this.reservationImagesService.getOne(
      reservation.id,
      imageId,
    );
    const buffer = await this.reservationImagesService.readFile(image);
    return {
      image,
      buffer,
      streamOptions: this.reservationImagesService.streamOptions(image),
    };
  }

  // A guest sees the property's current ambient sensor readings only once they're fully
  // confirmed (both the reservation payment and the security deposit received) and only while
  // their stay is actually happening (now falls within checkIn..checkOut) — or, in a debug
  // environment, always, so this is easy to test without waiting for a real reservation
  // window. This is a real, server-side gate: whether a client renders the section is a UX
  // nicety, not the security boundary.
  async getAmbientReadings(token: string) {
    const reservation = await this.findByToken(token);

    const isDebugMode = process.env.DEBUG_MODE === 'true';
    const isFullyConfirmed = reservation.confirmationPaymentReceivedAt != null && reservation.depositReceivedAt != null;
    const now = new Date();
    // checkIn/checkOut are stored as midnight-UTC dates with no time component (see
    // guest-web/src/lib/date.ts's header comment) — "inclusive of the check-out day" means
    // extending the window through the end of that day, not stopping at its very start.
    const stayEnd = new Date(reservation.checkOut.getTime() + 24 * 60 * 60 * 1000);
    const isDuringStay = now >= reservation.checkIn && now < stayEnd;

    if (!isDebugMode && !(isFullyConfirmed && isDuringStay)) {
      throw new ForbiddenException('Ambient sensor data is not available for this reservation right now');
    }

    return this.ambientService.listDevices();
  }
}
