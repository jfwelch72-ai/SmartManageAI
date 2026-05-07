/**
 * Task #2479 — Upload AV-scan boundary.
 *
 * Every confirmed upload MUST traverse `scanConfirmedUpload` before its
 * ACL policy is written (see `server/auditBillingStorageRoutes.ts`
 * `/api/objects/confirm`). This module provides:
 *
 *   1. A built-in EICAR-signature scanner that downloads the first 4 KiB
 *      of the object from GCS and rejects files containing the
 *      industry-standard EICAR antimalware test signature. This proves
 *      the boundary works end-to-end without any external dependency.
 *   2. A real-AV integration via Cloudmersive's hosted virus-scan API,
 *      enabled when `CLOUDMERSIVE_AV_API_KEY` is set. Cloudmersive is
 *      ClamAV-as-a-service and is the lowest-friction production scanner
 *      we can wire without standing up our own ClamAV daemon.
 *   3. A pluggable `registerUploadAvScanner(fn)` hook for swapping in
 *      ClamAV-on-host, VirusTotal, etc.
 *
 * Modes (`UPLOAD_AV_SCAN_MODE`):
 *
 *   - `permissive` (default): runs the active scanner; scanner errors
 *     are logged but the upload proceeds. Recommended for dev and the
 *     initial production rollout window.
 *   - `enforce`: runs the active scanner; scanner errors fail-closed
 *     (HTTP 422). Recommended once the production scanner has been
 *     validated in `permissive` mode.
 *   - `disabled`: no scan at all (legacy behavior). Not recommended.
 */

import { logInfo, logWarn } from "./utils/logger";
import { Storage } from "@google-cloud/storage";
import { parseObjectPath } from "./objectStorage";

// EICAR antimalware test signature. Any file whose first 4 KiB contains
// this exact string MUST be treated as infected. See
// https://www.eicar.org/download-anti-malware-testfile/. Embedded as
// base64 to keep this source file itself from looking infected to
// scanners that lint the repo.
const EICAR_SIGNATURE = Buffer.from(
  "WDVPIVAlQEFQWzRcUFpYNTQoUF4pN0NDKTd9JEVJQ0FSLVNUQU5EQVJELUFOVElWSVJVUy1URVNULUZJTEUhJEgrSCo=",
  "base64",
).toString("ascii");

export interface UploadScanContext {
  objectKey: string;
  organizationId: string | null;
  contentType?: string | null;
  sizeBytes?: number | null;
}

export interface UploadScanResult {
  status: "clean" | "skipped" | "blocked";
  reason?: string;
  scannerId?: string;
}

export type UploadAvScanFn = (ctx: UploadScanContext) => Promise<{ clean: boolean; reason?: string; scannerId?: string }>;

type ScanMode = "disabled" | "enforce" | "permissive";

let registeredScanner: UploadAvScanFn | null = null;

export function registerUploadAvScanner(fn: UploadAvScanFn | null): void {
  registeredScanner = fn;
}

function mode(): ScanMode {
  // Round-5 fix: production defaults to fail-closed (`enforce`) so the
  // boundary actually blocks malware on the customer-facing baseline.
  // Dev / test default stays `permissive` so a missing scanner doesn't
  // break local upload flows. Explicit env always wins.
  const explicit = process.env.UPLOAD_AV_SCAN_MODE?.toLowerCase();
  if (explicit === "enforce") return "enforce";
  if (explicit === "disabled") return "disabled";
  if (explicit === "permissive") return "permissive";
  return process.env.NODE_ENV === "production" ? "enforce" : "permissive";
}

/**
 * Resolve a `(bucket, object)` pair from a stored `intent.objectKey`.
 * `objectKey` is the canonical full path produced by
 * `objectStorageService.getObjectEntityUploadURL` — shape
 * `/<bucket>/<prefix>/<organizationId>/uploads/<uuid>`. We delegate to
 * `parseObjectPath` so this stays in sync with the rest of the storage
 * layer (round-3 fix: previous version used `PRIVATE_OBJECT_DIR`'s
 * bucket prefix and forgot to strip it from the object name, so every
 * lookup returned `not-found` and silently passed as clean).
 */
function resolveStorageRef(objectKey: string): { bucketName: string; objectName: string } {
  return parseObjectPath(objectKey);
}

async function readObjectHeadBytes(objectKey: string, byteCount: number): Promise<Buffer> {
  const { bucketName, objectName } = resolveStorageRef(objectKey);
  const storage = new Storage();
  const file = storage.bucket(bucketName).file(objectName);
  const [exists] = await file.exists();
  if (!exists) {
    return Buffer.alloc(0);
  }
  const stream = file.createReadStream({ start: 0, end: byteCount - 1 });
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", () => resolve());
    stream.on("error", reject);
  });
  return Buffer.concat(chunks);
}

async function readWholeObject(objectKey: string, maxBytes: number): Promise<Buffer | null> {
  const { bucketName, objectName } = resolveStorageRef(objectKey);
  const storage = new Storage();
  const file = storage.bucket(bucketName).file(objectName);
  const [meta] = await file.getMetadata();
  const size = Number(meta.size ?? 0);
  if (!size || size > maxBytes) {
    return null;
  }
  const [buf] = await file.download();
  return buf;
}

async function defaultEicarScanner(ctx: UploadScanContext): Promise<{ clean: boolean; reason?: string; scannerId?: string }> {
  const head = await readObjectHeadBytes(ctx.objectKey, 4096);
  if (head.length === 0) {
    return { clean: true, scannerId: "default-eicar:not-found" };
  }
  if (head.toString("ascii").includes(EICAR_SIGNATURE)) {
    return { clean: false, reason: "eicar_test_signature", scannerId: "default-eicar" };
  }
  return { clean: true, scannerId: "default-eicar" };
}

/**
 * Cloudmersive virus-scan integration. Streams up to
 * `CLOUDMERSIVE_AV_MAX_BYTES` (default 25 MiB) of the object to the
 * scan-file endpoint and trusts its `CleanResult` verdict. Falls back to
 * the EICAR scanner when the file is too large to ship.
 */
async function cloudmersiveScanner(ctx: UploadScanContext): Promise<{ clean: boolean; reason?: string; scannerId?: string }> {
  const apiKey = process.env.CLOUDMERSIVE_AV_API_KEY;
  if (!apiKey) {
    return defaultEicarScanner(ctx);
  }
  const maxBytes = Number(process.env.CLOUDMERSIVE_AV_MAX_BYTES || 25 * 1024 * 1024);
  const body = await readWholeObject(ctx.objectKey, maxBytes);
  if (!body) {
    // Object is missing or too large — fall through to EICAR head-check
    // so we still cover the cheap signature even on huge plan-set PDFs.
    return defaultEicarScanner(ctx);
  }
  const resp = await fetch("https://api.cloudmersive.com/virus/scan/file", {
    method: "POST",
    headers: {
      Apikey: apiKey,
      "Content-Type": "application/octet-stream",
    },
    body,
  });
  if (!resp.ok) {
    throw new Error(`cloudmersive_http_${resp.status}`);
  }
  const json = (await resp.json()) as { CleanResult?: boolean; FoundViruses?: Array<{ VirusName?: string }> };
  if (json.CleanResult === true) {
    return { clean: true, scannerId: "cloudmersive" };
  }
  const virus = json.FoundViruses?.[0]?.VirusName ?? "unknown";
  return { clean: false, reason: `cloudmersive:${virus}`, scannerId: "cloudmersive" };
}

function activeScanner(): UploadAvScanFn {
  if (registeredScanner) return registeredScanner;
  if (process.env.CLOUDMERSIVE_AV_API_KEY) return cloudmersiveScanner;
  return defaultEicarScanner;
}

export async function scanConfirmedUpload(ctx: UploadScanContext): Promise<UploadScanResult> {
  const m = mode();
  if (m === "disabled") {
    logInfo("[upload-av] scan skipped (mode=disabled)", { objectKey: ctx.objectKey });
    return { status: "skipped", reason: "mode_disabled" };
  }
  const scanner = activeScanner();
  try {
    const result = await scanner(ctx);
    if (result.clean) {
      logInfo("[upload-av] scan clean", { objectKey: ctx.objectKey, scannerId: result.scannerId });
      return { status: "clean", scannerId: result.scannerId };
    }
    logWarn("[upload-av] scan flagged file as infected", {
      objectKey: ctx.objectKey,
      reason: result.reason,
      scannerId: result.scannerId,
    });
    return { status: "blocked", reason: result.reason || "scanner_flagged", scannerId: result.scannerId };
  } catch (err) {
    if (m === "enforce") {
      logWarn("[upload-av] scanner threw in enforce mode — blocking upload", {
        objectKey: ctx.objectKey,
        error: err instanceof Error ? err.message : String(err),
      });
      return { status: "blocked", reason: "scanner_error" };
    }
    logWarn("[upload-av] scanner threw in permissive mode — allowing", {
      objectKey: ctx.objectKey,
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: "skipped", reason: "scanner_error_permissive" };
  }
}

// Exposed for unit tests — lets a test inject a fake EICAR file path
// and assert the boundary actually rejects it.
export const __testHooks = {
  EICAR_SIGNATURE,
  defaultEicarScanner,
  cloudmersiveScanner,
};
