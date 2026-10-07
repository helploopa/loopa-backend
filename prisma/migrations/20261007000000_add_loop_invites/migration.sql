-- CreateTable
CREATE TABLE "LoopMember" (
    "userId" TEXT NOT NULL,
    "areaName" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "inviterId" TEXT,
    "invitedByCode" TEXT,
    "rootDropId" TEXT,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "distanceMiles" DOUBLE PRECISION,
    "withinRadius" BOOLEAN,
    "joinedLoopAt" TIMESTAMP(3),
    "rewardsEligible" BOOLEAN NOT NULL DEFAULT false,
    "rewardsId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoopMember_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "LoopDrop" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hostUserId" TEXT NOT NULL,
    "areaName" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "maxUses" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoopDrop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoopInviteCode" (
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "dropId" TEXT,
    "channel" TEXT,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "redeemedByUserId" TEXT,
    "redeemedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoopInviteCode_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE INDEX "LoopMember_inviterId_idx" ON "LoopMember"("inviterId");

-- CreateIndex
CREATE INDEX "LoopMember_rootDropId_idx" ON "LoopMember"("rootDropId");

-- CreateIndex
CREATE INDEX "LoopInviteCode_ownerId_idx" ON "LoopInviteCode"("ownerId");

-- CreateIndex
CREATE INDEX "LoopInviteCode_dropId_idx" ON "LoopInviteCode"("dropId");

-- AddForeignKey
ALTER TABLE "LoopMember" ADD CONSTRAINT "LoopMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoopInviteCode" ADD CONSTRAINT "LoopInviteCode_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoopInviteCode" ADD CONSTRAINT "LoopInviteCode_dropId_fkey" FOREIGN KEY ("dropId") REFERENCES "LoopDrop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

