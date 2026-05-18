-- AlterTable: make password nullable and add googleUid for Google OAuth users
ALTER TABLE "User" ALTER COLUMN "password" DROP NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "googleUid" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_googleUid_key" ON "User"("googleUid");
