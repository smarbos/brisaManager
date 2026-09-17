-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "airbnbMessageTemplate" TEXT NOT NULL DEFAULT '¡Hola {{guestName}}! Para completar el check-in, por favor completá estos pasos rápidos: {{confirmationUrl}}';
