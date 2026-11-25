-- AlterEnum
ALTER TYPE "ReservationEventType" ADD VALUE 'PAYMENT_REQUEST_SENT';
ALTER TYPE "ReservationEventType" ADD VALUE 'PAYMENT_REQUEST_FAILED';

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "askForDeposit" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "askForPayment" BOOLEAN NOT NULL DEFAULT false;

-- Until now every reservation was asked for both. Existing ones keep that, except Airbnb's: those
-- guests pay through Airbnb, so their check-in stops asking for a transfer.
UPDATE "Reservation" SET "askForPayment" = true, "askForDeposit" = true WHERE "source" <> 'AIRBNB';
