-- AlterTable
ALTER TABLE "Settings" DROP COLUMN "confirmationPaymentPercentage",
DROP COLUMN "securityDepositPercentage",
ADD COLUMN     "confirmationPaymentValue" TEXT NOT NULL DEFAULT '30%',
ADD COLUMN     "securityDepositValue" TEXT NOT NULL DEFAULT '15%';
