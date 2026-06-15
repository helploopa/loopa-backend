-- Make userId nullable on Seller to support unclaimed (orphan) businesses
ALTER TABLE "Seller" ALTER COLUMN "userId" DROP NOT NULL;
