/*
  Warnings:

  - You are about to drop the column `image` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `Product` table. All the data in the column will be lost.
  - Added the required column `title` to the `Product` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Product" DROP COLUMN "image",
DROP COLUMN "name",
ADD COLUMN     "badges" TEXT[],
ADD COLUMN     "category" TEXT,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "quantityLeft" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "title" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Seller" ADD COLUMN     "pickupDays" TEXT,
ADD COLUMN     "pickupEndTime" TEXT,
ADD COLUMN     "pickupStartTime" TEXT;
