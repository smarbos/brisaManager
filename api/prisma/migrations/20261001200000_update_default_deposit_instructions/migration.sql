-- The deposit is paid by bank transfer to the same account as the reservation payment and
-- returned by transfer 48 hours before checkout — not charged at check-in. Replaces the old
-- default text only where it was never edited, so a custom text written in Configuración stays.
UPDATE "Settings"
SET "depositInstructions" = 'El depósito de garantía se transfiere a la misma cuenta bancaria que el pago de la reserva. Te lo devolvemos por transferencia, a la cuenta desde la que lo enviaste, 48 horas antes de tu salida.'
WHERE "depositInstructions" = 'El depósito de garantía se cobra al check-in y se devuelve al finalizar la estadía, una vez verificado que no haya daños.';
