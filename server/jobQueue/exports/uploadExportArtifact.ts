// Task #2517 — Shared helper for `bulk_export` generators. Uploads a
// generated CSV/PDF/ZIP buffer (or stream) to the same Object Storage
// bucket the rest of the app uses, under a per-tenant prefix, and
// returns a short-lived signed download URL the caller can hand back
// as the job result.

import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import {
  ObjectStorageService,
  objectStorageClient,
  parseObjectPath,
} from "../../objectStorage";

export interface UploadedExportArtifact {
  url: string;
  objectKey: string;
  bytes: number;
}

export interface UploadExportArtifactInput {
  organizationId: string;
  /** File extension WITHOUT a leading dot (e.g. "csv", "pdf", "zip"). */
  extension: string;
  /** Stable filename hint shown to the downloader (e.g. "audit-log-2026-05-07"). */
  filename: string;
  contentType: string;
  body: Buffer | Readable;
  /** TTL of the returned signed URL. Default 600s (10 minutes). */
  ttlSec?: number;
}

/**
 * Persist a generated export artifact under
 * `${PRIVATE_OBJECT_DIR}/${orgId}/exports/<uuid>.<ext>` and return a
 * signed download URL. Stream input is fully consumed — callers must
 * not reuse the stream.
 */
export async function uploadExportArtifact(
  input: UploadExportArtifactInput,
): Promise<UploadedExportArtifact> {
  if (!input.organizationId) {
    throw new Error("organizationId required to upload an export artifact");
  }
  const svc = new ObjectStorageService();
  const baseDir = svc.getPrivateObjectDir().replace(/\/$/, "");
  const safeName = input.filename.replace(/[^A-Za-z0-9._-]+/g, "_");
  const key = `${baseDir}/${input.organizationId}/exports/${randomUUID()}-${safeName}.${input.extension}`;

  const { bucketName, objectName } = parseObjectPath(key);
  const file = objectStorageClient.bucket(bucketName).file(objectName);

  let bytes = 0;
  if (Buffer.isBuffer(input.body)) {
    bytes = input.body.length;
    await file.save(input.body, {
      contentType: input.contentType,
      resumable: false,
      metadata: { contentType: input.contentType },
    });
  } else {
    await new Promise<void>((resolve, reject) => {
      const ws = file.createWriteStream({
        contentType: input.contentType,
        resumable: false,
        metadata: { contentType: input.contentType },
      });
      const body = input.body as NodeJS.ReadableStream;
      body.on("data", (chunk: Buffer | string) => {
        bytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
      });
      body.on("error", reject);
      ws.on("error", reject);
      ws.on("finish", () => resolve());
      body.pipe(ws);
    });
  }

  const url = await svc.getSignedDownloadUrl(file, input.ttlSec ?? 600);
  return { url, objectKey: key, bytes };
}
