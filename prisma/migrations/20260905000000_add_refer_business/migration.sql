-- CreateTable
CREATE TABLE "Referbusiness" (
    "id" TEXT NOT NULL,
    "referredByUserId" TEXT NOT NULL,
    "businessName" TEXT,
    "businessUrl" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "zipcode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Referbusiness_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Referbusiness_referredByUserId_idx" ON "Referbusiness"("referredByUserId");

-- AddForeignKey
ALTER TABLE "Referbusiness" ADD CONSTRAINT "Referbusiness_referredByUserId_fkey" FOREIGN KEY ("referredByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
