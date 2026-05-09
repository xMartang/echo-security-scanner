-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('PENDING', 'SCANNING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN');

-- CreateTable
CREATE TABLE "Image" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "status" "ScanStatus" NOT NULL DEFAULT 'PENDING',
    "lastScannedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Image_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Package" (
    "name" TEXT NOT NULL,
    "id" SERIAL NOT NULL,

    CONSTRAINT "Package_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cve" (
    "id" SERIAL NOT NULL,
    "cveId" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "description" TEXT,

    CONSTRAINT "Cve_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImagePackage" (
    "imageId" INTEGER NOT NULL,
    "packageId" INTEGER NOT NULL,

    CONSTRAINT "ImagePackage_pkey" PRIMARY KEY ("imageId","packageId")
);

-- CreateTable
CREATE TABLE "ImageVulnerability" (
    "imageId" INTEGER NOT NULL,
    "cveId" INTEGER NOT NULL,
    "packageId" INTEGER NOT NULL,
    "installedVersion" TEXT NOT NULL,
    "fixedVersion" TEXT,

    CONSTRAINT "ImageVulnerability_pkey" PRIMARY KEY ("imageId","cveId","packageId")
);

-- CreateIndex
CREATE INDEX "Image_status_idx" ON "Image"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Image_name_tag_key" ON "Image"("name", "tag");

-- CreateIndex
CREATE UNIQUE INDEX "Package_name_key" ON "Package"("name");

-- CreateIndex
CREATE INDEX "Package_name_idx" ON "Package"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Cve_cveId_key" ON "Cve"("cveId");

-- CreateIndex
CREATE INDEX "Cve_severity_idx" ON "Cve"("severity");

-- CreateIndex
CREATE INDEX "Cve_cveId_idx" ON "Cve"("cveId");

-- CreateIndex
CREATE INDEX "ImageVulnerability_cveId_idx" ON "ImageVulnerability"("cveId");

-- CreateIndex
CREATE INDEX "ImageVulnerability_packageId_idx" ON "ImageVulnerability"("packageId");

-- AddForeignKey
ALTER TABLE "ImagePackage" ADD CONSTRAINT "ImagePackage_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "Image"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImagePackage" ADD CONSTRAINT "ImagePackage_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImageVulnerability" ADD CONSTRAINT "ImageVulnerability_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "Image"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImageVulnerability" ADD CONSTRAINT "ImageVulnerability_cveId_fkey" FOREIGN KEY ("cveId") REFERENCES "Cve"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImageVulnerability" ADD CONSTRAINT "ImageVulnerability_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

