import { Test } from '@nestjs/testing';
import { EmailDispatcherService } from './email-dispatcher.service';
import { EmailSenderService } from './email-sender.service';
import { PrismaService } from '../prisma/prisma.service';

describe('EmailDispatcherService', () => {
  let dispatcher: EmailDispatcherService;
  let prisma: { outboundEmail: { findMany: jest.Mock; updateMany: jest.Mock; findUnique: jest.Mock } };
  let sender: { send: jest.Mock };

  const due = (id: string) => ({ id, status: 'SCHEDULED' });

  beforeEach(async () => {
    prisma = {
      outboundEmail: {
        findMany: jest.fn().mockResolvedValue([due('a'), due('b')]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockImplementation(({ where }) => Promise.resolve({ id: where.id, status: 'SENDING' })),
      },
    };
    sender = { send: jest.fn().mockResolvedValue({ status: 'SENT' }) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        EmailDispatcherService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailSenderService, useValue: sender },
      ],
    }).compile();
    dispatcher = moduleRef.get(EmailDispatcherService);
    dispatcher.pacingMs = 0;
  });

  it('sends the due entries, oldest first, up to 20 per tick', async () => {
    await dispatcher.tick();

    expect(prisma.outboundEmail.findMany).toHaveBeenCalledWith({
      where: { status: 'SCHEDULED', sendAt: { lte: expect.any(Date) } },
      orderBy: { sendAt: 'asc' },
      take: 20,
    });
    expect(sender.send).toHaveBeenCalledTimes(2);
    expect(sender.send).toHaveBeenNthCalledWith(1, { id: 'a', status: 'SENDING' });
  });

  it('claims each entry before sending it', async () => {
    await dispatcher.tick();

    expect(prisma.outboundEmail.updateMany).toHaveBeenCalledWith({
      where: { id: 'a', status: 'SCHEDULED' },
      data: { status: 'SENDING' },
    });
  });

  it('skips an entry it could not claim (aborted or claimed elsewhere in the meantime)', async () => {
    prisma.outboundEmail.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });

    await dispatcher.tick();

    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(sender.send).toHaveBeenCalledWith({ id: 'b', status: 'SENDING' });
  });

  it('keeps going when one entry blows up', async () => {
    sender.send.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ status: 'SENT' });

    await expect(dispatcher.tick()).resolves.toBeUndefined();
    expect(sender.send).toHaveBeenCalledTimes(2);
  });

  it('does not start a tick while the previous one is still running', async () => {
    let release: () => void = () => {};
    sender.send.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve({ status: 'SENT' }))));

    const first = dispatcher.tick();
    await new Promise((resolve) => setImmediate(resolve));
    await dispatcher.tick();
    expect(prisma.outboundEmail.findMany).toHaveBeenCalledTimes(1);

    release();
    await first;
  });

  it('never throws, even when loading due entries fails', async () => {
    prisma.outboundEmail.findMany.mockRejectedValue(new Error('db down'));

    await expect(dispatcher.tick()).resolves.toBeUndefined();
  });
});
