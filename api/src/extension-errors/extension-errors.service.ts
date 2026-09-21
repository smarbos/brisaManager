import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LogExtensionErrorDto } from './dto/log-extension-error.dto';

@Injectable()
export class ExtensionErrorsService {
  constructor(private readonly prisma: PrismaService) {}

  record(dto: LogExtensionErrorDto) {
    return this.prisma.extensionErrorLog.create({
      data: {
        source: dto.source,
        resId: dto.resId ?? null,
        operation: dto.operation,
        message: dto.message,
        detail: dto.detail ?? null,
        url: dto.url,
        extensionVersion: dto.extensionVersion ?? null,
      },
    });
  }

  listAll() {
    return this.prisma.extensionErrorLog.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }
}
