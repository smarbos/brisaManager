-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "depositReminderSentAt" TIMESTAMP(3),
ADD COLUMN     "reservationReminderSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "depositReminderDaysAfter" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "depositReminderWhatsappTemplate" TEXT NOT NULL DEFAULT 'Hola {{guestName}}, todavía no registramos el depósito de tu reserva del {{checkIn}}. {{paymentInstructions}}',
ADD COLUMN     "reservationReminderDaysBefore" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "reservationReminderWhatsappTemplate" TEXT NOT NULL DEFAULT 'Hola {{guestName}}! Te recordamos tu reserva en La Brisa de Mar del Plata del {{checkIn}} al {{checkOut}}. ¡Te esperamos!';
