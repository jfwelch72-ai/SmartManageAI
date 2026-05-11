// Task #2481 — Concrete job handlers. Imported by `server/worker.ts`
// (and by the in-process boot path when JOB_WORKER_INPROCESS=1) before
// `startJobQueue({ withWorkers: true })`.

import { registerAiTakeoffJob } from "./aiTakeoff";
import { registerAiDocumentJob } from "./aiDocument";
import { registerAiEstimatorJob } from "./aiEstimator";
import { registerPdfTilePrerenderJob } from "./pdfTilePrerender";
import { registerAccountingSyncJob } from "./accountingSync";
import { registerBulkExportJob } from "./bulkExport";
import { registerOrganizationExportGenerator } from "./organizationExport";
import { registerGatedTileRenderer } from "./tileRendererStub";
import { registerPlanSetIngestJob } from "./planSetIngest";
// Task #2517 — Side-effect imports register concrete `bulk_export`
// generators for the audit, change-orders, and payroll surfaces.
import "../exports/auditExport";
import "../exports/changeOrderBulkPdf";
import "../exports/payrollAcknowledgement";

export { registerExportGenerator } from "./bulkExport";

export function registerAllJobHandlers(): void {
  registerAiTakeoffJob();
  registerAiDocumentJob();
  registerAiEstimatorJob();
  registerPdfTilePrerenderJob();
  registerAccountingSyncJob();
  registerBulkExportJob();
  registerPlanSetIngestJob();
  // Generator registrations for `bulk_export` go here so the dedicated
  // worker process picks them up at boot. Adding inline registration
  // from a route module would silently break the out-of-process worker.
  registerOrganizationExportGenerator();
  // Task #2757 — Register the gated renderer. When the TILE_RENDERING_ENABLED
  // feature flag is OFF (the default), jobs are never dispatched so this
  // handler is a safety-net for any legacy queue items. When a real
  // renderer ships, replace this with the real implementation and flip
  // the flag ON.
  registerGatedTileRenderer();
}
