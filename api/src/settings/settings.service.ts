import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

const SETTINGS_ID = 'singleton';

const DEFAULT_HOUSE_RULES =
  'No parties or events. Please keep noise to a minimum after 10pm. Maximum occupancy must be respected. No smoking indoors.';

const DEFAULT_PAYMENT_INSTRUCTIONS =
  'Bank transfer details pending setup — please contact us directly for payment instructions.';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get() {
    const settings = await this.prisma.settings.findUnique({ where: { id: SETTINGS_ID } });
    if (settings) {
      return settings;
    }

    return this.prisma.settings.create({
      data: {
        id: SETTINGS_ID,
        houseRulesText: DEFAULT_HOUSE_RULES,
        paymentInstructions: DEFAULT_PAYMENT_INSTRUCTIONS,
      },
    });
  }

  async update(dto: UpdateSettingsDto) {
    await this.get();
    return this.prisma.settings.update({
      where: { id: SETTINGS_ID },
      data: dto,
    });
  }
}
