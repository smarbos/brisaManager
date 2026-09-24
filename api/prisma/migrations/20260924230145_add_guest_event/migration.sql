-- CreateEnum
CREATE TYPE "GuestEventType" AS ENUM ('NAME_CHANGED', 'PHONE_CHANGED', 'EMAIL_CHANGED', 'UNSUBSCRIBED');

-- CreateTable
CREATE TABLE "GuestEvent" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "type" "GuestEventType" NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestEvent_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "GuestEvent" ADD CONSTRAINT "GuestEvent_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
