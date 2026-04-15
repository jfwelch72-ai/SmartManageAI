import { logError } from "./utils/logger";
import { File } from "@google-cloud/storage";
import { db } from "./db";
import { filePermissions, objectAclPolicies, projects, bids, vendorEnrollments, vendorUsers, media, planDocuments, bidDocuments, subcontractorBidInvitations, subcontractorBidRequests } from "@shared/schema";
import { eq, and, or, sql } from "drizzle-orm";

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
  let exists = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    const [found] = await objectFile.exists();
    if (found) { exists = true; break; }
    if (attempt < 4) {
      console.log(`[acl] Object not yet visible (attempt ${attempt + 1}/5), retrying in ${(attempt + 1) * 500}ms: ${objectFile.name}`);
      await new Promise(r => setTimeout(r, (attempt + 1) * 500));
    }
  }
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
    logError("Failed to mirror ACL policy to DB:", {}, dbErr instanceof Error ? dbErr : new Error(String(dbErr)));
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
    logError("DB ACL fallback also failed:", {}, dbErr instanceof Error ? dbErr : new Error(String(dbErr)));
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
  aclPolicy: preloadedAclPolicy,
}: {
  userId?: string;
  userOrganizationId?: string;
  objectFile: File;
  requestedPermission: ObjectPermission;
  userRole?: string;
  fileId?: string;
  fileType?: "MEDIA" | "DOCUMENT" | "RECEIPT";
  aclPolicy?: ObjectAclPolicy | null;
}): Promise<boolean> {
  const aclPolicy = preloadedAclPolicy !== undefined ? preloadedAclPolicy : await getObjectAclPolicy(objectFile);
  if (!aclPolicy) {
    return false;
  }

  // SUPER_ADMIN can access all files across all organizations for support/oversight
  if (userRole === "SUPER_ADMIN") {
    return true;
  }

  if (!aclPolicy.organizationId) {
    return false;
  }

  const isOrgMember = userOrganizationId && userOrganizationId === aclPolicy.organizationId;

  if (!isOrgMember && userRole === "VENDOR" && requestedPermission === ObjectPermission.READ && userId && fileId && fileType) {
    try {
      const vendorUserResult = await db
        .select({ crmOrgId: vendorUsers.crmOrganisationId })
        .from(vendorUsers)
        .where(eq(vendorUsers.userId, userId))
        .limit(1);
      const vendorCrmOrgId = vendorUserResult[0]?.crmOrgId;
      const vendorOrgId = userOrganizationId;

      if (vendorCrmOrgId) {
        const [enrollment] = await db
          .select({ id: vendorEnrollments.id })
          .from(vendorEnrollments)
          .where(
            and(
              eq(vendorEnrollments.vendorCrmOrgId, vendorCrmOrgId),
              eq(vendorEnrollments.contractorOrgId, aclPolicy.organizationId),
              eq(vendorEnrollments.status, "ACTIVE")
            )
          )
          .limit(1);

        if (enrollment) {
          if (fileType === "DOCUMENT") {
            const [bd] = await db
              .select({ bidId: bidDocuments.bidId })
              .from(bidDocuments)
              .where(eq(bidDocuments.id, fileId))
              .limit(1);

            if (bd?.bidId) {
              const [invitation] = await db
                .select({ id: subcontractorBidInvitations.id })
                .from(subcontractorBidInvitations)
                .innerJoin(subcontractorBidRequests, eq(subcontractorBidInvitations.bidRequestId, subcontractorBidRequests.id))
                .where(
                  and(
                    eq(subcontractorBidRequests.bidId, bd.bidId),
                    vendorOrgId
                      ? eq(subcontractorBidInvitations.invitedOrganizationId, vendorOrgId)
                      : sql`false`
                  )
                )
                .limit(1);
              if (invitation) return true;
            }
          }

          let fileProjectId: string | null = null;
          if (fileType === "MEDIA") {
            const [m] = await db.select({ projectId: media.projectId }).from(media).where(eq(media.id, fileId)).limit(1);
            fileProjectId = m?.projectId ?? null;
          } else if (fileType === "DOCUMENT") {
            const [d] = await db.select({ projectId: planDocuments.projectId }).from(planDocuments).where(eq(planDocuments.id, fileId)).limit(1);
            fileProjectId = d?.projectId ?? null;
          }

          if (fileProjectId) {
            const [invitation] = await db
              .select({ id: subcontractorBidInvitations.id })
              .from(subcontractorBidInvitations)
              .innerJoin(subcontractorBidRequests, eq(subcontractorBidInvitations.bidRequestId, subcontractorBidRequests.id))
              .where(
                and(
                  eq(subcontractorBidRequests.projectId, fileProjectId),
                  vendorOrgId
                    ? eq(subcontractorBidInvitations.invitedOrganizationId, vendorOrgId)
                    : sql`false`
                )
              )
              .limit(1);
            if (invitation) return true;
          }
        }
      }
    } catch (err) {
      logError("VENDOR cross-org ACL lookup failed:", {}, err instanceof Error ? err : new Error(String(err)));
    }
  }

  if (!isOrgMember) {
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

  // Check explicit permissions in database for SUPERINTENDENT, FIELD_WORKER, and ESTIMATOR
  if (fileId && fileType && (userRole === "SUPERINTENDENT" || userRole === "FIELD_WORKER" || userRole === "ESTIMATOR")) {
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

  if (userRole === "ESTIMATOR" && requestedPermission === ObjectPermission.READ && fileId && fileType) {
    try {
      let fileProjectId: string | null = null;
      let fileBidId: string | null = null;

      if (fileType === "MEDIA") {
        const [m] = await db.select({ projectId: media.projectId }).from(media).where(eq(media.id, fileId)).limit(1);
        fileProjectId = m?.projectId ?? null;
      } else if (fileType === "DOCUMENT") {
        const [d] = await db.select({ projectId: planDocuments.projectId }).from(planDocuments).where(eq(planDocuments.id, fileId)).limit(1);
        fileProjectId = d?.projectId ?? null;

        if (!fileProjectId) {
          const [bd] = await db.select({ bidId: bidDocuments.bidId }).from(bidDocuments).where(eq(bidDocuments.id, fileId)).limit(1);
          fileBidId = bd?.bidId ?? null;
        }
      }

      if (fileBidId) {
        const [assignedBid] = await db
          .select({ id: bids.id })
          .from(bids)
          .where(
            and(
              eq(bids.id, fileBidId),
              eq(bids.gcOrganizationId, aclPolicy.organizationId),
              eq(bids.estimatorId, userId)
            )
          ).limit(1);
        if (assignedBid) return true;
      }

      if (fileProjectId) {
        const [assignedProject] = await db
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(
              eq(projects.id, fileProjectId),
              eq(projects.estimatorId, userId)
            )
          ).limit(1);
        if (assignedProject) return true;

        const [assignedBid] = await db
          .select({ id: bids.id })
          .from(bids)
          .where(
            and(
              eq(bids.gcOrganizationId, aclPolicy.organizationId),
              eq(bids.estimatorId, userId),
              sql`${bids.convertedToProjectId} = ${fileProjectId}`
            )
          ).limit(1);
        if (assignedBid) return true;
      }
    } catch (err) {
      logError("ESTIMATOR ACL lookup failed:", {}, err instanceof Error ? err : new Error(String(err)));
    }
  }

  return false;
}
