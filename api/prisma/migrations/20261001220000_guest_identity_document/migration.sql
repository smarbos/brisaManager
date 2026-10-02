-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('DNI', 'PASAPORTE');

-- AlterEnum
ALTER TYPE "GuestEventType" ADD VALUE 'CONTACT_INFO_NOT_APPLIED';
ALTER TYPE "GuestEventType" ADD VALUE 'DOCUMENT_CHANGED';

-- AlterTable: stays are computed on read from completed reservations from now on.
ALTER TABLE "Guest" DROP COLUMN "totalStays",
DROP COLUMN "lastStayAt",
ADD COLUMN     "documentType" "DocumentType",
ADD COLUMN     "documentCountry" TEXT,
ADD COLUMN     "documentNumberEncrypted" TEXT,
ADD COLUMN     "documentHash" TEXT,
ADD COLUMN     "marketingConsentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "documentType" "DocumentType",
ADD COLUMN     "documentCountry" TEXT,
ADD COLUMN     "documentNumberEncrypted" TEXT,
ADD COLUMN     "documentHash" TEXT;

-- AlterTable
ALTER TABLE "ReservationImage" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Guest_documentHash_key" ON "Guest"("documentHash");
