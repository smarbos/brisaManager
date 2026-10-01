-- CreateEnum
CREATE TYPE "WhatsappMessageKind" AS ENUM ('CHECKIN_LINK', 'RESERVATION_REMINDER', 'DEPOSIT_REMINDER');

-- AlterEnum
ALTER TYPE "ReservationEventType" ADD VALUE 'WHATSAPP_UNDELIVERED';

-- CreateTable
CREATE TABLE "WhatsappMessage" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "kind" "WhatsappMessageKind" NOT NULL,
    "twilioSid" TEXT,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappMessage_twilioSid_key" ON "WhatsappMessage"("twilioSid");

-- CreateIndex
CREATE INDEX "WhatsappMessage_reservationId_kind_createdAt_idx" ON "WhatsappMessage"("reservationId", "kind", "createdAt");

-- AddForeignKey
ALTER TABLE "WhatsappMessage" ADD CONSTRAINT "WhatsappMessage_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
