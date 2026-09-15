-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ReservationEventType" ADD VALUE 'CANCELLATION_EMAIL_SENT';
ALTER TYPE "ReservationEventType" ADD VALUE 'CANCELLATION_EMAIL_FAILED';

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "cancellationEmailTemplate" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "finalEmailTemplate" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "initialEmailTemplate" TEXT NOT NULL DEFAULT '';
