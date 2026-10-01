-- CreateEnum
CREATE TYPE "OutboundEmailKind" AS ENUM ('INITIAL_CONFIRMATION', 'FINAL_CONFIRMATION', 'CANCELLATION', 'MARKETING', 'ALERT', 'INBOUND_FORWARD');

-- CreateEnum
CREATE TYPE "OutboundEmailStatus" AS ENUM ('SCHEDULED', 'SENDING', 'SENT', 'FAILED', 'ABORTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CampaignRecipientStatus" ADD VALUE 'SCHEDULED';
ALTER TYPE "CampaignRecipientStatus" ADD VALUE 'ABORTED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ReservationEventType" ADD VALUE 'INITIAL_EMAIL_QUEUED';
ALTER TYPE "ReservationEventType" ADD VALUE 'FINAL_EMAIL_QUEUED';
ALTER TYPE "ReservationEventType" ADD VALUE 'CANCELLATION_EMAIL_QUEUED';
ALTER TYPE "ReservationEventType" ADD VALUE 'INITIAL_EMAIL_ABORTED';
ALTER TYPE "ReservationEventType" ADD VALUE 'FINAL_EMAIL_ABORTED';
ALTER TYPE "ReservationEventType" ADD VALUE 'CANCELLATION_EMAIL_ABORTED';

-- CreateTable
CREATE TABLE "OutboundEmail" (
    "id" TEXT NOT NULL,
    "kind" "OutboundEmailKind" NOT NULL,
    "status" "OutboundEmailStatus" NOT NULL DEFAULT 'SCHEDULED',
    "to" TEXT NOT NULL,
    "sentTo" TEXT,
    "subject" TEXT NOT NULL,
    "html" TEXT NOT NULL DEFAULT '',
    "replyTo" TEXT,
    "inboundEmailId" TEXT,
    "sendAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "abortedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "resendId" TEXT,
    "reservationId" TEXT,
    "campaignRecipientId" TEXT,
    "resentFromId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboundEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OutboundEmail_campaignRecipientId_key" ON "OutboundEmail"("campaignRecipientId");

-- CreateIndex
CREATE INDEX "OutboundEmail_status_sendAt_idx" ON "OutboundEmail"("status", "sendAt");

-- CreateIndex
CREATE INDEX "OutboundEmail_reservationId_idx" ON "OutboundEmail"("reservationId");

-- CreateIndex
CREATE INDEX "OutboundEmail_inboundEmailId_idx" ON "OutboundEmail"("inboundEmailId");

-- AddForeignKey
ALTER TABLE "OutboundEmail" ADD CONSTRAINT "OutboundEmail_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundEmail" ADD CONSTRAINT "OutboundEmail_campaignRecipientId_fkey" FOREIGN KEY ("campaignRecipientId") REFERENCES "CampaignRecipient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

