-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "googleEventId" TEXT;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "googleCalendarId" TEXT,
ADD COLUMN     "googleRefreshToken" TEXT,
ADD COLUMN     "googleSyncToken" TEXT,
ADD COLUMN     "lastCalendarSyncAt" TIMESTAMP(3),
ADD COLUMN     "lastCalendarSyncError" TEXT;
