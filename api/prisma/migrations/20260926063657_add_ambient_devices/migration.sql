-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'DEVICE_OFFLINE';

-- CreateTable
CREATE TABLE "AmbientDevice" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmbientDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmbientDeviceReading" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "sensor" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmbientDeviceReading_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AmbientDeviceReading_deviceId_sensor_key" ON "AmbientDeviceReading"("deviceId", "sensor");

-- AddForeignKey
ALTER TABLE "AmbientDeviceReading" ADD CONSTRAINT "AmbientDeviceReading_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "AmbientDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
