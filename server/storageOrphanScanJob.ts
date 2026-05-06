import { logError, logInfo, logWarn } from "./utils/logger";
import { safeJsonParse } from "./responseHelper";
import cron from "node-cron";
import { db } from "./db";
import { media, planDocuments, receipts, bidDocuments, userPhotos, changeOrders, userCertifications } from "@shared/schema";
import { objectStorageClient } from "./objectStorage";

interface OrphanScanResult {
  scannedAt: Date;
  totalGcsObjects: number;
  orphanedObjects: string[];
  errors: string[];
}

async function getKnownObjectKeys(): Promise<Set<string>> {
  const knownKeys = new Set<string>();

  // Fetch object keys from all DB-backed file tables
  const [mediaRows, docRows, receiptRows, bidDocRows, photoRows, coRows, certRows] = await Promise.all([
    db.select({ objectKey: media.objectKey }).from(media),
    db.select({ objectKey: planDocuments.objectKey }).from(planDocuments),
    db.select({ objectKey: receipts.objectKey }).from(receipts),
    db.select({ objectKey: bidDocuments.objectKey }).from(bidDocuments),
    db.select({ objectKey: userPhotos.objectKey }).from(userPhotos),
    db.select({ id: changeOrders.id, attachmentsJson: changeOrders.attachmentsJson }).from(changeOrders),
    db.select({ fileObjectKey: userCertifications.fileObjectKey }).from(userCertifications),
  ]);

  // Standard objectKey columns
  for (const row of [...mediaRows, ...docRows, ...receiptRows, ...bidDocRows]) {
    if (row.objectKey) {
      knownKeys.add(row.objectKey);
    }
  }

  // User photos: objectKey is a relative path like "user-photos/{userId}/{file}"
  // The GCS object name is prefixPath + "/" + objectKey (e.g. "private-dir/user-photos/...")
  // We store the key both normalized and raw so we can match either form
  for (const row of photoRows) {
    if (row.objectKey) {
      knownKeys.add(row.objectKey);
    }
  }

  // User certifications: fileObjectKey is a relative path
  for (const row of certRows) {
    if (row.fileObjectKey) {
      knownKeys.add(row.fileObjectKey);
    }
  }

  // Change order attachments are stored in JSON
  for (const row of coRows) {
    if (!row.attachmentsJson) continue;
    let attachments: any[] = [];
    try {
      attachments = safeJsonParse(row.attachmentsJson, null);
    } catch (err) {
      logError("Failed to parse attachmentsJson during orphan scan:", { changeOrderId: row.id }, err instanceof Error ? err : new Error(String(err)));
    }
    for (const att of attachments) {
      if (att.objectKey) {
        knownKeys.add(att.objectKey);
      }
    }
  }

  return knownKeys;
}

/**
 * Normalize a GCS object name to the /objects/<relativePath> form used as objectKey in the DB.
 * Falls back to returning the raw name if it doesn't match the private dir prefix.
 */
function normalizeGcsName(gcsName: string, privateDirPrefix: string): string {
  if (privateDirPrefix && gcsName.startsWith(privateDirPrefix)) {
    return `/objects/${gcsName.slice(privateDirPrefix.length)}`;
  }
  return gcsName;
}

export async function runOrphanScan(): Promise<OrphanScanResult> {
  const result: OrphanScanResult = {
    scannedAt: new Date(),
    totalGcsObjects: 0,
    orphanedObjects: [],
    errors: [],
  };

  const privateDir = process.env.PRIVATE_OBJECT_DIR || "";
  if (!privateDir) {
    result.errors.push("PRIVATE_OBJECT_DIR not set — skipping orphan scan");
    return result;
  }

  const rawParts = privateDir.replace(/^\//, "").split("/");
  const bucketName = rawParts[0];
  const prefixPath = rawParts.slice(1).join("/");
  const queryPrefix = prefixPath ? `${prefixPath}/` : "";

  let knownKeys: Set<string>;
  try {
    knownKeys = await getKnownObjectKeys();
  } catch (err: any) {
    result.errors.push(`Failed to load known object keys from DB: ${err?.message}`);
    return result;
  }

  try {
    const bucket = objectStorageClient.bucket(bucketName);
    const [files] = await bucket.getFiles({ prefix: queryPrefix });

    result.totalGcsObjects = files.length;

    for (const file of files) {
      const gcsName = file.name;

      // Build the /objects/<relative> form that is stored as objectKey in the DB
      const normalizedKey = normalizeGcsName(gcsName, queryPrefix);

      // Also build the "user-photos/..." relative key used for userPhotos.objectKey
      const relativeKey = queryPrefix ? gcsName.slice(queryPrefix.length) : gcsName;

      const isKnown =
        knownKeys.has(normalizedKey) ||
        knownKeys.has(gcsName) ||
        knownKeys.has(relativeKey);

      if (!isKnown) {
        result.orphanedObjects.push(normalizedKey);
      }
    }
  } catch (err: any) {
    result.errors.push(`GCS list failed: ${err?.message}`);
  }

  return result;
}

function logScanResult(result: OrphanScanResult) {
  logInfo(
    `[OrphanScan] ${result.scannedAt.toISOString()} — ` +
      `scanned ${result.totalGcsObjects} GCS objects, ` +
      `found ${result.orphanedObjects.length} orphan(s)`
  );
  if (result.orphanedObjects.length > 0) {
    logWarn(
      "[OrphanScan] Orphaned GCS objects (no matching DB record):\n" +
        result.orphanedObjects.map((k) => `  - ${k}`).join("\n")
    );
  }
  if (result.errors.length > 0) {
    logError("[OrphanScan] Errors during scan", { errors: result.errors });
  }
}

let cronJob: cron.ScheduledTask | null = null;

export function startOrphanScanScheduler() {
  if (cronJob) return;

  cronJob = cron.schedule("0 2 * * *", async () => {
    logInfo("[OrphanScan] Nightly scan starting...");
    try {
      const result = await runOrphanScan();
      logScanResult(result);
    } catch (err) {
      logError("[OrphanScan] Unexpected error during nightly scan:", {}, err instanceof Error ? err : new Error(String(err)));
    }
  });

  logInfo("[OrphanScan] Nightly orphan scan scheduled (02:00 daily)");
}

export function stopOrphanScanScheduler() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
  }
}
