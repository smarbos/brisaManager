import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { EmailOutboxService } from './email-outbox.service';
import { EmailSenderService } from './email-sender.service';
import { PrismaService } from '../prisma/prisma.service';

describe('EmailOutboxService', () => {
  let service: EmailOutboxService;
  let prisma: {
    outboundEmail: { create: jest.Mock; findUnique: jest.Mock; updateMany: jest.Mock; findMany: jest.Mock };
  };
  let sender: { send: jest.Mock; applyEffects: jest.Mock };
  const originalDelay = process.env.EMAIL_SEND_DELAY_MS;

  const entry = {
    id: 'e1',
    kind: 'INITIAL_CONFIRMATION',
    status: 'SCHEDULED',
    to: 'guest@example.com',
    subject: 'Confirmá tu reserva',
    html: '<p>Hola</p>',
    replyTo: 'reservas@labrisa.com.ar',
    reservationId: 'res-1',
    campaignRecipientId: null,
    inboundEmailId: null,
  };

  beforeEach(async () => {
    delete process.env.EMAIL_SEND_DELAY_MS;
    prisma = {
      outboundEmail: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'new', ...data })),
        findUnique: jest.fn().mockResolvedValue(entry),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    sender = {
      send: jest.fn().mockImplementation((e) => Promise.resolve({ ...e, status: 'SENT' })),
      applyEffects: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        EmailOutboxService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailSenderService, useValue: sender },
      ],
    }).compile();
    service = moduleRef.get(EmailOutboxService);
  });

  afterAll(() => {
    process.env.EMAIL_SEND_DELAY_MS = originalDelay;
  });

  describe('enqueue', () => {
    it('schedules the email 5 minutes out by default', async () => {
      const before = Date.now();
      const created = await service.enqueue({ kind: 'ALERT', to: 'owner@labrisa.com.ar', subject: 'x', html: '<p>x</p>' });

      expect(created.status).toBeUndefined(); // the DB default (SCHEDULED) applies
      const sendAt = (created.sendAt as Date).getTime();
      expect(sendAt).toBeGreaterThanOrEqual(before + 300_000);
      expect(sendAt).toBeLessThanOrEqual(Date.now() + 300_000);
    });

    it('uses EMAIL_SEND_DELAY_MS when set', async () => {
      process.env.EMAIL_SEND_DELAY_MS = '1000';
      const before = Date.now();
      const created = await service.enqueue({ kind: 'ALERT', to: 'a@b.c', subject: 'x' });

      expect((created.sendAt as Date).getTime()).toBeLessThanOrEqual(before + 1000 + 50);
    });

    it('respects an explicit sendAt', async () => {
      const sendAt = new Date('2026-10-01T12:00:00Z');
      const created = await service.enqueue({ kind: 'INBOUND_FORWARD', to: 'a@b.c', subject: 'x', sendAt });

      expect(created.sendAt).toEqual(sendAt);
    });
  });

  describe('abort', () => {
    it('aborts a scheduled email and applies the ABORTED effects', async () => {
      prisma.outboundEmail.findUnique
        .mockResolvedValueOnce(entry)
        .mockResolvedValueOnce({ ...entry, status: 'ABORTED' });

      const result = await service.abort('e1');

      expect(prisma.outboundEmail.updateMany).toHaveBeenCalledWith({
        where: { id: 'e1', status: 'SCHEDULED' },
        data: { status: 'ABORTED', abortedAt: expect.any(Date) },
      });
      expect(result.status).toBe('ABORTED');
      expect(sender.applyEffects).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }), 'ABORTED');
    });

    it('refuses to abort an email that is no longer waiting', async () => {
      prisma.outboundEmail.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.abort('e1')).rejects.toBeInstanceOf(ConflictException);
      expect(sender.applyEffects).not.toHaveBeenCalled();
    });

    it('404s an unknown email', async () => {
      prisma.outboundEmail.findUnique.mockResolvedValue(null);

      await expect(service.abort('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('resend', () => {
    it('creates a new scheduled copy of an aborted, sent or failed email', async () => {
      for (const status of ['ABORTED', 'SENT', 'FAILED']) {
        prisma.outboundEmail.create.mockClear();
        prisma.outboundEmail.findUnique.mockResolvedValue({ ...entry, status, inboundEmailId: 'in-1' });

        await service.resend('e1');

        expect(prisma.outboundEmail.create).toHaveBeenCalledWith({
          data: {
            kind: 'INITIAL_CONFIRMATION',
            to: 'guest@example.com',
            subject: 'Confirmá tu reserva',
            html: '<p>Hola</p>',
            replyTo: 'reservas@labrisa.com.ar',
            reservationId: 'res-1',
            campaignRecipientId: null,
            inboundEmailId: 'in-1',
            resentFromId: 'e1',
            sendAt: expect.any(Date),
          },
        });
      }
    });

    it('refuses to resend an email that is still waiting or being sent', async () => {
      for (const status of ['SCHEDULED', 'SENDING']) {
        prisma.outboundEmail.findUnique.mockResolvedValue({ ...entry, status });
        await expect(service.resend('e1')).rejects.toBeInstanceOf(ConflictException);
      }
      expect(prisma.outboundEmail.create).not.toHaveBeenCalled();
    });
  });

  describe('retry', () => {
    it('claims a failed email and sends it right away', async () => {
      prisma.outboundEmail.findUnique
        .mockResolvedValueOnce({ ...entry, status: 'FAILED' })
        .mockResolvedValueOnce({ ...entry, status: 'SENDING' });

      const result = await service.retry('e1');

      expect(prisma.outboundEmail.updateMany).toHaveBeenCalledWith({
        where: { id: 'e1', status: 'FAILED' },
        data: { status: 'SENDING' },
      });
      expect(sender.send).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1', status: 'SENDING' }));
      expect(result.status).toBe('SENT');
    });

    it('refuses to retry an email that has not failed', async () => {
      prisma.outboundEmail.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.retry('e1')).rejects.toBeInstanceOf(ConflictException);
      expect(sender.send).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('filters by status and reservation, newest first, 50 per page', async () => {
      await service.list({ status: 'FAILED', reservationId: 'res-1', page: 2 });

      expect(prisma.outboundEmail.findMany).toHaveBeenCalledWith({
        where: { status: 'FAILED', reservationId: 'res-1' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 50,
      });
    });
  });
});
