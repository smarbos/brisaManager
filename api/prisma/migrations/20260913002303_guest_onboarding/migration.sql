-- CreateEnum
CREATE TYPE "ReservationEventType" AS ENUM ('DATES_CONFIRMED', 'CONTRACT_ACCEPTED', 'PAYMENT_RECEIVED', 'DEPOSIT_RECEIVED', 'DEPOSIT_RETURNED', 'RESERVATION_CONFIRMED', 'INITIAL_EMAIL_SENT', 'INITIAL_EMAIL_FAILED', 'FINAL_EMAIL_SENT', 'FINAL_EMAIL_FAILED');

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN "confirmationToken" TEXT NOT NULL DEFAULT (gen_random_uuid()::text),
ADD COLUMN "datesConfirmedAt" TIMESTAMP(3),
ADD COLUMN "contractAcceptedAt" TIMESTAMP(3),
ADD COLUMN "contractAcceptedName" TEXT,
ADD COLUMN "contractSnapshot" TEXT,
ADD COLUMN "confirmationPaymentReceivedAt" TIMESTAMP(3),
ADD COLUMN "depositReceivedAt" TIMESTAMP(3),
ADD COLUMN "depositReturnedAt" TIMESTAMP(3),
ADD COLUMN "confirmationEmailSentAt" TIMESTAMP(3),
ADD COLUMN "finalConfirmationEmailSentAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_confirmationToken_key" ON "Reservation"("confirmationToken");

-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL,
    "houseRulesText" TEXT NOT NULL,
    "paymentInstructions" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationEvent" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "type" "ReservationEventType" NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReservationEvent_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ReservationEvent" ADD CONSTRAINT "ReservationEvent_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
