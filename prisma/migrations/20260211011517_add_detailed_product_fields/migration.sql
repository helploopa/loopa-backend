-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "images" TEXT[],
ADD COLUMN     "isFavorite" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pickupLocation" JSONB,
ADD COLUMN     "pickupWindows" JSONB,
ADD COLUMN     "primaryImage" TEXT,
ADD COLUMN     "quantityAvailable" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "tags" TEXT[];
