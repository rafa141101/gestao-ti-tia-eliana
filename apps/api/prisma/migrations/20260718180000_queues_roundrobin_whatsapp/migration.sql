-- CreateEnum
CREATE TYPE "AssignmentMode" AS ENUM ('MANUAL', 'ROUND_ROBIN');

-- AlterTable
ALTER TABLE "queues" ADD COLUMN     "assignmentMode" "AssignmentMode" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "lastAssignedUserId" TEXT;

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "contactPhone" TEXT;

-- CreateTable
CREATE TABLE "queue_members" (
    "queueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "queue_members_pkey" PRIMARY KEY ("queueId","userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "routine_executions_routineId_scheduledFor_key" ON "routine_executions"("routineId", "scheduledFor");

-- AddForeignKey
ALTER TABLE "queue_members" ADD CONSTRAINT "queue_members_queueId_fkey" FOREIGN KEY ("queueId") REFERENCES "queues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_members" ADD CONSTRAINT "queue_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

