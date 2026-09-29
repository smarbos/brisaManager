-- AlterEnum
ALTER TYPE "ReservationEventType" ADD VALUE 'FIELD_CHANGED';

-- AlterTable
ALTER TABLE "ReservationEvent" ADD COLUMN "field" TEXT;
ALTER TABLE "ReservationEvent" ADD COLUMN "oldValue" TEXT;
ALTER TABLE "ReservationEvent" ADD COLUMN "newValue" TEXT;

-- AlterTable
ALTER TABLE "GuestEvent" ADD COLUMN "field" TEXT;
ALTER TABLE "GuestEvent" ADD COLUMN "oldValue" TEXT;
ALTER TABLE "GuestEvent" ADD COLUMN "newValue" TEXT;
