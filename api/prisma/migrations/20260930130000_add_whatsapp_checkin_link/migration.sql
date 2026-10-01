-- AlterEnum
ALTER TYPE "ReservationEventType" ADD VALUE 'INITIAL_WHATSAPP_SENT';
ALTER TYPE "ReservationEventType" ADD VALUE 'INITIAL_WHATSAPP_FAILED';

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN "confirmationWhatsappSentAt" TIMESTAMP(3);
