-- AlterTable
ALTER TABLE "whatsapp_pending_triage" ADD COLUMN "attachmentIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
