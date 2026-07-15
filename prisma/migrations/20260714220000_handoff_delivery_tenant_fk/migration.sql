-- Refuerza en PostgreSQL el mismo aislamiento por organización que aplica el
-- servicio. No modifica datos ni elimina columnas.

-- CreateIndex
CREATE UNIQUE INDEX "automation_events_organizationId_id_key"
    ON "automation_events"("organizationId", "id");

-- ReplaceForeignKey
ALTER TABLE "automation_action_deliveries"
    DROP CONSTRAINT "automation_action_deliveries_eventId_fkey";

ALTER TABLE "automation_action_deliveries"
    ADD CONSTRAINT "automation_action_deliveries_organizationId_eventId_fkey"
    FOREIGN KEY ("organizationId", "eventId")
    REFERENCES "automation_events"("organizationId", "id")
    ON DELETE CASCADE ON UPDATE CASCADE;
