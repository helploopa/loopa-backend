-- CreateTable
CREATE TABLE "BusinessLead" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "website" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "enrolledByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessLead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessLead_sellerId_key" ON "BusinessLead"("sellerId");

-- CreateIndex
CREATE INDEX "BusinessLead_email_idx" ON "BusinessLead"("email");

-- CreateIndex
CREATE INDEX "BusinessLead_enrolledByUserId_idx" ON "BusinessLead"("enrolledByUserId");

-- AddForeignKey
ALTER TABLE "BusinessLead" ADD CONSTRAINT "BusinessLead_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessLead" ADD CONSTRAINT "BusinessLead_enrolledByUserId_fkey" FOREIGN KEY ("enrolledByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
