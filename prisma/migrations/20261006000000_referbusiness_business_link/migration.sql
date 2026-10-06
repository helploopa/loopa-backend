-- AlterTable
ALTER TABLE "Referbusiness" ADD COLUMN "businessId" TEXT;

-- CreateIndex
CREATE INDEX "Referbusiness_email_idx" ON "Referbusiness"("email");
