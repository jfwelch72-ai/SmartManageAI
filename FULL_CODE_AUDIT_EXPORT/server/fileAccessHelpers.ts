import { db } from "./db";
import { media, planDocuments, receipts, filePermissions } from "@shared/schema";
import { eq, and, or } from "drizzle-orm";

type FileType = "MEDIA" | "DOCUMENT" | "RECEIPT";

interface ResolvedFile {
  fileType: FileType;
  fileId: string;
  record: any;
}

/**
 * Resolve objectKey to {fileType, fileId, record}
 * Queries all three file tables to find which one contains this objectKey
 */
export async function resolveObjectKeyToFile(objectKey: string): Promise<ResolvedFile | null> {
  // Try to find in media table
  const [mediaRecord] = await db
    .select()
    .from(media)
    .where(eq(media.objectKey, objectKey))
    .limit(1);

  if (mediaRecord) {
    return {
      fileType: "MEDIA",
      fileId: mediaRecord.id,
      record: mediaRecord,
    };
  }

  // Try to find in planDocuments table
  const [documentRecord] = await db
    .select()
    .from(planDocuments)
    .where(eq(planDocuments.objectKey, objectKey))
    .limit(1);

  if (documentRecord) {
    return {
      fileType: "DOCUMENT",
      fileId: documentRecord.id,
      record: documentRecord,
    };
  }

  // Try to find in receipts table
  const [receiptRecord] = await db
    .select()
    .from(receipts)
    .where(eq(receipts.objectKey, objectKey))
    .limit(1);

  if (receiptRecord) {
    return {
      fileType: "RECEIPT",
      fileId: receiptRecord.id,
      record: receiptRecord,
    };
  }

  return null;
}

/**
 * Check if user can access a specific file
 * Admin/Manager have full access
 * Others need to be the uploader OR have explicit permission
 */
export async function canUserAccessFile(
  userId: string,
  userRole: string,
  fileId: string,
  fileType: FileType
): Promise<boolean> {
  // Admin and Manager have full access
  if (userRole === "ADMIN" || userRole === "MANAGER") {
    return true;
  }

  // Get the file record to check if user is the uploader
  let uploadedById: string | null = null;

  if (fileType === "MEDIA") {
    const [record] = await db
      .select({ uploadedById: media.uploadedById })
      .from(media)
      .where(eq(media.id, fileId))
      .limit(1);
    uploadedById = record?.uploadedById || null;
  } else if (fileType === "DOCUMENT") {
    const [record] = await db
      .select({ uploadedById: planDocuments.uploadedById })
      .from(planDocuments)
      .where(eq(planDocuments.id, fileId))
      .limit(1);
    uploadedById = record?.uploadedById || null;
  } else if (fileType === "RECEIPT") {
    const [record] = await db
      .select({ userId: receipts.userId })
      .from(receipts)
      .where(eq(receipts.id, fileId))
      .limit(1);
    uploadedById = record?.userId || null;
  }

  // Check if user is the uploader
  if (uploadedById === userId) {
    return true;
  }

  // Check for explicit permission
  const [permission] = await db
    .select()
    .from(filePermissions)
    .where(
      and(
        eq(filePermissions.fileId, fileId),
        eq(filePermissions.fileType, fileType),
        eq(filePermissions.userId, userId)
      )
    )
    .limit(1);

  return !!permission;
}

/**
 * Filter file list by permissions
 * Admin/Manager see all files
 * Others see only files they uploaded OR have explicit permissions for
 */
export async function filterFilesByPermissions<T extends { id: string; uploadedById?: string; userId?: string }>(
  files: T[],
  userId: string,
  userRole: string,
  fileType: FileType
): Promise<T[]> {
  // Admin and Manager see all files
  if (userRole === "ADMIN" || userRole === "MANAGER") {
    return files;
  }

  // If no files, return empty array
  if (files.length === 0) {
    return [];
  }

  // Get all file IDs
  const fileIds = files.map(f => f.id);

  // Get all permissions for this user and file type
  const permissions = await db
    .select({ fileId: filePermissions.fileId })
    .from(filePermissions)
    .where(
      and(
        eq(filePermissions.userId, userId),
        eq(filePermissions.fileType, fileType)
      )
    );

  const permittedFileIds = new Set(permissions.map(p => p.fileId));

  // Filter files: user uploaded OR has explicit permission
  return files.filter(file => {
    // Check if user uploaded this file
    const uploadedByUser = (file.uploadedById === userId) || (file.userId === userId);
    
    // Check if user has explicit permission
    const hasPermission = permittedFileIds.has(file.id);

    return uploadedByUser || hasPermission;
  });
}
