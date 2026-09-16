import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

const SETTINGS_ID = 'singleton';

const DEFAULT_HOUSE_RULES =
  'No parties or events. Please keep noise to a minimum after 10pm. Maximum occupancy must be respected. No smoking indoors.';

const DEFAULT_PAYMENT_INSTRUCTIONS =
  'Bank transfer details pending setup — please contact us directly for payment instructions.';

const DEFAULT_DEPOSIT_INSTRUCTIONS =
  'El depósito de garantía se cobra al check-in y se devuelve al finalizar la estadía, una vez verificado que no haya daños.';

const DEFAULT_PROPERTY_ADDRESS = 'Dirección pendiente de configurar — completala en Configuración.';

const DEFAULT_GOOGLE_MAPS_URL = '';

// {{placeholders}} are substituted by EmailService.renderTemplate() before sending — see
// its own comment for exactly which variables each template supports.
const DEFAULT_INITIAL_EMAIL_TEMPLATE =
  'Hola {{guestName}},<br><br>Por favor confirmá tu reserva y completá unos pasos rápidos:<br><a href="{{confirmationUrl}}">{{confirmationUrl}}</a>';

const DEFAULT_FINAL_EMAIL_TEMPLATE =
  'Hola {{guestName}},<br><br>Tu reserva en La Brisa de Mar del Plata está completamente confirmada. ¡Te esperamos!<br><br>Dirección: {{propertyAddress}} — <a href="{{googleMapsUrl}}">Ver en Google Maps</a>';

const DEFAULT_CANCELLATION_EMAIL_TEMPLATE =
  'Hola {{guestName}},<br><br>Te confirmamos que tu reserva del {{checkIn}} al {{checkOut}} en La Brisa de Mar del Plata fue cancelada. Si creés que esto es un error, por favor contactanos.';

const DEFAULT_RESERVATION_REMINDER_WHATSAPP_TEMPLATE =
  'Hola {{guestName}}! Te recordamos tu reserva en La Brisa de Mar del Plata del {{checkIn}} al {{checkOut}}. ¡Te esperamos!';

const DEFAULT_DEPOSIT_REMINDER_WHATSAPP_TEMPLATE =
  'Hola {{guestName}}, todavía no registramos el depósito de tu reserva del {{checkIn}}. {{paymentInstructions}}';

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
        depositInstructions: DEFAULT_DEPOSIT_INSTRUCTIONS,
        propertyAddress: DEFAULT_PROPERTY_ADDRESS,
        googleMapsUrl: DEFAULT_GOOGLE_MAPS_URL,
        initialEmailTemplate: DEFAULT_INITIAL_EMAIL_TEMPLATE,
        finalEmailTemplate: DEFAULT_FINAL_EMAIL_TEMPLATE,
        cancellationEmailTemplate: DEFAULT_CANCELLATION_EMAIL_TEMPLATE,
        reservationReminderDaysBefore: 3,
        depositReminderDaysAfter: 3,
        reservationReminderWhatsappTemplate: DEFAULT_RESERVATION_REMINDER_WHATSAPP_TEMPLATE,
        depositReminderWhatsappTemplate: DEFAULT_DEPOSIT_REMINDER_WHATSAPP_TEMPLATE,
        bankAccountHolder: '',
        bankCuil: '',
        bankAccountNumber: '',
        bankCbu: '',
        bankAlias: '',
        bankName: '',
        securityDepositAmount: 0,
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
