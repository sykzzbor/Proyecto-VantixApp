-- Optimistic concurrency for organization-scoped automation rules.
ALTER TABLE "organization_automation_rules"
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
