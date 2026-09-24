-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'GUEST_MESSAGE';

-- AlterTable
ALTER TABLE "ReservationImage" ADD COLUMN     "message" TEXT;
