import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GuestsService } from './guests.service';
import { PrismaService } from '../prisma/prisma.service';
import { GuestEventsService } from '../guest-events/guest-events.service';
import { DocumentCryptoService } from '../guest-documents/document-crypto.service';
import { NormalizedDocument } from '../guest-documents/guest-documents';

type FakeGuest = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  documentType: 'DNI' | 'PASAPORTE' | null;
  documentCountry: string | null;
  documentNumberEncrypted: string | null;
  documentHash: string | null;
  marketingConsentAt: Date | null;
  unsubscribedAt: Date | null;
};

const STRANGER_DNI: NormalizedDocument = { type: 'DNI', country: 'AR', number: '12345678' };
const OTHER_DNI: NormalizedDocument = { type: 'DNI', country: 'AR', number: '87654321' };

describe('GuestsService', () => {
  const originalEnv = process.env;
  let service: GuestsService;
  let crypto: DocumentCryptoService;
  let guests: FakeGuest[];
  let prisma: {
    guest: {
      update: jest.Mock;
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
    };
    reservation: { update: jest.Mock };
  };
  let guestEventsService: { record: jest.Mock };

  function addGuest(overrides: Partial<FakeGuest> & { id: string }): FakeGuest {
    const guest: FakeGuest = {
      name: 'Someone',
      email: null,
      phone: null,
      documentType: null,
      documentCountry: null,
      documentNumberEncrypted: null,
      documentHash: null,
      marketingConsentAt: null,
      unsubscribedAt: null,
      ...overrides,
    };
    guests.push(guest);
    return guest;
  }

  function withDocument(document: NormalizedDocument) {
    return crypto.encode(document);
  }

  function eventTypes() {
    return guestEventsService.record.mock.calls.map((call) => call[1]);
  }

  beforeEach(async () => {
    process.env = { ...originalEnv, DOCUMENT_ENCRYPTION_KEY: '11'.repeat(32), DOCUMENT_HASH_KEY: '22'.repeat(32) };
    guests = [];

    // An in-memory stand-in for the Guest table, so each test reads as "this is who exists"
    // rather than as a sequence of mocked return values.
    prisma = {
      guest: {
        findUnique: jest.fn(({ where }) => {
          const [key, value] = Object.entries(where)[0];
          const found = guests.find((g) => (g as Record<string, unknown>)[key] === value);
          // A copy, like Prisma: later updates must not rewrite what the caller already read.
          return Promise.resolve(found ? { ...found } : null);
        }),
        update: jest.fn(({ where, data }) => {
          const guest = guests.find((g) => g.id === where.id) as FakeGuest;
          Object.assign(guest, data);
          return Promise.resolve({ ...guest });
        }),
        create: jest.fn(({ data }) => Promise.resolve(addGuest({ id: `new-${guests.length + 1}`, ...data }))),
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
      reservation: { update: jest.fn() },
    };
    guestEventsService = { record: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        GuestsService,
        DocumentCryptoService,
        { provide: PrismaService, useValue: prisma },
        { provide: GuestEventsService, useValue: guestEventsService },
      ],
    }).compile();

    service = moduleRef.get(GuestsService);
    crypto = moduleRef.get(DocumentCryptoService);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('syncFromReservation — no document (imports, staff)', () => {
    it('creates a guest keyed on lowercased email and links the reservation', async () => {
      await service.syncFromReservation('res-1', { email: 'Jane@Example.com', name: 'Jane Doe', phone: '+54911' });

      expect(prisma.guest.create).toHaveBeenCalledWith({
        data: { name: 'Jane Doe', email: 'jane@example.com', phone: '+54911' },
      });
      expect(prisma.reservation.update).toHaveBeenCalledWith({ where: { id: 'res-1' }, data: { guestId: 'new-1' } });
      expect(guestEventsService.record).not.toHaveBeenCalled();
    });

    it('updates the guest found by email, overwriting the name as before', async () => {
      addGuest({ id: 'g1', name: 'Old Name', email: 'jane@example.com' });

      await service.syncFromReservation('res-1', { email: 'jane@example.com', name: 'Jane Doe' });

      expect(guests[0].name).toBe('Jane Doe');
      expect(eventTypes()).toEqual(['NAME_CHANGED']);
    });

    it('falls back to phone when there is no email', async () => {
      addGuest({ id: 'g1', name: 'Airbnb Guest', phone: '+5491100000000' });

      await service.syncFromReservation('res-1', { name: 'Airbnb Guest', phone: '+5491100000000' });

      expect(prisma.reservation.update).toHaveBeenCalledWith({ where: { id: 'res-1' }, data: { guestId: 'g1' } });
      expect(prisma.guest.create).not.toHaveBeenCalled();
    });

    it('does nothing with no document, email or phone', async () => {
      await service.syncFromReservation('res-1', { email: '   ', name: 'Jane Doe', phone: '   ' });

      expect(prisma.guest.create).not.toHaveBeenCalled();
      expect(prisma.reservation.update).not.toHaveBeenCalled();
    });

    it('updates the linked guest directly even when the email differs from what is on file', async () => {
      addGuest({ id: 'g1', name: 'Jane', email: 'old@example.com' });

      await service.syncFromReservation('res-1', { guestId: 'g1', email: 'new@example.com', name: 'Jane' });

      expect(guests[0].email).toBe('new@example.com');
      expect(guestEventsService.record).toHaveBeenCalledWith(
        'g1',
        'EMAIL_CHANGED',
        'Email: "old@example.com" → "new@example.com"',
        'email',
        'old@example.com',
        'new@example.com',
        undefined,
      );
    });

    it('records "(vacío)" as the previous phone when there was none', async () => {
      addGuest({ id: 'g1', name: 'Jane', email: 'jane@example.com' });

      await service.syncFromReservation('res-1', { guestId: 'g1', email: 'jane@example.com', name: 'Jane', phone: '+54911' });

      expect(guestEventsService.record).toHaveBeenCalledWith(
        'g1',
        'PHONE_CHANGED',
        'Teléfono: (vacío) → "+54911"',
        'phone',
        null,
        '+54911',
        undefined,
      );
    });

    it('records nothing when nothing changed, trimming the name first', async () => {
      addGuest({ id: 'g1', name: 'Jane', email: 'jane@example.com', phone: '+54911' });

      await service.syncFromReservation('res-1', { guestId: 'g1', email: 'jane@example.com', name: '  Jane ', phone: '+54911' });

      expect(guestEventsService.record).not.toHaveBeenCalled();
    });

    it('skips an email that belongs to another guest instead of throwing, and logs it', async () => {
      addGuest({ id: 'g1', name: 'Jane', email: 'jane@example.com' });
      addGuest({ id: 'g2', name: 'Other', email: 'taken@example.com' });

      await service.syncFromReservation('res-1', { guestId: 'g1', email: 'taken@example.com', name: 'Jane', actor: 'staff@x' });

      expect(guests[0].email).toBe('jane@example.com');
      expect(guestEventsService.record).toHaveBeenCalledWith(
        'g1',
        'CONTACT_INFO_NOT_APPLIED',
        'Email no aplicado (pertenece a otro huésped): "taken@example.com"',
        'email',
        'jane@example.com',
        'taken@example.com',
        'staff@x',
      );
    });

    it('skips a phone that belongs to another guest', async () => {
      addGuest({ id: 'g1', name: 'Jane', email: 'jane@example.com' });
      addGuest({ id: 'g2', name: 'Other', phone: '+54922' });

      await service.syncFromReservation('res-1', { guestId: 'g1', email: 'jane@example.com', name: 'Jane', phone: '+54922' });

      expect(guests[0].phone).toBeNull();
      expect(eventTypes()).toEqual(['CONTACT_INFO_NOT_APPLIED']);
    });

    it('never throws when a database call fails', async () => {
      prisma.guest.findUnique.mockRejectedValue(new Error('db down'));

      await expect(service.syncFromReservation('res-1', { email: 'a@b.c', name: 'A' })).resolves.toBeUndefined();
    });
  });

  describe('syncFromReservation — with a document', () => {
    it('case 1, guest form: a stranger\'s DNI links to their profile but overwrites nothing', async () => {
      addGuest({ id: 'victim', name: 'Real Owner', email: 'owner@example.com', phone: '+54911', ...withDocument(STRANGER_DNI) });
      addGuest({ id: 'mine', name: 'Attacker', email: 'attacker@example.com' });

      await service.syncFromReservation('res-1', {
        guestId: 'mine',
        name: 'Attacker',
        email: 'attacker@example.com',
        phone: '+54999',
        document: STRANGER_DNI,
        fillBlanksOnly: true,
        actor: 'Huésped',
      });

      expect(prisma.reservation.update).toHaveBeenCalledWith({ where: { id: 'res-1' }, data: { guestId: 'victim' } });
      expect(guests[0]).toMatchObject({ name: 'Real Owner', email: 'owner@example.com', phone: '+54911' });
      const notApplied = guestEventsService.record.mock.calls.filter((call) => call[1] === 'CONTACT_INFO_NOT_APPLIED');
      expect(notApplied.map((call) => [call[0], call[3], call[4], call[5], call[6]])).toEqual([
        ['victim', 'name', 'Real Owner', 'Attacker', 'Huésped'],
        ['victim', 'phone', '+54911', '+54999', 'Huésped'],
        ['victim', 'email', 'owner@example.com', 'attacker@example.com', 'Huésped'],
      ]);
      expect(eventTypes()).not.toContain('NAME_CHANGED');
    });

    it('case 1, guest form: fills fields that are empty on the matched profile', async () => {
      addGuest({ id: 'g1', name: 'Jane', email: 'jane@example.com', phone: null, ...withDocument(STRANGER_DNI) });

      await service.syncFromReservation('res-1', {
        name: 'Jane',
        email: 'jane@example.com',
        phone: '+54911',
        document: STRANGER_DNI,
        fillBlanksOnly: true,
      });

      expect(guests[0].phone).toBe('+54911');
      expect(eventTypes()).toEqual(['PHONE_CHANGED']);
    });

    it('case 1, staff: overwrites the matched profile as before', async () => {
      addGuest({ id: 'g1', name: 'Old', email: 'old@example.com', ...withDocument(STRANGER_DNI) });

      await service.syncFromReservation('res-1', { name: 'New', email: 'new@example.com', document: STRANGER_DNI, actor: 'staff@x' });

      expect(guests[0]).toMatchObject({ name: 'New', email: 'new@example.com' });
    });

    it('case 2: attaches the document to the reservation\'s own profile and applies contact updates', async () => {
      addGuest({ id: 'g1', name: 'Jane', email: 'relay@booking.com' });

      await service.syncFromReservation('res-1', {
        guestId: 'g1',
        name: 'Jane Doe',
        email: 'jane@example.com',
        document: STRANGER_DNI,
        fillBlanksOnly: true,
      });

      expect(guests).toHaveLength(1);
      expect(guests[0]).toMatchObject({ name: 'Jane Doe', email: 'jane@example.com', documentHash: crypto.hash(STRANGER_DNI) });
      expect(guests[0].documentNumberEncrypted).not.toContain('12345678');
      expect(guestEventsService.record).toHaveBeenCalledWith(
        'g1',
        'DOCUMENT_CHANGED',
        'Documento: (vacío) → DNI ···678',
        'document',
        null,
        'DNI ···678',
        undefined,
      );
    });

    it('case 3: a different document on the linked profile means a different person — new guest, relinked', async () => {
      addGuest({ id: 'g1', name: 'First Person', email: 'first@example.com', ...withDocument(OTHER_DNI) });

      await service.syncFromReservation('res-1', {
        guestId: 'g1',
        name: 'Second Person',
        email: 'second@example.com',
        document: STRANGER_DNI,
        fillBlanksOnly: true,
      });

      expect(guests[0]).toMatchObject({ name: 'First Person', email: 'first@example.com', documentHash: crypto.hash(OTHER_DNI) });
      expect(guests[1]).toMatchObject({ name: 'Second Person', email: 'second@example.com', documentHash: crypto.hash(STRANGER_DNI) });
      expect(prisma.reservation.update).toHaveBeenCalledWith({ where: { id: 'res-1' }, data: { guestId: guests[1].id } });
    });

    it('case 4: no match and no linked guest creates a new guest with the document', async () => {
      await service.syncFromReservation('res-1', { name: 'Jane', email: 'jane@example.com', document: STRANGER_DNI });

      expect(guests).toHaveLength(1);
      expect(guests[0].documentHash).toBe(crypto.hash(STRANGER_DNI));
    });

    it('case 4: a new guest still gets created when its email belongs to someone else — the email is dropped', async () => {
      addGuest({ id: 'g1', name: 'Other', email: 'shared@example.com' });

      await service.syncFromReservation('res-1', { name: 'Jane', email: 'shared@example.com', document: STRANGER_DNI });

      expect(guests[1]).toMatchObject({ name: 'Jane', email: null, documentHash: crypto.hash(STRANGER_DNI) });
      expect(guestEventsService.record).toHaveBeenCalledWith(
        guests[1].id,
        'CONTACT_INFO_NOT_APPLIED',
        expect.stringContaining('pertenece a otro huésped'),
        'email',
        null,
        'shared@example.com',
        undefined,
      );
    });

    it('staff changing the document logs masked values only', async () => {
      addGuest({ id: 'g1', name: 'Jane', ...withDocument(OTHER_DNI) });

      await service.syncFromReservation('res-1', { guestId: 'g1', name: 'Jane', document: STRANGER_DNI, actor: 'staff@x' });

      // OTHER_DNI is on g1, STRANGER_DNI on nobody: case 3, so the change creates a new guest
      // rather than rewriting g1's document.
      expect(guests).toHaveLength(2);
      const loggedValues = JSON.stringify(guestEventsService.record.mock.calls);
      expect(loggedValues).not.toContain('12345678');
      expect(loggedValues).not.toContain('87654321');
    });
  });

  describe('syncFromReservation — marketing consent', () => {
    it('sets marketingConsentAt when consent is given and none is on file', async () => {
      await service.syncFromReservation('res-1', { name: 'Jane', document: STRANGER_DNI, marketingConsent: true });

      expect(guests[0].marketingConsentAt).toBeInstanceOf(Date);
    });

    it('keeps the original consent date on a later opt-in', async () => {
      const original = new Date('2026-01-01');
      addGuest({ id: 'g1', name: 'Jane', marketingConsentAt: original, ...withDocument(STRANGER_DNI) });

      await service.syncFromReservation('res-1', { name: 'Jane', document: STRANGER_DNI, marketingConsent: true, fillBlanksOnly: true });

      expect(guests[0].marketingConsentAt).toBe(original);
    });

    it('never clears consent when a later submission leaves the box unchecked', async () => {
      const original = new Date('2026-01-01');
      addGuest({ id: 'g1', name: 'Jane', marketingConsentAt: original, ...withDocument(STRANGER_DNI) });

      await service.syncFromReservation('res-1', { name: 'Jane', document: STRANGER_DNI, marketingConsent: false, fillBlanksOnly: true });

      expect(guests[0].marketingConsentAt).toBe(original);
    });
  });

  describe('findAll', () => {
    it('computes totalStays/lastStayAt from completed stays and sorts by lastStayAt desc', async () => {
      prisma.guest.findMany.mockResolvedValue([
        { id: 'never', name: 'N', documentType: null, documentCountry: null, documentNumberEncrypted: null, documentHash: null, reservations: [] },
        {
          id: 'twice',
          name: 'T',
          ...withDocument(STRANGER_DNI),
          reservations: [{ checkOut: new Date('2026-03-01') }, { checkOut: new Date('2026-05-01') }],
        },
      ]);

      const result = await service.findAll();

      const call = prisma.guest.findMany.mock.calls[0][0];
      expect(call.include.reservations.where).toEqual({ status: { not: 'CANCELLED' }, checkOut: { lt: expect.any(Date) } });
      expect(result.map((g) => [g.id, g.totalStays, g.lastStayAt])).toEqual([
        ['twice', 2, new Date('2026-05-01')],
        ['never', 0, null],
      ]);
      expect(result[0].documentMasked).toBe('DNI ···678');
      expect(JSON.stringify(result)).not.toMatch(/documentHash|documentNumberEncrypted|12345678/);
    });

    it('searches by the document hash, normalizing the query first', async () => {
      prisma.guest.findMany.mockResolvedValue([]);

      await service.findAll({ type: 'DNI', number: '12.345.678' });

      expect(prisma.guest.findMany.mock.calls[0][0].where).toEqual({ documentHash: crypto.hash(STRANGER_DNI) });
    });

    it('rejects a malformed document search with a 400', async () => {
      await expect(service.findAll({ type: 'DNI', number: '12' })).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('findOne', () => {
    it('returns the decrypted document and stays computed from completed, non-cancelled reservations only', async () => {
      const past = new Date(Date.now() - 10 * 86_400_000);
      const future = new Date(Date.now() + 10 * 86_400_000);
      prisma.guest.findUnique.mockResolvedValue({
        id: 'g1',
        name: 'Jane',
        ...withDocument(STRANGER_DNI),
        reservations: [
          { id: 'future', status: 'CONFIRMED', checkOut: future, ...withDocument(STRANGER_DNI) },
          { id: 'cancelled', status: 'CANCELLED', checkOut: past, documentType: null, documentCountry: null, documentNumberEncrypted: null, documentHash: null },
          { id: 'done', status: 'CONFIRMED', checkOut: past, documentType: null, documentCountry: null, documentNumberEncrypted: null, documentHash: null },
        ],
      });

      const result = await service.findOne('g1');

      expect(result.document).toEqual(STRANGER_DNI);
      expect(result.totalStays).toBe(1);
      expect(result.lastStayAt).toEqual(past);
      expect(result.reservations[0]).not.toHaveProperty('documentNumberEncrypted');
      expect(result.reservations[0]).not.toHaveProperty('document');
      expect(JSON.stringify(result.reservations)).not.toContain('12345678');
    });

    it('throws NotFoundException for an unknown id', async () => {
      prisma.guest.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findEligibleForCampaign', () => {
    beforeEach(() => prisma.guest.findMany.mockResolvedValue([]));

    it('requires consent, an email and no unsubscribe for the ALL filter', async () => {
      await service.findEligibleForCampaign('ALL');

      expect(prisma.guest.findMany).toHaveBeenCalledWith({
        where: { unsubscribedAt: null, email: { not: null }, marketingConsentAt: { not: null } },
      });
    });

    it('can drop the consent requirement, for the preview\'s excluded count', async () => {
      await service.findEligibleForCampaign('ALL', undefined, { requireConsent: false });

      expect(prisma.guest.findMany).toHaveBeenCalledWith({ where: { unsubscribedAt: null, email: { not: null } } });
    });

    it('STAYED_WITHIN_MONTHS requires some completed stay since the cutoff', async () => {
      await service.findEligibleForCampaign('STAYED_WITHIN_MONTHS', 6);

      expect(prisma.guest.findMany.mock.calls[0][0].where.reservations).toEqual({
        some: { status: { not: 'CANCELLED' }, checkOut: { lt: expect.any(Date), gte: expect.any(Date) } },
      });
    });

    it('NOT_STAYED_WITHIN_MONTHS requires no completed stay since the cutoff (never stayed included)', async () => {
      await service.findEligibleForCampaign('NOT_STAYED_WITHIN_MONTHS', 6);

      const where = prisma.guest.findMany.mock.calls[0][0].where;
      expect(where.reservations).toEqual({
        none: { status: { not: 'CANCELLED' }, checkOut: { lt: expect.any(Date), gte: expect.any(Date) } },
      });
      const cutoff: Date = where.reservations.none.checkOut.gte;
      const expected = new Date();
      expected.setMonth(expected.getMonth() - 6);
      expect(Math.abs(cutoff.getTime() - expected.getTime())).toBeLessThan(5000);
    });
  });

  describe('unsubscribeByToken', () => {
    it('sets unsubscribedAt and records an UNSUBSCRIBED event for the matching token', async () => {
      addGuest({ id: 'g1', name: 'Jane' });
      prisma.guest.findFirst.mockResolvedValue({ id: 'g1' });

      await service.unsubscribeByToken('tok-1');

      expect(prisma.guest.findFirst).toHaveBeenCalledWith({ where: { unsubscribeToken: 'tok-1' } });
      expect(prisma.guest.update).toHaveBeenCalledWith({ where: { id: 'g1' }, data: { unsubscribedAt: expect.any(Date) } });
      expect(guestEventsService.record).toHaveBeenCalledWith('g1', 'UNSUBSCRIBED');
    });

    it('does nothing for an unknown token, without erroring', async () => {
      prisma.guest.findFirst.mockResolvedValue(null);

      await expect(service.unsubscribeByToken('unknown')).resolves.toBeUndefined();

      expect(prisma.guest.update).not.toHaveBeenCalled();
      expect(guestEventsService.record).not.toHaveBeenCalled();
    });
  });
});
