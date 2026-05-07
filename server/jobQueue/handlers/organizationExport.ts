// Task #2530 — Register the `organization_json` bulk_export generator.
//
// This module is imported by `server/jobQueue/handlers/index.ts` and
// therefore loaded by the dedicated job worker process (`server/worker.ts`)
// at boot. Registering the generator here — rather than from
// `server/platformRoutes.ts` — guarantees the worker has the generator
// available; otherwise queued exports would fail with
// `bulk_export: no generator registered`.

import { registerExportGenerator } from "./bulkExport";
import { buildOrganizationExport } from "../../services/organizationExportBuilder";

let registered = false;

export function registerOrganizationExportGenerator(): void {
  if (registered) return;
  registered = true;
  registerExportGenerator("organization_json", async (params, ctx) => {
    const orgId = String((params as { orgId?: string }).orgId ?? "");
    if (!orgId) throw new Error("organization_json export requires `orgId`");
    const { org, exportData } = await buildOrganizationExport(orgId, ctx);
    const filename = `org-${org.slug}-export-${new Date().toISOString().split("T")[0]}.json`;
    const json = JSON.stringify(exportData);
    return { bytes: json.length, data: exportData, filename };
  });
}
