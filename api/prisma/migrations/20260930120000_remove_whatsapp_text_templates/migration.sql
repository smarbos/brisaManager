-- WhatsApp reminder wording now lives in Meta-approved Twilio templates, not Settings.
ALTER TABLE "Settings" DROP COLUMN "depositReminderWhatsappTemplate",
DROP COLUMN "reservationReminderWhatsappTemplate";
