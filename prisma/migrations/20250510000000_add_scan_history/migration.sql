-- CreateTable
CREATE TABLE "ScanHistory" (
    "id" SERIAL NOT NULL,
    "imageName" TEXT NOT NULL,
    "imageTag" TEXT NOT NULL,
    "status" "ScanStatus" NOT NULL,
    "cveCount" INTEGER,
    "cveSummary" JSONB,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ScanHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScanHistory_imageName_imageTag_idx" ON "ScanHistory"("imageName", "imageTag");

-- CreateIndex
CREATE INDEX "ScanHistory_startedAt_idx" ON "ScanHistory"("startedAt");
