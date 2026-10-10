-- Portal admins enroll businesses as unclaimed listings for owners to claim later
ALTER TABLE "User" ADD COLUMN "isAdmin" BOOLEAN NOT NULL DEFAULT false;
