-- CreateTable
CREATE TABLE "ExtensionErrorLog" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "resId" TEXT,
    "operation" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "detail" TEXT,
    "url" TEXT NOT NULL,
    "extensionVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtensionErrorLog_pkey" PRIMARY KEY ("id")
);
