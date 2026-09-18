-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "triageKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "whatsapp_pending_triage" (
    "phone" TEXT NOT NULL,
    "firstMessage" TEXT NOT NULL,
    "profileName" TEXT,
    "options" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_pending_triage_pkey" PRIMARY KEY ("phone")
);

