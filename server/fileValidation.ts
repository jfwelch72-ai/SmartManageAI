import { db } from "./db";
import { media, planDocuments, receipts } from "@shared/schema";
import { eq } from "drizzle-orm";

export type FileType = "MEDIA" | "DOCUMENT" | "RECEIPT" | "BIM" | "LIDAR";

export async function validateFileExists(fileId: string, fileType: FileType): Promise<boolean> {
  let exists = false;

  if (fileType === "MEDIA") {
    const [record] = await db.select().from(media).where(eq(media.id, fileId)).limit(1);
    exists = !!record;
  } else if (fileType === "DOCUMENT" || fileType === "BIM") {
    const [record] = await db.select().from(planDocuments).where(eq(planDocuments.id, fileId)).limit(1);
    exists = !!record;
  } else if (fileType === "RECEIPT") {
    const [record] = await db.select().from(receipts).where(eq(receipts.id, fileId)).limit(1);
    exists = !!record;
  }

  return exists;
}

export const ALLOWED_MEDIA_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo",
];

export const ALLOWED_DOCUMENT_TYPES = [
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/tiff",
];

export const ALLOWED_BIM_TYPES = [
  "application/x-step",
  "application/octet-stream",
  "model/ifc",
];

export const ALLOWED_LIDAR_TYPES = [
  "application/octet-stream",
  "application/x-las",
  "application/x-laz",
  "application/x-e57",
  "application/x-ply",
  "model/x-pointcloud",
];

export const ALLOWED_RECEIPT_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
];

// Effectively-unlimited per-file storage cap. The underlying object-storage
// flow uses chunked/resumable uploads above 10 MB, so multi-GB uploads are
// supported. Anything below this threshold should pass server-side validation
// for every user-storage file type. Keep this large enough to cover huge
// drawing sets (25+ GB) without ever silently rejecting a legitimate upload —
// construction projects routinely upload many large plans, BIM, and LiDAR
// files in the Plans & Takeoff step. Task #2405 lifted this from 20 → 32 GB
// to cover full civil planset bundles up to 25 GB with headroom.
export const MAX_STORAGE_FILE_SIZE = 32 * 1024 * 1024 * 1024; // 32 GB

export const MAX_MEDIA_SIZE = MAX_STORAGE_FILE_SIZE;
export const MAX_DOCUMENT_SIZE = MAX_STORAGE_FILE_SIZE;
export const MAX_RECEIPT_SIZE = MAX_STORAGE_FILE_SIZE;
export const MAX_BIM_SIZE = MAX_STORAGE_FILE_SIZE;
export const MAX_LIDAR_SIZE = MAX_STORAGE_FILE_SIZE;

export function validateMimeType(mimeType: string, fileType: FileType): boolean {
  if (fileType === "MEDIA") {
    return ALLOWED_MEDIA_TYPES.includes(mimeType);
  } else if (fileType === "DOCUMENT") {
    return ALLOWED_DOCUMENT_TYPES.includes(mimeType);
  } else if (fileType === "RECEIPT") {
    return ALLOWED_RECEIPT_TYPES.includes(mimeType);
  } else if (fileType === "BIM") {
    return ALLOWED_BIM_TYPES.includes(mimeType);
  } else if (fileType === "LIDAR") {
    return ALLOWED_LIDAR_TYPES.includes(mimeType);
  }
  return false;
}

export function validateFileSize(fileSize: number, fileType: FileType): boolean {
  if (fileType === "MEDIA") {
    return fileSize <= MAX_MEDIA_SIZE;
  } else if (fileType === "DOCUMENT") {
    return fileSize <= MAX_DOCUMENT_SIZE;
  } else if (fileType === "RECEIPT") {
    return fileSize <= MAX_RECEIPT_SIZE;
  } else if (fileType === "BIM") {
    return fileSize <= MAX_BIM_SIZE;
  } else if (fileType === "LIDAR") {
    return fileSize <= MAX_LIDAR_SIZE;
  }
  return false;
}

export function getMaxFileSize(fileType: FileType): number {
  if (fileType === "MEDIA") return MAX_MEDIA_SIZE;
  if (fileType === "DOCUMENT") return MAX_DOCUMENT_SIZE;
  if (fileType === "RECEIPT") return MAX_RECEIPT_SIZE;
  if (fileType === "BIM") return MAX_BIM_SIZE;
  if (fileType === "LIDAR") return MAX_LIDAR_SIZE;
  return 0;
}

export function getAllowedMimeTypes(fileType: FileType): string[] {
  if (fileType === "MEDIA") return ALLOWED_MEDIA_TYPES;
  if (fileType === "DOCUMENT") return ALLOWED_DOCUMENT_TYPES;
  if (fileType === "RECEIPT") return ALLOWED_RECEIPT_TYPES;
  if (fileType === "BIM") return ALLOWED_BIM_TYPES;
  if (fileType === "LIDAR") return ALLOWED_LIDAR_TYPES;
  return [];
}
