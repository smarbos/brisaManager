-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'AMBIENT_ALERT';

-- CreateTable
CREATE TABLE "AmbientEvent" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "sensor" TEXT NOT NULL,
    "level" INTEGER,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AmbientEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AmbientEvent_deviceId_sensor_idx" ON "AmbientEvent"("deviceId", "sensor");
