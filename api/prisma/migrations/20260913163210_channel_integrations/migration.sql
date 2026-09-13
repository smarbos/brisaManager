-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "missingFromChannelAt" TIMESTAMP(3),
ALTER COLUMN "confirmationToken" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "airbnbIcalUrl" TEXT,
ADD COLUMN     "bookingIcalUrl" TEXT,
ADD COLUMN     "lastChannelSyncAt" TIMESTAMP(3),
ADD COLUMN     "lastChannelSyncError" TEXT;
