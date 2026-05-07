// Task #2481 — Concrete job handlers. Imported by `server/worker.ts`
// (and by the in-process boot path when JOB_WORKER_INPROCESS=1) before
// `startJobQueue({ withWorkers: true })`.

import { registerAiTakeoffJob } from "./aiTakeoff";
import { registerAiDocumentJob } from "./aiDocument";
import { registerAiEstimatorJob } from "./aiEstimator";
import { registerPdfTilePrerenderJob } from "./pdfTilePrerender";
import { registerAccountingSyncJob } from "./accountingSync";
import { registerBulkExportJob } from "./bulkExport";

export { registerExportGenerator } from "./bulkExport";

export function registerAllJobHandlers(): void {
  registerAiTakeoffJob();
  registerAiDocumentJob();
  registerAiEstimatorJob();
  registerPdfTilePrerenderJob();
  registerAccountingSyncJob();
  registerBulkExportJob();
}
