-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "bankAccountHolder" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "bankAccountNumber" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "bankAlias" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "bankCbu" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "bankCuil" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "bankName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "securityDepositAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;
