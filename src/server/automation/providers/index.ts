import { getAutomationProviderMode } from "@/server/automation/config";
import { MockProvider } from "@/server/automation/providers/mock";
import { N8nProvider } from "@/server/automation/providers/n8n";
import type { AutomationProvider } from "@/server/automation/providers/provider";

export type { AutomationProvider };

/** Devuelve el proveedor activo según AUTOMATION_PROVIDER (mock por defecto). */
export function getAutomationProvider(): AutomationProvider {
  return getAutomationProviderMode() === "n8n"
    ? new N8nProvider()
    : new MockProvider();
}
