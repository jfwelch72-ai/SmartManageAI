import { logError } from "./utils/logger";
import { Storage, File } from "@google-cloud/storage";
import { Response } from "express";
import { randomUUID } from "crypto";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "./objectAcl";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  constructor() {}

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0)
      )
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          "tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths)."
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<File | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;

      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    }

    return null;
  }

  async downloadObject(file: File, res: Response, cacheTtlSec: number = 3600) {
    try {
      const [metadata] = await file.getMetadata();
      const aclPolicy = await getObjectAclPolicy(file);
      const isPublic = aclPolicy?.visibility === "public";
      const totalSize = metadata.size != null ? Number(metadata.size) : NaN;
      const contentType = metadata.contentType || "application/octet-stream";
      const cacheControl = `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`;

      // Task #2405 — HTTP Range support so 25 GB takeoff PDFs stream
      // through pdfjs's range loader without us forcing a full
      // re-download for each byte window. We always advertise
      // Accept-Ranges: bytes; if the request includes a satisfiable
      // single-range header we reply 206 with Content-Range and pipe
      // only the requested slice.
      const rangeHeader = res.req?.headers?.range;
      const parsedRange = parseSingleByteRange(rangeHeader, totalSize);

      if (parsedRange) {
        const { start, end } = parsedRange;
        res.status(206);
        res.set({
          "Content-Type": contentType,
          "Content-Length": String(end - start + 1),
          "Content-Range": `bytes ${start}-${end}/${totalSize}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": cacheControl,
        });
        const stream = file.createReadStream({ start, end });
        stream.on("error", (err: Error) => {
          logError("Stream error:", {}, err instanceof Error ? err : new Error(String(err)));
          if (!res.headersSent) {
            res.status(500).json({ error: "Failed to stream file" });
          } else {
            try { res.destroy(err); } catch { /* noop */ }
          }
        });
        stream.pipe(res);
        return;
      }

      // Reject malformed/unsatisfiable range requests with 416 so
      // pdfjs (and other range-aware clients) fall back cleanly
      // instead of receiving the whole file under a 200.
      if (rangeHeader && Number.isFinite(totalSize)) {
        res.status(416);
        res.set({
          "Content-Range": `bytes */${totalSize}`,
          "Accept-Ranges": "bytes",
        });
        res.end();
        return;
      }

      res.set({
        "Content-Type": contentType,
        "Content-Length": metadata.size,
        "Accept-Ranges": "bytes",
        "Cache-Control": cacheControl,
      });

      const stream = file.createReadStream();

      stream.on("error", (err: Error) => {
        logError("Stream error:", {}, err instanceof Error ? err : new Error(String(err)));
        if (!res.headersSent) {
          res.status(500).json({ error: "Failed to stream file" });
        }
      });

      stream.pipe(res);
    } catch (error) {
      logError("Error downloading file:", {}, error instanceof Error ? error : new Error(String(error)));
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to download file" });
      }
    }
  }

  async getObjectEntityUploadURL(organizationId: string): Promise<{ uploadURL: string; objectKey: string }> {
    if (!organizationId) {
      throw new Error("organizationId is required for file uploads");
    }
    
    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }

    const objectId = randomUUID();
    // Include organizationId in path for organization-level isolation
    const fullPath = `${privateObjectDir}/${organizationId}/uploads/${objectId}`;

    const { bucketName, objectName } = parseObjectPath(fullPath);

    const uploadURL = await signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
    });

    return { uploadURL, objectKey: fullPath };
  }

  async initiateResumableUpload(organizationId: string, contentType: string): Promise<{ resumableUri: string; objectKey: string }> {
    if (!organizationId) {
      throw new Error("organizationId is required for file uploads");
    }

    const privateObjectDir = this.getPrivateObjectDir();
    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/${organizationId}/uploads/${objectId}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);

    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);

    const [resumableUri] = await file.createResumableUpload({
      metadata: { contentType },
    });

    return { resumableUri, objectKey: fullPath };
  }

  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join("/");
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith("/")) {
      objectEntityDir = `${objectEntityDir}/`;
    }

    if (rawPath.startsWith("https://storage.googleapis.com/")) {
      const url = new URL(rawPath);
      const rawObjectPath = url.pathname;
      if (!rawObjectPath.startsWith(objectEntityDir)) {
        return rawObjectPath;
      }
      const entityId = rawObjectPath.slice(objectEntityDir.length);
      return `/objects/${entityId}`;
    }

    if (rawPath.startsWith(objectEntityDir)) {
      const entityId = rawPath.slice(objectEntityDir.length);
      return `/objects/${entityId}`;
    }

    return rawPath;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy
  ): Promise<string> {
    // SECURITY: Reject ACL policies without organizationId to ensure all new files are org-isolated
    if (!aclPolicy.organizationId) {
      throw new Error("organizationId is required in ACL policy for organization-level file isolation");
    }
    
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  /**
   * Set ACL policy directly using a raw bucket-prefixed object key (e.g. /bucket/org/uploads/uuid).
   * Used by the confirm endpoint which stores the raw objectKey in upload_intents.
   */
  async setAclPolicyForObjectKey(
    objectKey: string,
    aclPolicy: ObjectAclPolicy
  ): Promise<void> {
    if (!aclPolicy.organizationId) {
      throw new Error("organizationId is required in ACL policy");
    }
    const { bucketName, objectName } = parseObjectPath(objectKey);
    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);
    await setObjectAclPolicy(file, aclPolicy);
  }

  async deleteObjectByKey(objectKey: string): Promise<void> {
    const { bucketName, objectName } = parseObjectPath(objectKey);
    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);
    await file.delete({ ignoreNotFound: true });
  }

  async getSignedDownloadUrl(file: File, ttlSec: number = 300): Promise<string> {
    const { bucketName, objectName } = parseObjectPath(`/${file.bucket.name}/${file.name}`);
    return signObjectURL({ bucketName, objectName, method: "GET", ttlSec });
  }

  async canAccessObjectEntity({
    userId,
    userOrganizationId,
    objectFile,
    requestedPermission,
    userRole,
    fileId,
    fileType,
    aclPolicy,
  }: {
    userId?: string;
    userOrganizationId?: string;
    objectFile: File;
    requestedPermission?: ObjectPermission;
    userRole?: string;
    fileId?: string;
    fileType?: "MEDIA" | "DOCUMENT" | "RECEIPT";
    aclPolicy?: import("./objectAcl").ObjectAclPolicy | null;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      userOrganizationId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
      userRole,
      fileId,
      fileType,
      aclPolicy,
    });
  }
}

/**
 * Task #2405 — Parse a single-range `Range: bytes=start-end` header.
 * Returns `null` for absent, malformed, multi-range, or unsatisfiable
 * requests. The caller decides whether to reply 416 (range header
 * present but not parseable) or 200 (no header at all).
 */
export function parseSingleByteRange(
  header: string | undefined | null,
  totalSize: number,
): { start: number; end: number } | null {
  if (!header || !Number.isFinite(totalSize) || totalSize <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match) return null;
  const startStr = match[1];
  const endStr = match[2];
  let start: number;
  let end: number;
  if (startStr === "" && endStr === "") return null;
  if (startStr === "") {
    // Suffix range: last N bytes.
    const suffix = parseInt(endStr, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, totalSize - suffix);
    end = totalSize - 1;
  } else {
    start = parseInt(startStr, 10);
    end = endStr === "" ? totalSize - 1 : parseInt(endStr, 10);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || end < start || start >= totalSize) return null;
  end = Math.min(end, totalSize - 1);
  return { start, end };
}

export function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  return {
    bucketName,
    objectName,
  };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `make sure you're running on Replit`
    );
  }

  const { signed_url: signedURL } = await response.json();
  return signedURL;
}
