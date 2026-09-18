-- Make Guest.email optional (Airbnb-sourced guests only ever have a phone) and add a
-- unique constraint on Guest.phone so it can serve as the alternate CRM key.
ALTER TABLE "Guest" ALTER COLUMN "email" DROP NOT NULL;

CREATE UNIQUE INDEX "Guest_phone_key" ON "Guest"("phone");
