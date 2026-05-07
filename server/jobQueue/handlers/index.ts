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

export { registerExportGenerator } from "./bulkExport";

export function registerAllJobHandlers(): void {
  registerAiTakeoffJob();
  registerAiDocumentJob();
  registerAiEstimatorJob();
  registerPdfTilePrerenderJob();
  registerAccountingSyncJob();
  registerBulkExportJob();
  // Generator registrations for `bulk_export` go here so the dedicated
  // worker process picks them up at boot. Adding inline registration
  // from a route module would silently break the out-of-process worker.
  registerOrganizationExportGenerator();
}
