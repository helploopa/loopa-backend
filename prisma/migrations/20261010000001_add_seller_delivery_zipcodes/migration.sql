-- Zip codes a business delivers to
ALTER TABLE "Seller" ADD COLUMN "deliveryZipcodes" TEXT[] DEFAULT ARRAY[]::TEXT[];
