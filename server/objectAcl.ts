import { File } from "@google-cloud/storage";
import { db } from "./db";
import { filePermissions, objectAclPolicies } from "@shared/schema";
import { eq, and } from "drizzle-orm";

const ACL_POLICY_METADATA_KEY = "custom:aclPolicy";

export enum ObjectPermission {
  READ = "read",
  WRITE = "write",
}

export interface ObjectAclPolicy {
  owner: string;
  organizationId: string;
  visibility: "public" | "private";
}

function isPermissionAllowed(
  requested: ObjectPermission,
  granted: ObjectPermission,
): boolean {
  if (requested === ObjectPermission.READ) {
    return [ObjectPermission.READ, ObjectPermission.WRITE].includes(granted);
  }

  return granted === ObjectPermission.WRITE;
}

export async function setObjectAclPolicy(
  objectFile: File,
  aclPolicy: ObjectAclPolicy,
): Promise<void> {
  const [exists] = await objectFile.exists();
  if (!exists) {
    throw new Error(`Object not found: ${objectFile.name}`);
  }

  await objectFile.setMetadata({
    metadata: {
      [ACL_POLICY_METADATA_KEY]: JSON.stringify(aclPolicy),
    },
  });

  const objectKey = objectFile.name;
  try {
    await db
      .insert(objectAclPolicies)
      .values({
        objectKey,
        owner: aclPolicy.owner,
        organizationId: aclPolicy.organizationId,
        visibility: aclPolicy.visibility,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: objectAclPolicies.objectKey,
        set: {
          owner: aclPolicy.owner,
          organizationId: aclPolicy.organizationId,
          visibility: aclPolicy.visibility,
          updatedAt: new Date(),
        },
      });
  } catch (dbErr) {
    console.error("Failed to mirror ACL policy to DB:", dbErr);
  }
}

export async function getObjectAclPolicy(
  objectFile: File,
): Promise<ObjectAclPolicy | null> {
  try {
    const [metadata] = await objectFile.getMetadata();
    const aclPolicyStr = metadata?.metadata?.[ACL_POLICY_METADATA_KEY];
    if (aclPolicyStr) {
      return JSON.parse(aclPolicyStr as string);
    }
  } catch (gcsErr) {
    console.warn(
      `GCS metadata fetch failed for ${objectFile.name}, falling back to DB:`,
      gcsErr,
    );
  }

  try {
    const [row] = await db
      .select()
      .from(objectAclPolicies)
      .where(eq(objectAclPolicies.objectKey, objectFile.name))
      .limit(1);

    if (row) {
      return {
        owner: row.owner,
        organizationId: row.organizationId,
        visibility: row.visibility as "public" | "private",
      };
    }
  } catch (dbErr) {
    console.error("DB ACL fallback also failed:", dbErr);
  }

  return null;
}

export async function canAccessObject({
  userId,
  userOrganizationId,
  objectFile,
  requestedPermission,
  userRole,
  fileId,
  fileType,
}: {
  userId?: string;
  userOrganizationId?: string;
  objectFile: File;
  requestedPermission: ObjectPermission;
  userRole?: string;
  fileId?: string;
  fileType?: "MEDIA" | "DOCUMENT" | "RECEIPT";
}): Promise<boolean> {
  const aclPolicy = await getObjectAclPolicy(objectFile);
  if (!aclPolicy) {
    return false;
  }

  // SUPER_ADMIN can access all files across all organizations for support/oversight
  if (userRole === "SUPER_ADMIN") {
    return true;
  }

  // CRITICAL: Verify organization membership
  // Files are isolated per organization - users can only access files from their own organization
  // Legacy files without organizationId are denied unless user is SUPER_ADMIN (handled above)
  if (aclPolicy.organizationId) {
    if (!userOrganizationId || userOrganizationId !== aclPolicy.organizationId) {
      return false;
    }
  } else {
    // Legacy files without organizationId - deny access for security
    // Only SUPER_ADMIN can access legacy files (handled above)
    return false;
  }

  if (
    aclPolicy.visibility === "public" &&
    requestedPermission === ObjectPermission.READ
  ) {
    return true;
  }

  if (!userId) {
    return false;
  }

  if (aclPolicy.owner === userId) {
    return true;
  }

  if (userRole === "ADMIN" || userRole === "MANAGER") {
    return true;
  }

  // Check explicit permissions in database for SUPERINTENDENT and HOURLY_EMPLOYEE
  if (fileId && fileType && (userRole === "SUPERINTENDENT" || userRole === "HOURLY_EMPLOYEE")) {
    const permission = await db
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

    if (permission.length > 0) {
      return true;
    }
  }

  return false;
}
