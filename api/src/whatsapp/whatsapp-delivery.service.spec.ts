import { WhatsappDeliveryService } from './whatsapp-delivery.service';

describe('WhatsappDeliveryService', () => {
  let service: WhatsappDeliveryService;
  let prisma: {
    whatsappMessage: {
      create: jest.Mock;
      findUnique: jest.Mock;
      updateMany: jest.Mock;
      findMany: jest.Mock;
    };
  };
  let eventsService: { record: jest.Mock };

  beforeEach(() => {
    prisma = {
      whatsappMessage: {
        create: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn(),
      },
    };
    eventsService = { record: jest.fn() };
    service = new WhatsappDeliveryService(
      prisma as never,
      eventsService as never,
    );
  });

  describe('recordSend', () => {
    const context = {
      reservationId: 'res-1',
      kind: 'DEPOSIT_REMINDER' as const,
    };

    it('stores an accepted send with its SID and status', async () => {
      await service.recordSend(context, {
        accepted: true,
        twilioSid: 'SM1',
        status: 'queued',
      });

      expect(prisma.whatsappMessage.create).toHaveBeenCalledWith({
        data: {
          reservationId: 'res-1',
          kind: 'DEPOSIT_REMINDER',
          twilioSid: 'SM1',
          status: 'queued',
        },
      });
    });

    it('stores a rejected send with its reason and no SID', async () => {
      await service.recordSend(context, {
        accepted: false,
        errorCode: '63003',
        errorMessage: 'nope',
      });

      expect(prisma.whatsappMessage.create).toHaveBeenCalledWith({
        data: {
          reservationId: 'res-1',
          kind: 'DEPOSIT_REMINDER',
          status: 'rejected',
          errorCode: '63003',
          errorMessage: 'nope',
        },
      });
    });

    it('never throws when the row cannot be written', async () => {
      prisma.whatsappMessage.create.mockRejectedValue(new Error('db down'));

      await expect(
        service.recordSend(context, {
          accepted: true,
          twilioSid: 'SM1',
          status: 'queued',
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('applyStatus', () => {
    const stored = {
      id: 'msg-1',
      reservationId: 'res-1',
      kind: 'CHECKIN_LINK',
      status: 'sent',
      errorCode: null,
    };

    it('ignores an unknown SID', async () => {
      prisma.whatsappMessage.findUnique.mockResolvedValue(null);

      await service.applyStatus('SM-unknown', 'delivered', null);

      expect(prisma.whatsappMessage.updateMany).not.toHaveBeenCalled();
    });

    it('applies a forward status conditionally on the status it read', async () => {
      prisma.whatsappMessage.findUnique.mockResolvedValue(stored);

      await service.applyStatus('SM1', 'delivered', null);

      expect(prisma.whatsappMessage.updateMany).toHaveBeenCalledWith({
        where: { id: 'msg-1', status: 'sent' },
        data: { status: 'delivered', errorCode: null },
      });
      expect(eventsService.record).not.toHaveBeenCalled();
    });

    it('ignores a status that would move it backwards', async () => {
      prisma.whatsappMessage.findUnique.mockResolvedValue({
        ...stored,
        status: 'delivered',
      });

      await service.applyStatus('SM1', 'sent', null);

      expect(prisma.whatsappMessage.updateMany).not.toHaveBeenCalled();
    });

    it('records one WHATSAPP_UNDELIVERED event when it becomes undelivered', async () => {
      prisma.whatsappMessage.findUnique.mockResolvedValue(stored);

      await service.applyStatus('SM1', 'undelivered', '63016');

      expect(eventsService.record).toHaveBeenCalledTimes(1);
      expect(eventsService.record).toHaveBeenCalledWith(
        'res-1',
        'WHATSAPP_UNDELIVERED',
        'Link de check-in: WhatsApp no entregado (error Twilio 63016)',
      );
    });

    it('records nothing when a concurrent callback already applied it', async () => {
      prisma.whatsappMessage.findUnique.mockResolvedValue(stored);
      prisma.whatsappMessage.updateMany.mockResolvedValue({ count: 0 });

      await service.applyStatus('SM1', 'undelivered', '63016');

      expect(eventsService.record).not.toHaveBeenCalled();
    });
  });

  describe('latestByReservation', () => {
    it('keeps only the newest message of each kind per reservation', async () => {
      const at = (iso: string) => new Date(iso);
      prisma.whatsappMessage.findMany.mockResolvedValue([
        {
          reservationId: 'res-1',
          kind: 'CHECKIN_LINK',
          status: 'delivered',
          errorCode: null,
          createdAt: at('2026-10-02'),
        },
        {
          reservationId: 'res-1',
          kind: 'CHECKIN_LINK',
          status: 'undelivered',
          errorCode: '63016',
          createdAt: at('2026-10-01'),
        },
        {
          reservationId: 'res-1',
          kind: 'DEPOSIT_REMINDER',
          status: 'rejected',
          errorCode: null,
          createdAt: at('2026-10-01'),
        },
      ]);

      const result = await service.latestByReservation(['res-1', 'res-2']);

      expect(result.get('res-1')).toEqual([
        {
          kind: 'CHECKIN_LINK',
          status: 'delivered',
          errorCode: null,
          createdAt: at('2026-10-02'),
        },
        {
          kind: 'DEPOSIT_REMINDER',
          status: 'rejected',
          errorCode: null,
          createdAt: at('2026-10-01'),
        },
      ]);
      expect(result.get('res-2')).toBeUndefined();
    });

    it('skips the query entirely for no reservations', async () => {
      await service.latestByReservation([]);

      expect(prisma.whatsappMessage.findMany).not.toHaveBeenCalled();
    });
  });
});
