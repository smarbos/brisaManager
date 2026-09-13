-- CreateIndex
CREATE UNIQUE INDEX "Reservation_source_externalReference_key" ON "Reservation"("source", "externalReference");
