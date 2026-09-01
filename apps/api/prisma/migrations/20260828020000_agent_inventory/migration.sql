-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "agentVersion" TEXT,
ADD COLUMN     "discoveredByAgent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "asset_softwares" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT,
    "publisher" TEXT,
    "installedAt" TIMESTAMP(3),
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_softwares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "network_discoveries" (
    "id" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "mac" TEXT,
    "hostname" TEXT,
    "vendor" TEXT,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ignored" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,

    CONSTRAINT "network_discoveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "asset_softwares_assetId_idx" ON "asset_softwares"("assetId");

-- CreateIndex
CREATE INDEX "asset_softwares_name_idx" ON "asset_softwares"("name");

-- CreateIndex
CREATE UNIQUE INDEX "asset_softwares_assetId_name_version_key" ON "asset_softwares"("assetId", "name", "version");

-- CreateIndex
CREATE INDEX "network_discoveries_lastSeen_idx" ON "network_discoveries"("lastSeen");

-- CreateIndex
CREATE UNIQUE INDEX "network_discoveries_ip_mac_key" ON "network_discoveries"("ip", "mac");

-- CreateIndex
CREATE INDEX "assets_hostname_idx" ON "assets"("hostname");

-- CreateIndex
CREATE INDEX "assets_lastSeenAt_idx" ON "assets"("lastSeenAt");

-- AddForeignKey
ALTER TABLE "asset_softwares" ADD CONSTRAINT "asset_softwares_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

