import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PublicReservationsService, TOKEN_VALID_DAYS_AFTER_CHECKOUT } from './public-reservations.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ReservationEventsService } from '../reservation-events/reservation-events.service';
import { ReservationConfirmationService } from '../reservation-confirmation/reservation-confirmation.service';
import { GuestsService } from '../guests/guests.service';
import { ReservationImagesService } from '../reservation-images/reservation-images.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AmbientService } from '../ambient/ambient.service';
import { DocumentCryptoService } from '../guest-documents/document-crypto.service';
import { ConfirmDatesDto } from './dto/confirm-dates.dto';

describe('PublicReservationsService', () => {
  const originalEnv = process.env;
  afterEach(() => {
    process.env = originalEnv;
  });
  let service: PublicReservationsService;
  let prisma: { reservation: { findUnique: jest.Mock; update: jest.Mock } };
  let settingsService: { get: jest.Mock };
  let eventsService: { record: jest.Mock };
  let confirmationService: { maybeAutoConfirm: jest.Mock };
  let guestsService: { syncFromReservation: jest.Mock };
  let reservationImagesService: {
    upload: jest.Mock;
    listAvailableForReservation: jest.Mock;
    getOne: jest.Mock;
    readFile: jest.Mock;
    assertAllowedImages: jest.Mock;
    streamOptions: jest.Mock;
  };
  let notificationsService: { create: jest.Mock };
  let ambientService: { listDevices: jest.Mock };

  // Relative to today, not fixed dates: a stay that ended more than
  // TOKEN_VALID_DAYS_AFTER_CHECKOUT ago makes the token itself stop working.
  const inDays = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  const baseReservation = {
    id: 'res-1',
    confirmationToken: 'tok-1',
    guestName: 'Jane Doe',
    checkIn: inDays(10),
    checkOut: inDays(14),
    paxCount: 2,
    totalAmount: 100000,
    currency: 'ARS',
    datesConfirmedAt: null,
    contractAcceptedAt: null,
    confirmationPaymentReceivedAt: null,
    depositReceivedAt: null,
  };

  // A full check-in form submission, with a valid DNI unless overridden.
  const checkIn = (fullName: string, phone: string, email: string, extra: Partial<ConfirmDatesDto> = {}): ConfirmDatesDto => ({
    fullName,
    phone,
    email,
    documentType: 'DNI',
    documentNumber: '12.345.678',
    ...extra,
  });

  beforeEach(async () => {
    process.env = { ...originalEnv, DOCUMENT_ENCRYPTION_KEY: '11'.repeat(32), DOCUMENT_HASH_KEY: '22'.repeat(32) };
    prisma = { reservation: { findUnique: jest.fn(), update: jest.fn() } };
    settingsService = {
      get: jest.fn().mockResolvedValue({
        houseRulesText: 'No parties.',
        paymentInstructions: 'Bank X.',
        confirmationPaymentValue: '30%',
        securityDepositValue: '15%',
      }),
    };
    eventsService = { record: jest.fn() };
    confirmationService = { maybeAutoConfirm: jest.fn() };
    guestsService = { syncFromReservation: jest.fn() };
    reservationImagesService = {
      upload: jest.fn(),
      listAvailableForReservation: jest.fn(),
      getOne: jest.fn(),
      readFile: jest.fn(),
      assertAllowedImages: jest.fn(),
      streamOptions: jest.fn(),
    };
    notificationsService = { create: jest.fn() };
    ambientService = { listDevices: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PublicReservationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SettingsService, useValue: settingsService },
        { provide: ReservationEventsService, useValue: eventsService },
        {
          provide: ReservationConfirmationService,
          useValue: confirmationService,
        },
        { provide: GuestsService, useValue: guestsService },
        {
          provide: ReservationImagesService,
          useValue: reservationImagesService,
        },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: AmbientService, useValue: ambientService },
        DocumentCryptoService,
      ],
    }).compile();

    service = moduleRef.get(PublicReservationsService);
  });

  it('throws NotFoundException for an unknown token', async () => {
    prisma.reservation.findUnique.mockResolvedValue(null);

    await expect(service.getByToken('missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('returns reservation details plus house rules and payment instructions', async () => {
    prisma.reservation.findUnique.mockResolvedValue({ ...baseReservation });

    const result = await service.getByToken('tok-1');

    expect(result.guestName).toBe('Jane Doe');
    expect(result.houseRulesText).toBe('No parties.');
    expect(result.paymentInstructions).toBe('Bank X.');
  });

  it('computes confirmationPaymentAmount as 30% of totalAmount', async () => {
    prisma.reservation.findUnique.mockResolvedValue({
      ...baseReservation,
      totalAmount: 100000,
    });

    const result = await service.getByToken('tok-1');

    expect(result.confirmationPaymentAmount).toBe(30000);
  });

  it('rounds confirmationPaymentAmount to 2 decimal places for a non-round total', async () => {
    prisma.reservation.findUnique.mockResolvedValue({
      ...baseReservation,
      totalAmount: 123456.78,
    });

    const result = await service.getByToken('tok-1');

    expect(result.confirmationPaymentAmount).toBe(37037.03);
  });

  it('computes confirmationPaymentAmount using the configured percentage, not a hardcoded 30%', async () => {
    settingsService.get.mockResolvedValue({
      houseRulesText: 'No parties.',
      paymentInstructions: 'Bank X.',
      confirmationPaymentValue: '20%',
      securityDepositValue: '15%',
    });
    prisma.reservation.findUnique.mockResolvedValue({
      ...baseReservation,
      totalAmount: 100000,
    });

    const result = await service.getByToken('tok-1');

    expect(result.confirmationPaymentAmount).toBe(20000);
  });

  it('resolves confirmationPaymentAmount as a fixed amount when configured as one', async () => {
    settingsService.get.mockResolvedValue({
      houseRulesText: 'No parties.',
      paymentInstructions: 'Bank X.',
      confirmationPaymentValue: '45000',
      securityDepositValue: '15%',
    });
    prisma.reservation.findUnique.mockResolvedValue({
      ...baseReservation,
      totalAmount: 100000,
    });

    const result = await service.getByToken('tok-1');

    expect(result.confirmationPaymentAmount).toBe(45000);
    expect(result.confirmationPaymentPercentage).toBeNull();
  });

  it('resolves securityDepositAmount as a fixed amount when configured as one', async () => {
    settingsService.get.mockResolvedValue({
      houseRulesText: 'No parties.',
      paymentInstructions: 'Bank X.',
      confirmationPaymentValue: '30%',
      securityDepositValue: '150000',
    });
    prisma.reservation.findUnique.mockResolvedValue({
      ...baseReservation,
      totalAmount: 100000,
    });

    const result = await service.getByToken('tok-1');

    expect(result.securityDepositAmount).toBe(150000);
  });

  it('computes securityDepositAmount as the configured percentage of totalAmount', async () => {
    prisma.reservation.findUnique.mockResolvedValue({
      ...baseReservation,
      totalAmount: 100000,
    });

    const result = await service.getByToken('tok-1');

    expect(result.securityDepositAmount).toBe(15000);
  });

  it('confirms dates, saves the guest-provided name/phone/email, records an event, and checks auto-confirmation', async () => {
    prisma.reservation.findUnique.mockResolvedValue({ ...baseReservation });
    prisma.reservation.update.mockResolvedValue({
      ...baseReservation,
      datesConfirmedAt: new Date(),
      guestName: 'Jane Doe',
      guestPhone: '+54 9 223 555-1234',
      guestEmail: 'jane@example.com',
    });

    await service.confirmDates('tok-1', checkIn('Jane Doe', '+54 9 223 555-1234', 'Jane@Example.com'));

    expect(prisma.reservation.update).toHaveBeenCalledWith({
      where: { id: 'res-1' },
      data: {
        datesConfirmedAt: expect.any(Date),
        guestName: 'Jane Doe',
        guestPhone: '+54 9 223 555-1234',
        // Normalized to lowercase, same as every other place this app stores a guest email.
        guestEmail: 'jane@example.com',
        documentType: 'DNI',
        documentCountry: 'AR',
        documentNumberEncrypted: expect.stringMatching(/^v1:/),
        documentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    });
    expect(eventsService.record).toHaveBeenCalledWith(
      'res-1',
      'DATES_CONFIRMED',
    );
    expect(confirmationService.maybeAutoConfirm).toHaveBeenCalledWith('res-1');
  });

  it('records FIELD_CHANGED events for the guest info the guest corrects during check-in', async () => {
    prisma.reservation.findUnique.mockResolvedValue({
      ...baseReservation,
      guestName: 'Placeholder Name',
      guestPhone: null,
      guestEmail: null,
    });
    prisma.reservation.update.mockResolvedValue({
      ...baseReservation,
      datesConfirmedAt: new Date(),
      guestName: 'Jane Doe',
      guestPhone: '+54911',
      guestEmail: 'jane@example.com',
    });

    await service.confirmDates('tok-1', checkIn('Jane Doe', '+54911', 'jane@example.com'));

    expect(eventsService.record).toHaveBeenCalledWith(
      'res-1',
      'FIELD_CHANGED',
      'Nombre del huésped: "Placeholder Name" → "Jane Doe"',
      'guestName',
      'Placeholder Name',
      'Jane Doe',
      'Huésped',
    );
    expect(eventsService.record).toHaveBeenCalledWith(
      'res-1',
      'FIELD_CHANGED',
      'Teléfono del huésped: "(vacío)" → "+54911"',
      'guestPhone',
      '(vacío)',
      '+54911',
      'Huésped',
    );
    expect(eventsService.record).toHaveBeenCalledWith(
      'res-1',
      'FIELD_CHANGED',
      'Email del huésped: "(vacío)" → "jane@example.com"',
      'guestEmail',
      '(vacío)',
      'jane@example.com',
      'Huésped',
    );
  });

  it('does not re-update or re-record an event when dates are already confirmed', async () => {
    const alreadyConfirmedAt = new Date('2026-01-01T00:00:00.000Z');
    prisma.reservation.findUnique.mockResolvedValue({
      ...baseReservation,
      datesConfirmedAt: alreadyConfirmedAt,
    });

    const result = await service.confirmDates('tok-1', checkIn('A Different Name', '+54911', 'a@example.com'));

    expect(result).toEqual({ datesConfirmedAt: alreadyConfirmedAt });
    expect(prisma.reservation.update).not.toHaveBeenCalled();
    expect(eventsService.record).not.toHaveBeenCalled();
    expect(confirmationService.maybeAutoConfirm).not.toHaveBeenCalled();
  });

  it('syncs the guest with the self-provided name, phone, and email when dates are confirmed', async () => {
    prisma.reservation.findUnique.mockResolvedValue({ ...baseReservation });
    prisma.reservation.update.mockResolvedValue({
      ...baseReservation,
      datesConfirmedAt: new Date(),
      guestEmail: 'jane@example.com',
      guestPhone: '+54911',
    });

    await service.confirmDates('tok-1', checkIn('Jane Q. Doe', '+54911', 'jane@example.com'));

    expect(guestsService.syncFromReservation).toHaveBeenCalledWith('res-1', {
      email: 'jane@example.com',
      name: 'Jane Q. Doe',
      phone: '+54911',
      guestId: undefined,
      actor: 'Huésped',
      document: { type: 'DNI', country: 'AR', number: '12345678' },
      fillBlanksOnly: true,
      marketingConsent: false,
    });
  });

  it('passes the marketing opt-in through to the guest sync', async () => {
    prisma.reservation.findUnique.mockResolvedValue({ ...baseReservation });
    prisma.reservation.update.mockResolvedValue({ ...baseReservation, datesConfirmedAt: new Date() });

    await service.confirmDates('tok-1', checkIn('Jane', '+54911', 'jane@example.com', { marketingConsent: true }));

    expect(guestsService.syncFromReservation).toHaveBeenCalledWith('res-1', expect.objectContaining({ marketingConsent: true }));
  });

  it('records the document on the reservation as a masked FIELD_CHANGED event', async () => {
    prisma.reservation.findUnique.mockResolvedValue({ ...baseReservation });
    prisma.reservation.update.mockResolvedValue({ ...baseReservation, datesConfirmedAt: new Date() });

    await service.confirmDates('tok-1', checkIn('Jane', '+54911', 'jane@example.com'));

    expect(eventsService.record).toHaveBeenCalledWith(
      'res-1',
      'FIELD_CHANGED',
      'Documento: "(vacío)" → "DNI ···678"',
      'document',
      '(vacío)',
      'DNI ···678',
      'Huésped',
    );
    expect(JSON.stringify(eventsService.record.mock.calls)).not.toContain('12345678');
  });

  it('accepts a passport with its issuing country', async () => {
    prisma.reservation.findUnique.mockResolvedValue({ ...baseReservation });
    prisma.reservation.update.mockResolvedValue({ ...baseReservation, datesConfirmedAt: new Date() });

    await service.confirmDates(
      'tok-1',
      checkIn('Juan', '+54911', 'juan@example.es', { documentType: 'PASAPORTE', documentCountry: 'ES', documentNumber: 'xa123456' }),
    );

    expect(prisma.reservation.update.mock.calls[0][0].data).toMatchObject({ documentType: 'PASAPORTE', documentCountry: 'ES' });
  });

  it.each([
    [{ documentNumber: '12' }, 'El DNI debe tener 7 u 8 dígitos.'],
    [{ documentType: 'PASAPORTE' as const, documentNumber: 'XA123456' }, 'Elegí el país emisor del pasaporte.'],
  ])('rejects an invalid document with a Spanish 400 and writes nothing', async (extra, message) => {
    prisma.reservation.findUnique.mockResolvedValue({ ...baseReservation });

    const attempt = service.confirmDates('tok-1', checkIn('Jane', '+54911', 'jane@example.com', extra));

    await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
    await expect(attempt).rejects.toThrow(message);
    expect(prisma.reservation.update).not.toHaveBeenCalled();
    expect(guestsService.syncFromReservation).not.toHaveBeenCalled();
  });

  it('returns only datesConfirmedAt — never the document', async () => {
    prisma.reservation.findUnique.mockResolvedValue({ ...baseReservation });
    prisma.reservation.update.mockResolvedValue({ ...baseReservation, datesConfirmedAt: new Date() });

    const result = await service.confirmDates('tok-1', checkIn('Jane', '+54911', 'jane@example.com'));

    expect(Object.keys(result)).toEqual(['datesConfirmedAt']);
  });

  it('does not sync a guest when dates were already confirmed', async () => {
    prisma.reservation.findUnique.mockResolvedValue({
      ...baseReservation,
      datesConfirmedAt: new Date('2026-01-01'),
      guestEmail: 'jane@example.com',
    });

    await service.confirmDates('tok-1', checkIn('A Different Name', '+54911', 'a@example.com'));

    expect(guestsService.syncFromReservation).not.toHaveBeenCalled();
  });

  it('accepts the contract, snapshotting the house rules and using the already-confirmed guest name', async () => {
    prisma.reservation.findUnique.mockResolvedValue({
      ...baseReservation,
      guestName: 'Jane Doe',
      datesConfirmedAt: new Date('2026-01-01'),
    });
    prisma.reservation.update.mockResolvedValue({
      ...baseReservation,
      contractAcceptedAt: new Date(),
      contractAcceptedName: 'Jane Doe',
    });

    await service.acceptContract('tok-1');

    expect(prisma.reservation.update).toHaveBeenCalledWith({
      where: { id: 'res-1' },
      data: {
        contractAcceptedAt: expect.any(Date),
        contractAcceptedName: 'Jane Doe',
        contractSnapshot: 'No parties.',
      },
    });
    expect(eventsService.record).toHaveBeenCalledWith(
      'res-1',
      'CONTRACT_ACCEPTED',
    );
    expect(confirmationService.maybeAutoConfirm).toHaveBeenCalledWith('res-1');
  });

  it('does not re-update or re-record an event when the contract is already accepted', async () => {
    const alreadyAcceptedAt = new Date('2026-01-01T00:00:00.000Z');
    prisma.reservation.findUnique.mockResolvedValue({
      ...baseReservation,
      contractAcceptedAt: alreadyAcceptedAt,
      contractAcceptedName: 'Original Name',
    });

    const result = await service.acceptContract('tok-1');

    expect(result).toEqual({ contractAcceptedAt: alreadyAcceptedAt });
    expect(prisma.reservation.update).not.toHaveBeenCalled();
    expect(eventsService.record).not.toHaveBeenCalled();
    expect(confirmationService.maybeAutoConfirm).not.toHaveBeenCalled();
  });

  describe('submitPaymentUpdate', () => {
    const file = {
      buffer: Buffer.from('x'),
      originalname: 'a.jpg',
      mimetype: 'image/jpeg',
      size: 1,
    } as Express.Multer.File;

    it('uploads a single file, attaches the message to it, and sends one notification', async () => {
      prisma.reservation.findUnique.mockResolvedValue({ ...baseReservation });
      reservationImagesService.upload.mockResolvedValue({ id: 'img-1' });

      const result = await service.submitPaymentUpdate(
        'tok-1',
        [file],
        'es la seña',
      );

      expect(reservationImagesService.upload).toHaveBeenCalledTimes(1);
      expect(reservationImagesService.upload).toHaveBeenCalledWith(
        'res-1',
        file,
        'es la seña',
      );
      expect(notificationsService.create).toHaveBeenCalledWith({
        type: 'PAYMENT_RECEIPT_UPLOADED',
        message: 'Jane Doe subió un comprobante de pago. Nota: "es la seña"',
        reservationId: 'res-1',
      });
      expect(result).toEqual({ images: [{ id: 'img-1' }] });
    });

    it('uploads every file in a multi-file submission, and sends exactly one notification for the whole batch', async () => {
      prisma.reservation.findUnique.mockResolvedValue({ ...baseReservation });
      reservationImagesService.upload
        .mockResolvedValueOnce({ id: 'img-1' })
        .mockResolvedValueOnce({ id: 'img-2' });
      const secondFile = { ...file, originalname: 'b.jpg' };

      const result = await service.submitPaymentUpdate('tok-1', [
        file,
        secondFile,
      ]);

      expect(reservationImagesService.upload).toHaveBeenCalledTimes(2);
      expect(notificationsService.create).toHaveBeenCalledTimes(1);
      expect(notificationsService.create).toHaveBeenCalledWith({
        type: 'PAYMENT_RECEIPT_UPLOADED',
        message: 'Jane Doe subió 2 comprobantes de pago.',
        reservationId: 'res-1',
      });
      expect(result).toEqual({ images: [{ id: 'img-1' }, { id: 'img-2' }] });
    });

    it('creates a GUEST_MESSAGE notification and no image when only a message is given', async () => {
      prisma.reservation.findUnique.mockResolvedValue({ ...baseReservation });

      const result = await service.submitPaymentUpdate(
        'tok-1',
        [],
        'todavía no transferí',
      );

      expect(reservationImagesService.upload).not.toHaveBeenCalled();
      expect(notificationsService.create).toHaveBeenCalledWith({
        type: 'GUEST_MESSAGE',
        message: 'Jane Doe escribió: "todavía no transferí"',
        reservationId: 'res-1',
      });
      expect(result).toEqual({ images: [] });
    });

    it('rejects an empty submission (no files and no message) without hitting the database', async () => {
      await expect(
        service.submitPaymentUpdate('tok-1', []),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.reservation.findUnique).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for an unknown token, never reaching ReservationImagesService', async () => {
      prisma.reservation.findUnique.mockResolvedValue(null);

      await expect(
        service.submitPaymentUpdate('missing', [file]),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(reservationImagesService.upload).not.toHaveBeenCalled();
    });
  });

  describe('listImages', () => {
    it('resolves the token to a reservation id before listing', async () => {
      prisma.reservation.findUnique.mockResolvedValue({ ...baseReservation });
      reservationImagesService.listAvailableForReservation.mockResolvedValue([
        { id: 'img-1' },
      ]);

      const result = await service.listImages('tok-1');

      expect(reservationImagesService.listAvailableForReservation).toHaveBeenCalledWith(
        'res-1',
      );
      expect(result).toEqual([{ id: 'img-1' }]);
    });
  });

  describe('submitPaymentUpdate file validation', () => {
    it('rejects the whole submission, uploading nothing, if any file is not an allowed image', async () => {
      prisma.reservation.findUnique.mockResolvedValue({ ...baseReservation });
      reservationImagesService.assertAllowedImages.mockImplementation(() => {
        throw new BadRequestException('Only JPEG, PNG, GIF, WebP or HEIC images are allowed');
      });

      await expect(
        service.submitPaymentUpdate('tok-1', [{ buffer: Buffer.from('<svg/>') } as Express.Multer.File]),
      ).rejects.toThrow(BadRequestException);
      expect(reservationImagesService.upload).not.toHaveBeenCalled();
      expect(notificationsService.create).not.toHaveBeenCalled();
    });
  });

  describe('getImageFile', () => {
    it('resolves the token, then the image scoped to that reservation, then reads the file', async () => {
      prisma.reservation.findUnique.mockResolvedValue({ ...baseReservation });
      const image = { id: 'img-1', mimeType: 'image/jpeg', filename: 'x.jpg' };
      reservationImagesService.getOne.mockResolvedValue(image);
      reservationImagesService.readFile.mockResolvedValue(Buffer.from('bytes'));
      reservationImagesService.streamOptions.mockReturnValue({ type: 'image/jpeg' });

      const result = await service.getImageFile('tok-1', 'img-1');

      expect(reservationImagesService.getOne).toHaveBeenCalledWith(
        'res-1',
        'img-1',
      );
      expect(reservationImagesService.readFile).toHaveBeenCalledWith(image);
      expect(result).toEqual({
        image,
        buffer: Buffer.from('bytes'),
        streamOptions: { type: 'image/jpeg' },
      });
    });
  });

  describe('findByToken (link expiry)', () => {
    it('accepts a token up to TOKEN_VALID_DAYS_AFTER_CHECKOUT days after check-out', async () => {
      prisma.reservation.findUnique.mockResolvedValue({
        ...baseReservation,
        checkIn: inDays(-TOKEN_VALID_DAYS_AFTER_CHECKOUT - 4),
        checkOut: inDays(-TOKEN_VALID_DAYS_AFTER_CHECKOUT + 1),
      });

      await expect(service.findByToken('tok-1')).resolves.toMatchObject({ id: 'res-1' });
    });

    it('rejects a token once TOKEN_VALID_DAYS_AFTER_CHECKOUT days have passed since check-out', async () => {
      prisma.reservation.findUnique.mockResolvedValue({
        ...baseReservation,
        checkIn: inDays(-TOKEN_VALID_DAYS_AFTER_CHECKOUT - 5),
        checkOut: inDays(-TOKEN_VALID_DAYS_AFTER_CHECKOUT - 1),
      });

      await expect(service.findByToken('tok-1')).rejects.toThrow(NotFoundException);
    });

    it('rejects an expired token on write endpoints too, without touching the reservation', async () => {
      prisma.reservation.findUnique.mockResolvedValue({
        ...baseReservation,
        checkOut: inDays(-TOKEN_VALID_DAYS_AFTER_CHECKOUT - 1),
      });

      await expect(service.acceptContract('tok-1')).rejects.toThrow(NotFoundException);
      expect(prisma.reservation.update).not.toHaveBeenCalled();
    });
  });

  describe('getAmbientReadings', () => {
    const originalDebugMode = process.env.DEBUG_MODE;

    afterEach(() => {
      process.env.DEBUG_MODE = originalDebugMode;
    });

    it('throws NotFoundException for an unknown token', async () => {
      process.env.DEBUG_MODE = 'false';
      prisma.reservation.findUnique.mockResolvedValue(null);

      await expect(service.getAmbientReadings('missing')).rejects.toThrow(NotFoundException);
    });

    it('returns device readings when fully confirmed and currently within the stay dates', async () => {
      process.env.DEBUG_MODE = 'false';
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      prisma.reservation.findUnique.mockResolvedValue({
        ...baseReservation,
        checkIn: yesterday,
        checkOut: tomorrow,
        confirmationPaymentReceivedAt: new Date('2026-01-01'),
        depositReceivedAt: new Date('2026-01-01'),
      });
      ambientService.listDevices.mockResolvedValue([{ id: 'dev-1', name: 'Living room', readings: [] }]);

      const result = await service.getAmbientReadings('tok-1');

      expect(result).toEqual([{ id: 'dev-1', name: 'Living room', readings: [] }]);
    });

    it('remains eligible through the end of the check-out day, not just its midnight start', async () => {
      process.env.DEBUG_MODE = 'false';
      const today = new Date();
      const todayDateOnly = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
      const yesterdayDateOnly = new Date(todayDateOnly.getTime() - 24 * 60 * 60 * 1000);
      prisma.reservation.findUnique.mockResolvedValue({
        ...baseReservation,
        checkIn: yesterdayDateOnly,
        checkOut: todayDateOnly,
        confirmationPaymentReceivedAt: new Date('2026-01-01'),
        depositReceivedAt: new Date('2026-01-01'),
      });
      ambientService.listDevices.mockResolvedValue([{ id: 'dev-1', name: 'Living room', readings: [] }]);

      const result = await service.getAmbientReadings('tok-1');

      expect(result).toEqual([{ id: 'dev-1', name: 'Living room', readings: [] }]);
    });

    it('throws ForbiddenException when fully confirmed but before check-in', async () => {
      process.env.DEBUG_MODE = 'false';
      const now = new Date();
      const future = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const farFuture = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
      prisma.reservation.findUnique.mockResolvedValue({
        ...baseReservation,
        checkIn: future,
        checkOut: farFuture,
        confirmationPaymentReceivedAt: new Date('2026-01-01'),
        depositReceivedAt: new Date('2026-01-01'),
      });

      await expect(service.getAmbientReadings('tok-1')).rejects.toThrow(ForbiddenException);
      expect(ambientService.listDevices).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when fully confirmed but after check-out', async () => {
      process.env.DEBUG_MODE = 'false';
      const now = new Date();
      const past1 = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
      const past2 = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
      prisma.reservation.findUnique.mockResolvedValue({
        ...baseReservation,
        checkIn: past1,
        checkOut: past2,
        confirmationPaymentReceivedAt: new Date('2026-01-01'),
        depositReceivedAt: new Date('2026-01-01'),
      });

      await expect(service.getAmbientReadings('tok-1')).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when currently within stay dates but not fully confirmed', async () => {
      process.env.DEBUG_MODE = 'false';
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      prisma.reservation.findUnique.mockResolvedValue({
        ...baseReservation,
        checkIn: yesterday,
        checkOut: tomorrow,
        confirmationPaymentReceivedAt: null,
        depositReceivedAt: null,
      });

      await expect(service.getAmbientReadings('tok-1')).rejects.toThrow(ForbiddenException);
    });

    it('returns device readings regardless of confirmation/dates when DEBUG_MODE is on', async () => {
      process.env.DEBUG_MODE = 'true';
      prisma.reservation.findUnique.mockResolvedValue({
        ...baseReservation,
        checkIn: inDays(20),
        checkOut: inDays(25),
        confirmationPaymentReceivedAt: null,
        depositReceivedAt: null,
      });
      ambientService.listDevices.mockResolvedValue([{ id: 'dev-1', name: 'Living room', readings: [] }]);

      const result = await service.getAmbientReadings('tok-1');

      expect(result).toEqual([{ id: 'dev-1', name: 'Living room', readings: [] }]);
    });
  });
});
