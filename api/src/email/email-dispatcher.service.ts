import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { EmailSenderService } from './email-sender.service';

const BATCH_SIZE = 20;

// Sends outbox entries whose 5-minute wait is over. Each entry is claimed with a conditional
// update (SCHEDULED → SENDING) before sending, so it's sent at most once even if an operator
// aborts it at the same moment or two ticks overlap.
@Injectable()
export class EmailDispatcherService {
  private readonly logger = new Logger(EmailDispatcherService.name);
  private running = false;

  // Gap between sends — keeps a campaign burst under Resend's ~2 requests/second limit.
  // Overridden to 0 in tests.
  pacingMs = 600;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: EmailSenderService,
  ) {}

  // Off under tests (Jest sets NODE_ENV=test) unless EMAIL_DISPATCHER_ENABLED=true: e2e suites boot
  // the whole app against a shared database, and a running dispatcher would send whatever due
  // emails it finds there — rows other runs left behind, not just the suite's own.
  private enabled(): boolean {
    return process.env.NODE_ENV !== 'test' || process.env.EMAIL_DISPATCHER_ENABLED === 'true';
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async tick(): Promise<void> {
    if (this.running || !this.enabled()) {
      return;
    }
    this.running = true;
    try {
      const due = await this.prisma.outboundEmail.findMany({
        where: { status: 'SCHEDULED', sendAt: { lte: new Date() } },
        orderBy: { sendAt: 'asc' },
        take: BATCH_SIZE,
      });

      let sentAny = false;
      for (const entry of due) {
        try {
          const { count } = await this.prisma.outboundEmail.updateMany({
            where: { id: entry.id, status: 'SCHEDULED' },
            data: { status: 'SENDING' },
          });
          if (count === 0) {
            continue;
          }
          if (sentAny && this.pacingMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, this.pacingMs));
          }
          const claimed = await this.prisma.outboundEmail.findUnique({ where: { id: entry.id } });
          if (claimed) {
            await this.sender.send(claimed);
            sentAny = true;
          }
        } catch (error) {
          this.logger.error(`Dispatching email ${entry.id} failed: ${(error as Error).message}`);
        }
      }
    } catch (error) {
      this.logger.error(`Email dispatch tick failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
