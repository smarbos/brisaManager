-- AlterTable
ALTER TABLE "Settings" DROP COLUMN "securityDepositAmount",
ADD COLUMN     "confirmationPaymentPercentage" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "securityDepositPercentage" INTEGER NOT NULL DEFAULT 15;
