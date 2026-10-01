import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { EmailOutboxService } from './email-outbox.service';
import { ListOutboundEmailsDto } from './dto/list-outbound-emails.dto';

// The admin's view of the outbox: every outgoing email, and the operator's actions on it —
// abort a waiting one, retry a failed one, resend (as a new waiting copy) one that's done.
@UseGuards(JwtAuthGuard)
@Controller('outbound-emails')
export class OutboundEmailsController {
  constructor(private readonly outbox: EmailOutboxService) {}

  @Get()
  list(@Query() query: ListOutboundEmailsDto) {
    return this.outbox.list(query);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.outbox.get(id);
  }

  @Post(':id/abort')
  abort(@Param('id') id: string) {
    return this.outbox.abort(id);
  }

  @Post(':id/retry')
  retry(@Param('id') id: string) {
    return this.outbox.retry(id);
  }

  @Post(':id/resend')
  resend(@Param('id') id: string) {
    return this.outbox.resend(id);
  }
}
