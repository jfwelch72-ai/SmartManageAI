import { db } from "./db";
import { media, planDocuments, receipts } from "@shared/schema";
import { eq } from "drizzle-orm";

export type FileType = "MEDIA" | "DOCUMENT" | "RECEIPT";

// Validate that fileId references an actual file record
export async function validateFileExists(fileId: string, fileType: FileType): Promise<boolean> {
  let exists = false;

  if (fileType === "MEDIA") {
    const [record] = await db.select().from(media).where(eq(media.id, fileId)).limit(1);
    exists = !!record;
  } else if (fileType === "DOCUMENT") {
    const [record] = await db.select().from(planDocuments).where(eq(planDocuments.id, fileId)).limit(1);
    exists = !!record;
  } else if (fileType === "RECEIPT") {
    const [record] = await db.select().from(receipts).where(eq(receipts.id, fileId)).limit(1);
    exists = !!record;
  }

  return exists;
}

// MIME type whitelists
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

export const ALLOWED_RECEIPT_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
];

// Max file sizes (in bytes)
export const MAX_MEDIA_SIZE = 100 * 1024 * 1024; // 100MB
export const MAX_DOCUMENT_SIZE = 50 * 1024 * 1024; // 50MB
export const MAX_RECEIPT_SIZE = 10 * 1024 * 1024; // 10MB

export function validateMimeType(mimeType: string, fileType: FileType): boolean {
  if (fileType === "MEDIA") {
    return ALLOWED_MEDIA_TYPES.includes(mimeType);
  } else if (fileType === "DOCUMENT") {
    return ALLOWED_DOCUMENT_TYPES.includes(mimeType);
  } else if (fileType === "RECEIPT") {
    return ALLOWED_RECEIPT_TYPES.includes(mimeType);
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
  }
  return false;
}

export function getMaxFileSize(fileType: FileType): number {
  if (fileType === "MEDIA") return MAX_MEDIA_SIZE;
  if (fileType === "DOCUMENT") return MAX_DOCUMENT_SIZE;
  if (fileType === "RECEIPT") return MAX_RECEIPT_SIZE;
  return 0;
}

export function getAllowedMimeTypes(fileType: FileType): string[] {
  if (fileType === "MEDIA") return ALLOWED_MEDIA_TYPES;
  if (fileType === "DOCUMENT") return ALLOWED_DOCUMENT_TYPES;
  if (fileType === "RECEIPT") return ALLOWED_RECEIPT_TYPES;
  return [];
}
