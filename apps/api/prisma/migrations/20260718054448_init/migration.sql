-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'GESTOR_TI', 'TECNICO', 'SOLICITANTE', 'GESTOR_SETOR', 'AUDITOR', 'INVENTARIANTE');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('NOVO', 'TRIAGEM', 'ATRIBUIDO', 'EM_ATENDIMENTO', 'AGUARDANDO_SOLICITANTE', 'AGUARDANDO_TERCEIRO', 'AGUARDANDO_APROVACAO', 'AGENDADO', 'PAUSADO_DEPENDENCIA', 'RESOLVIDO', 'FECHADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('P1', 'P2', 'P3', 'P4');

-- CreateEnum
CREATE TYPE "Impact" AS ENUM ('UMA_PESSOA', 'ALGUMAS_PESSOAS', 'UM_SETOR', 'UMA_UNIDADE', 'VARIAS_UNIDADES', 'TODA_EMPRESA');

-- CreateEnum
CREATE TYPE "Urgency" AS ENUM ('EXISTE_ALTERNATIVA', 'PARCIALMENTE_PREJUDICADA', 'ATIVIDADE_BLOQUEADA', 'OPERACAO_PARADA', 'RISCO_IMEDIATO');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('PORTAL', 'WHATSAPP', 'EMAIL', 'TELEFONE', 'PRESENCIAL', 'SISTEMA', 'QR_CODE', 'MONITORAMENTO', 'TECNICO');

-- CreateEnum
CREATE TYPE "WorklogType" AS ENUM ('ATENDIMENTO_REMOTO', 'ATENDIMENTO_PRESENCIAL', 'DIAGNOSTICO', 'MANUTENCAO', 'CONFIGURACAO', 'DESENVOLVIMENTO', 'ANALISE', 'REUNIAO', 'DESLOCAMENTO', 'CONTATO_TERCEIRO', 'DOCUMENTACAO', 'TREINAMENTO', 'TESTE', 'ACOMPANHAMENTO');

-- CreateEnum
CREATE TYPE "TicketEventType" AS ENUM ('CRIACAO', 'STATUS', 'PRIORIDADE', 'ATRIBUICAO', 'FILA', 'PRIMEIRA_RESPOSTA', 'RESOLUCAO', 'REABERTURA', 'FECHAMENTO', 'CANCELAMENTO', 'VINCULO', 'SLA', 'INTERRUPCAO', 'EDICAO');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('PROPOSTO', 'EM_ANALISE', 'APROVADO', 'PLANEJADO', 'EM_EXECUCAO', 'EM_HOMOLOGACAO', 'BLOQUEADO', 'CONCLUIDO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('A_FAZER', 'EM_ANDAMENTO', 'BLOQUEADA', 'CONCLUIDA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "RoutineFrequency" AS ENUM ('DIARIA', 'SEMANAL', 'QUINZENAL', 'MENSAL', 'TRIMESTRAL', 'ANUAL', 'PERSONALIZADA');

-- CreateEnum
CREATE TYPE "RoutineExecStatus" AS ENUM ('PENDENTE', 'EM_EXECUCAO', 'CONCLUIDA', 'ATRASADA', 'PULADA');

-- CreateEnum
CREATE TYPE "Criticality" AS ENUM ('BAIXA', 'MEDIA', 'ALTA');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('EM_USO', 'DISPONIVEL', 'RESERVA', 'EMPRESTADO', 'EM_MANUTENCAO', 'AGUARDANDO_PECA', 'EM_TRANSFERENCIA', 'AGUARDANDO_DESCARTE', 'DESCARTADO', 'EXTRAVIADO', 'INATIVO');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('ATIVO_INDIVIDUAL', 'COMPONENTE', 'CONSUMIVEL', 'KIT');

-- CreateEnum
CREATE TYPE "ComponentStatus" AS ENUM ('INSTALADO', 'REMOVIDO', 'ESTOQUE', 'DESCARTADO');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('TRANSFERENCIA_UNIDADE', 'TRANSFERENCIA_SETOR', 'TROCA_USUARIO', 'ENVIO_MANUTENCAO', 'RETORNO_MANUTENCAO', 'EMPRESTIMO', 'DEVOLUCAO', 'ENVIO_DESCARTE', 'RETIRADA_RESERVA', 'RETORNO_RESERVA');

-- CreateEnum
CREATE TYPE "MovementStatus" AS ENUM ('SOLICITADA', 'SEPARADA', 'RETIRADA', 'EM_TRANSPORTE', 'RECEBIDA', 'CONFIRMADA', 'CANCELADA', 'RETORNADA');

-- CreateEnum
CREATE TYPE "MaintenanceType" AS ENUM ('PREVENTIVA', 'CORRETIVA', 'LIMPEZA', 'INSPECAO', 'ATUALIZACAO', 'SUBSTITUICAO', 'CONFIGURACAO', 'REVISAO', 'TESTE', 'INSTALACAO');

-- CreateEnum
CREATE TYPE "SlaMode" AS ENUM ('CORRIDO', 'COMERCIAL');

-- CreateEnum
CREATE TYPE "TicketRelationType" AS ENUM ('RELACIONADO', 'PAI', 'FILHO', 'DUPLICADO');

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tradeName" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "unitId" TEXT,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'SOLICITANTE',
    "phone" TEXT,
    "unitId" TEXT,
    "departmentId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isProtected" BOOLEAN NOT NULL DEFAULT false,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queues" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "queues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "defaultQueueId" TEXT,
    "defaultPriority" "Priority",
    "slaPolicyId" TEXT,
    "formSchema" JSONB,
    "responseTemplate" TEXT,
    "checklist" JSONB,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subcategories" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "subcategories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_policies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" "SlaMode" NOT NULL DEFAULT 'COMERCIAL',
    "businessStart" TEXT NOT NULL DEFAULT '08:00',
    "businessEnd" TEXT NOT NULL DEFAULT '18:00',
    "workdays" TEXT NOT NULL DEFAULT '1,2,3,4,5',
    "firstResponseP1" INTEGER NOT NULL DEFAULT 10,
    "firstResponseP2" INTEGER NOT NULL DEFAULT 30,
    "firstResponseP3" INTEGER NOT NULL DEFAULT 240,
    "firstResponseP4" INTEGER NOT NULL DEFAULT 600,
    "resolutionP1" INTEGER NOT NULL DEFAULT 240,
    "resolutionP2" INTEGER NOT NULL DEFAULT 480,
    "resolutionP3" INTEGER NOT NULL DEFAULT 2400,
    "resolutionP4" INTEGER NOT NULL DEFAULT 12000,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sla_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "unitId" TEXT,
    "departmentId" TEXT,
    "categoryId" TEXT NOT NULL,
    "subcategoryId" TEXT,
    "channel" "Channel" NOT NULL DEFAULT 'PORTAL',
    "impact" "Impact" NOT NULL,
    "urgency" "Urgency" NOT NULL,
    "calculatedPriority" "Priority" NOT NULL,
    "priority" "Priority" NOT NULL,
    "priorityJustification" TEXT,
    "assigneeId" TEXT,
    "queueId" TEXT,
    "assetId" TEXT,
    "projectId" TEXT,
    "thirdPartyId" TEXT,
    "externalTicketNumber" TEXT,
    "vendorForecastAt" TIMESTAMP(3),
    "vendorLastReplyAt" TIMESTAMP(3),
    "status" "TicketStatus" NOT NULL DEFAULT 'NOVO',
    "formResponses" JSONB,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "infoOwnerArea" TEXT,
    "approverId" TEXT,
    "slaPolicyId" TEXT,
    "firstResponseDueAt" TIMESTAMP(3),
    "resolutionDueAt" TIMESTAMP(3),
    "slaPausedAt" TIMESTAMP(3),
    "slaPausedMinutes" INTEGER NOT NULL DEFAULT 0,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "triagedAt" TIMESTAMP(3),
    "assignedAt" TIMESTAMP(3),
    "firstResponseAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "scheduledFor" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "reopenedCount" INTEGER NOT NULL DEFAULT 0,
    "resolutionNotes" TEXT,
    "cancelReason" TEXT,
    "nextStep" TEXT,
    "returnForecast" TIMESTAMP(3),
    "rating" INTEGER,
    "ratingComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_events" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "userId" TEXT,
    "type" "TicketEventType" NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "comment" TEXT,
    "justification" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_comments" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_watchers" (
    "ticketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "ticket_watchers_pkey" PRIMARY KEY ("ticketId","userId")
);

-- CreateTable
CREATE TABLE "ticket_relations" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "relatedTicketId" TEXT NOT NULL,
    "relation" "TicketRelationType" NOT NULL DEFAULT 'RELACIONADO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_relations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_worklogs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "WorklogType" NOT NULL,
    "ticketId" TEXT,
    "taskId" TEXT,
    "routineExecutionId" TEXT,
    "maintenanceId" TEXT,
    "description" TEXT,
    "result" TEXT,
    "nextStep" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "durationMinutes" INTEGER,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "editJustification" TEXT,
    "editedById" TEXT,
    "editedAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_worklogs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "ticketId" TEXT,
    "commentId" TEXT,
    "taskId" TEXT,
    "assetId" TEXT,
    "maintenanceId" TEXT,
    "movementId" TEXT,
    "routineExecutionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "third_parties" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "serviceType" TEXT,
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "contract" TEXT,
    "slaInfo" TEXT,
    "serviceHours" TEXT,
    "systems" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "third_parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objective" TEXT,
    "justification" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'PROPOSTO',
    "priority" "Priority" NOT NULL DEFAULT 'P4',
    "requesterId" TEXT,
    "sponsorId" TEXT,
    "ownerId" TEXT,
    "startDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "percentComplete" INTEGER NOT NULL DEFAULT 0,
    "estimatedHours" DOUBLE PRECISION,
    "blocks" TEXT,
    "risks" TEXT,
    "dependencies" TEXT,
    "infoOwnerArea" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_members" (
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleInProject" TEXT,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("projectId","userId")
);

-- CreateTable
CREATE TABLE "project_tasks" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'A_FAZER',
    "assigneeId" TEXT,
    "dueDate" TIMESTAMP(3),
    "estimatedHours" DOUBLE PRECISION,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routines" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "frequency" "RoutineFrequency" NOT NULL,
    "intervalDays" INTEGER,
    "assigneeId" TEXT NOT NULL,
    "substituteId" TEXT,
    "unitId" TEXT,
    "departmentId" TEXT,
    "checklist" JSONB,
    "requiresEvidence" BOOLEAN NOT NULL DEFAULT false,
    "estimatedMinutes" INTEGER,
    "criticality" "Criticality" NOT NULL DEFAULT 'MEDIA',
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "toleranceHours" INTEGER NOT NULL DEFAULT 24,
    "instructions" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routine_executions" (
    "id" TEXT NOT NULL,
    "routineId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" "RoutineExecStatus" NOT NULL DEFAULT 'PENDENTE',
    "executedById" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "checklistResults" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "routine_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "asset_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "patrimonyCode" TEXT,
    "categoryId" TEXT NOT NULL,
    "family" TEXT,
    "kind" "AssetKind" NOT NULL DEFAULT 'ATIVO_INDIVIDUAL',
    "description" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "unitId" TEXT,
    "departmentId" TEXT,
    "location" TEXT,
    "userId" TEXT,
    "custodianId" TEXT,
    "status" "AssetStatus" NOT NULL DEFAULT 'DISPONIVEL',
    "criticality" "Criticality" NOT NULL DEFAULT 'MEDIA',
    "purchaseDate" TIMESTAMP(3),
    "purchaseValue" DECIMAL(12,2),
    "supplierId" TEXT,
    "invoiceNumber" TEXT,
    "warrantyStart" TIMESTAMP(3),
    "warrantyEnd" TIMESTAMP(3),
    "ip" TEXT,
    "mac" TEXT,
    "os" TEXT,
    "hostname" TEXT,
    "specs" JSONB,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "minStock" INTEGER,
    "nextMaintenanceAt" TIMESTAMP(3),
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_components" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "capacity" TEXT,
    "installedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "warrantyEnd" TIMESTAMP(3),
    "supplier" TEXT,
    "cost" DECIMAL(12,2),
    "status" "ComponentStatus" NOT NULL DEFAULT 'INSTALADO',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_movements" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "type" "MovementType" NOT NULL,
    "status" "MovementStatus" NOT NULL DEFAULT 'SOLICITADA',
    "fromUnitId" TEXT,
    "toUnitId" TEXT,
    "fromDepartmentId" TEXT,
    "toDepartmentId" TEXT,
    "fromUserId" TEXT,
    "toUserId" TEXT,
    "requestedById" TEXT NOT NULL,
    "sentById" TEXT,
    "receivedById" TEXT,
    "reason" TEXT,
    "notes" TEXT,
    "equipmentCondition" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_records" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "ticketId" TEXT,
    "type" "MaintenanceType" NOT NULL,
    "description" TEXT NOT NULL,
    "diagnosis" TEXT,
    "serviceDone" TEXT,
    "responsibleId" TEXT,
    "thirdPartyId" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationMinutes" INTEGER,
    "partsUsed" TEXT,
    "cost" DECIMAL(12,2),
    "result" TEXT,
    "operational" BOOLEAN,
    "nextMaintenanceAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "entity" TEXT,
    "entityId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "justification" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "origin" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "counters" (
    "scope" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "counters_pkey" PRIMARY KEY ("scope","year")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_number_key" ON "tickets"("number");

-- CreateIndex
CREATE INDEX "tickets_status_idx" ON "tickets"("status");

-- CreateIndex
CREATE INDEX "tickets_assigneeId_idx" ON "tickets"("assigneeId");

-- CreateIndex
CREATE INDEX "tickets_requesterId_idx" ON "tickets"("requesterId");

-- CreateIndex
CREATE INDEX "tickets_categoryId_idx" ON "tickets"("categoryId");

-- CreateIndex
CREATE INDEX "tickets_unitId_idx" ON "tickets"("unitId");

-- CreateIndex
CREATE INDEX "tickets_priority_idx" ON "tickets"("priority");

-- CreateIndex
CREATE INDEX "tickets_openedAt_idx" ON "tickets"("openedAt");

-- CreateIndex
CREATE INDEX "ticket_events_ticketId_createdAt_idx" ON "ticket_events"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "ticket_comments_ticketId_createdAt_idx" ON "ticket_comments"("ticketId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_relations_ticketId_relatedTicketId_relation_key" ON "ticket_relations"("ticketId", "relatedTicketId", "relation");

-- CreateIndex
CREATE INDEX "ticket_worklogs_userId_startedAt_idx" ON "ticket_worklogs"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "ticket_worklogs_ticketId_idx" ON "ticket_worklogs"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_storedName_key" ON "attachments"("storedName");

-- CreateIndex
CREATE INDEX "project_tasks_projectId_status_idx" ON "project_tasks"("projectId", "status");

-- CreateIndex
CREATE INDEX "routine_executions_routineId_scheduledFor_idx" ON "routine_executions"("routineId", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "assets_code_key" ON "assets"("code");

-- CreateIndex
CREATE UNIQUE INDEX "assets_publicId_key" ON "assets"("publicId");

-- CreateIndex
CREATE INDEX "assets_status_idx" ON "assets"("status");

-- CreateIndex
CREATE INDEX "assets_unitId_idx" ON "assets"("unitId");

-- CreateIndex
CREATE INDEX "assets_categoryId_idx" ON "assets"("categoryId");

-- CreateIndex
CREATE INDEX "asset_components_assetId_idx" ON "asset_components"("assetId");

-- CreateIndex
CREATE INDEX "asset_movements_assetId_createdAt_idx" ON "asset_movements"("assetId", "createdAt");

-- CreateIndex
CREATE INDEX "maintenance_records_assetId_date_idx" ON "maintenance_records"("assetId", "date");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entityId_idx" ON "audit_logs"("entity", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_slaPolicyId_fkey" FOREIGN KEY ("slaPolicyId") REFERENCES "sla_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcategories" ADD CONSTRAINT "subcategories_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_subcategoryId_fkey" FOREIGN KEY ("subcategoryId") REFERENCES "subcategories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_queueId_fkey" FOREIGN KEY ("queueId") REFERENCES "queues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_thirdPartyId_fkey" FOREIGN KEY ("thirdPartyId") REFERENCES "third_parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_slaPolicyId_fkey" FOREIGN KEY ("slaPolicyId") REFERENCES "sla_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_watchers" ADD CONSTRAINT "ticket_watchers_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_watchers" ADD CONSTRAINT "ticket_watchers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_relations" ADD CONSTRAINT "ticket_relations_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_relations" ADD CONSTRAINT "ticket_relations_relatedTicketId_fkey" FOREIGN KEY ("relatedTicketId") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_worklogs" ADD CONSTRAINT "ticket_worklogs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_worklogs" ADD CONSTRAINT "ticket_worklogs_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_worklogs" ADD CONSTRAINT "ticket_worklogs_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "project_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_worklogs" ADD CONSTRAINT "ticket_worklogs_routineExecutionId_fkey" FOREIGN KEY ("routineExecutionId") REFERENCES "routine_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_worklogs" ADD CONSTRAINT "ticket_worklogs_maintenanceId_fkey" FOREIGN KEY ("maintenanceId") REFERENCES "maintenance_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_worklogs" ADD CONSTRAINT "ticket_worklogs_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "ticket_comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "project_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_maintenanceId_fkey" FOREIGN KEY ("maintenanceId") REFERENCES "maintenance_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "asset_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_routineExecutionId_fkey" FOREIGN KEY ("routineExecutionId") REFERENCES "routine_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_sponsorId_fkey" FOREIGN KEY ("sponsorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routines" ADD CONSTRAINT "routines_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routines" ADD CONSTRAINT "routines_substituteId_fkey" FOREIGN KEY ("substituteId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routines" ADD CONSTRAINT "routines_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routines" ADD CONSTRAINT "routines_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routine_executions" ADD CONSTRAINT "routine_executions_routineId_fkey" FOREIGN KEY ("routineId") REFERENCES "routines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routine_executions" ADD CONSTRAINT "routine_executions_executedById_fkey" FOREIGN KEY ("executedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "asset_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_custodianId_fkey" FOREIGN KEY ("custodianId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "third_parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_components" ADD CONSTRAINT "asset_components_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_fromUnitId_fkey" FOREIGN KEY ("fromUnitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_toUnitId_fkey" FOREIGN KEY ("toUnitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_fromDepartmentId_fkey" FOREIGN KEY ("fromDepartmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_toDepartmentId_fkey" FOREIGN KEY ("toDepartmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_thirdPartyId_fkey" FOREIGN KEY ("thirdPartyId") REFERENCES "third_parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
