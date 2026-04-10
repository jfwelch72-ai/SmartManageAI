import type { SyncResult, SyncError } from "../../types";
import type { IntegrationConnection } from "@shared/schema";
import { db } from "../../../db";
import { integrationSyncState, projects, planDocuments, estimates, estimateLineItems } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { logInfo, logError } from "../../../utils/logger";
import * as stackctClient from "./client";

function getAccessToken(connection: IntegrationConnection): string {
  const metadata = (connection.metadata as Record<string, any>) || {};
  return metadata.accessToken || "";
}

function getOrgId(connection: IntegrationConnection): string {
  return connection.organizationId;
}

export async function importProjects(
  connection: IntegrationConnection,
  dryRun: boolean = false
): Promise<SyncResult> {
  const accessToken = getAccessToken(connection);
  const orgId = getOrgId(connection);
  const errors: SyncError[] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;

  try {
    const stackctProjects = await stackctClient.listProjects(accessToken);
    logInfo("STACK CT: Fetched projects for import", { count: stackctProjects.length });

    for (const sp of stackctProjects) {
      try {
        const [existing] = await db
          .select()
          .from(integrationSyncState)
          .where(
            and(
              eq(integrationSyncState.connectionId, connection.id),
              eq(integrationSyncState.entityType, `stackct_project_${sp.id}`)
            )
          );

        if (dryRun) {
          if (existing) {
            updated++;
          } else {
            created++;
          }
          continue;
        }

        if (existing) {
          const localProjectId = (existing.metadata as any)?.localProjectId;
          if (localProjectId) {
            await db
              .update(projects)
              .set({
                name: sp.name,
                updatedAt: new Date(),
              })
              .where(eq(projects.id, localProjectId));
            updated++;
          } else {
            skipped++;
          }
        } else {
          const projectCode = `STACKCT-${sp.id.substring(0, 8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
          const [newProject] = await db
            .insert(projects)
            .values({
              name: sp.name,
              code: projectCode,
              clientName: sp.name,
              organizationId: orgId,
              status: "PLANNING" as any,
              startDate: sp.bidDate ? new Date(sp.bidDate) : null,
              locationAddress: sp.address || null,
              city: sp.city || null,
              state: sp.state || null,
            })
            .returning();

          await db.insert(integrationSyncState).values({
            organizationId: orgId,
            connectionId: connection.id,
            entityType: `stackct_project_${sp.id}`,
            metadata: {
              localProjectId: newProject.id,
              stackctProjectId: sp.id,
              name: sp.name,
              stackctName: sp.name,
            },
            lastSyncAt: new Date(),
          });
          created++;
        }
      } catch (err) {
        errors.push({
          entityId: sp.id,
          message: `Failed to import project ${sp.name}: ${String(err)}`,
        });
      }
    }

    return { success: errors.length === 0, entityType: "projects", direction: "import", created, updated, skipped, errors };
  } catch (err) {
    logError("STACK CT project import failed", { error: String(err) });
    return {
      success: false,
      entityType: "projects",
      direction: "import",
      created,
      updated,
      skipped,
      errors: [{ message: `Project import failed: ${String(err)}` }],
    };
  }
}

export async function exportProjects(
  connection: IntegrationConnection,
  dryRun: boolean = false
): Promise<SyncResult> {
  const accessToken = getAccessToken(connection);
  const orgId = getOrgId(connection);
  const errors: SyncError[] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;

  try {
    const localProjects = await db
      .select()
      .from(projects)
      .where(eq(projects.organizationId, orgId));
    logInfo("STACK CT: Exporting projects", { count: localProjects.length });

    for (const lp of localProjects) {
      try {
        const [existing] = await db
          .select()
          .from(integrationSyncState)
          .where(
            and(
              eq(integrationSyncState.connectionId, connection.id),
              eq(integrationSyncState.entityType, `stackct_export_project_${lp.id}`)
            )
          );

        if (dryRun) {
          if (existing) {
            updated++;
          } else {
            created++;
          }
          continue;
        }

        if (existing) {
          const stackctProjectId = (existing.metadata as any)?.stackctProjectId;
          if (stackctProjectId) {
            await stackctClient.updateProject(accessToken, stackctProjectId, {
              name: lp.name,
            });
            await db
              .update(integrationSyncState)
              .set({ lastSyncAt: new Date(), updatedAt: new Date() })
              .where(eq(integrationSyncState.id, existing.id));
            updated++;
          } else {
            skipped++;
          }
        } else {
          const stackctProject = await stackctClient.createProject(accessToken, {
            name: lp.name,
            bidDate: lp.startDate?.toISOString(),
          });

          await db.insert(integrationSyncState).values({
            organizationId: orgId,
            connectionId: connection.id,
            entityType: `stackct_export_project_${lp.id}`,
            metadata: {
              localProjectId: lp.id,
              stackctProjectId: stackctProject.id,
              name: lp.name,
              stackctName: stackctProject.name,
            },
            lastSyncAt: new Date(),
          });
          created++;
        }
      } catch (err) {
        errors.push({
          entityId: lp.id,
          message: `Failed to export project ${lp.name}: ${String(err)}`,
        });
      }
    }

    return { success: errors.length === 0, entityType: "projects", direction: "export", created, updated, skipped, errors };
  } catch (err) {
    logError("STACK CT project export failed", { error: String(err) });
    return {
      success: false,
      entityType: "projects",
      direction: "export",
      created,
      updated,
      skipped,
      errors: [{ message: `Project export failed: ${String(err)}` }],
    };
  }
}

export async function importPlans(
  connection: IntegrationConnection,
  stackctProjectId: string,
  localProjectId: string,
  dryRun: boolean = false
): Promise<SyncResult> {
  const accessToken = getAccessToken(connection);
  const orgId = getOrgId(connection);
  const errors: SyncError[] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;

  try {
    const folders = await stackctClient.listFolders(accessToken, stackctProjectId);
    const planFolder = folders.find((f) => f.name.toLowerCase().includes("plan")) || folders[0];

    if (!planFolder) {
      return {
        success: true,
        entityType: "plans",
        direction: "import",
        created: 0,
        updated: 0,
        skipped: 0,
        errors: [{ message: "No folders found in STACK CT project" }],
      };
    }

    const files = await stackctClient.listFiles(accessToken, stackctProjectId, planFolder.id);
    logInfo("STACK CT: Fetched plan files for import", { count: files.length });

    for (const file of files) {
      try {
        const [existing] = await db
          .select()
          .from(integrationSyncState)
          .where(
            and(
              eq(integrationSyncState.connectionId, connection.id),
              eq(integrationSyncState.entityType, `stackct_plan_${file.id}`)
            )
          );

        if (existing) {
          skipped++;
          continue;
        }

        if (dryRun) {
          created++;
          continue;
        }

        let fileUrl: string;
        let objectKey: string | null = null;

        try {
          const fileBuffer = await stackctClient.downloadFile(accessToken, stackctProjectId, file.id);
          const { Client: StorageClient } = await import("@replit/object-storage");
          const storageClient = new StorageClient();
          objectKey = `stackct-imports/${orgId}/${localProjectId}/${file.id}/${file.name}`;
          await storageClient.uploadFromBytes(objectKey, Buffer.from(fileBuffer));
          fileUrl = objectKey;
          logInfo("STACK CT: Downloaded and stored file", { fileId: file.id, objectKey });
        } catch (dlErr) {
          logError("STACK CT: File download/store failed, using reference URL", { error: String(dlErr) });
          fileUrl = file.downloadUrl || `https://api.stackct.com/api/v2/projects/${stackctProjectId}/files/${file.id}/download`;
        }

        const [newDoc] = await db
          .insert(planDocuments)
          .values({
            projectId: localProjectId,
            title: file.name,
            fileName: file.name,
            fileUrl,
            objectKey,
            fileSize: file.size || null,
            mimeType: file.mimeType || "application/pdf",
            uploadedById: connection.createdByUserId!,
            type: "PLANS" as any,
          })
          .returning();

        await db.insert(integrationSyncState).values({
          organizationId: orgId,
          connectionId: connection.id,
          entityType: `stackct_plan_${file.id}`,
          metadata: {
            localDocId: newDoc.id,
            stackctFileId: file.id,
            stackctProjectId,
            fileName: file.name,
          },
          lastSyncAt: new Date(),
        });
        created++;
      } catch (err) {
        errors.push({
          entityId: file.id,
          message: `Failed to import plan ${file.name}: ${String(err)}`,
        });
      }
    }

    return { success: errors.length === 0, entityType: "plans", direction: "import", created, updated, skipped, errors };
  } catch (err) {
    logError("STACK CT plan import failed", { error: String(err) });
    return {
      success: false,
      entityType: "plans",
      direction: "import",
      created,
      updated,
      skipped,
      errors: [{ message: `Plan import failed: ${String(err)}` }],
    };
  }
}

export async function exportPlans(
  connection: IntegrationConnection,
  stackctProjectId: string,
  localProjectId: string,
  dryRun: boolean = false
): Promise<SyncResult> {
  const accessToken = getAccessToken(connection);
  const orgId = getOrgId(connection);
  const errors: SyncError[] = [];
  let created = 0;
  let skipped = 0;

  try {
    const localDocs = await db
      .select()
      .from(planDocuments)
      .where(eq(planDocuments.projectId, localProjectId));
    logInfo("STACK CT: Exporting plan documents", { count: localDocs.length });

    if (localDocs.length === 0) {
      return { success: true, entityType: "plans", direction: "export", created: 0, updated: 0, skipped: 0, errors: [] };
    }

    let plansFolderId: string | undefined;
    if (!dryRun) {
      const folders = await stackctClient.listFolders(accessToken, stackctProjectId);
      const existing = folders.find((f) => f.name.toLowerCase() === "plans");
      if (existing) {
        plansFolderId = existing.id;
      } else {
        const newFolder = await stackctClient.createFolder(accessToken, stackctProjectId, "Plans");
        plansFolderId = newFolder.id;
      }
    }

    for (const doc of localDocs) {
      try {
        const [syncRecord] = await db
          .select()
          .from(integrationSyncState)
          .where(
            and(
              eq(integrationSyncState.connectionId, connection.id),
              eq(integrationSyncState.entityType, `stackct_export_plan_${doc.id}`)
            )
          );

        if (syncRecord) {
          skipped++;
          continue;
        }

        if (dryRun) {
          created++;
          continue;
        }

        let fileBuffer: Buffer | null = null;

        if (doc.objectKey) {
          try {
            const { Client: StorageClient } = await import("@replit/object-storage");
            const storageClient = new StorageClient();
            const result = await storageClient.downloadAsBytes(doc.objectKey);
            if (result.ok) {
              fileBuffer = Buffer.from(result.value);
            }
          } catch (storageErr) {
            logError("STACK CT: Failed to read from object storage", { objectKey: doc.objectKey, error: String(storageErr) });
          }
        }

        if (!fileBuffer && doc.fileUrl && doc.fileUrl.startsWith("https://")) {
          try {
            const url = new URL(doc.fileUrl);
            const allowedHosts = ["storage.googleapis.com", "s3.amazonaws.com", "blob.core.windows.net"];
            const isAllowed = allowedHosts.some(h => url.hostname === h || url.hostname.endsWith(`.${h}`));
            if (!isAllowed) {
              logError("STACK CT: Skipping untrusted file URL domain", { host: url.hostname });
            } else {
              const resp = await fetch(doc.fileUrl);
              if (resp.ok) {
                const ab = await resp.arrayBuffer();
                fileBuffer = Buffer.from(ab);
              }
            }
          } catch (fetchErr) {
            logError("STACK CT: Failed to fetch file from URL", { fileUrl: doc.fileUrl, error: String(fetchErr) });
          }
        }

        if (!fileBuffer) {
          errors.push({
            entityId: doc.id,
            message: `Cannot read file content for plan ${doc.fileName}`,
          });
          continue;
        }

        const uploadResult = await stackctClient.uploadFile(
          accessToken,
          stackctProjectId,
          plansFolderId!,
          doc.fileName || `plan_${doc.id}.pdf`,
          fileBuffer,
          doc.mimeType || "application/pdf"
        );

        await db.insert(integrationSyncState).values({
          organizationId: orgId,
          connectionId: connection.id,
          entityType: `stackct_export_plan_${doc.id}`,
          metadata: {
            localDocId: doc.id,
            stackctProjectId,
            stackctFileId: uploadResult.id,
            plansFolderId,
            fileName: doc.fileName,
            exportedAt: new Date().toISOString(),
          },
          lastSyncAt: new Date(),
        });
        created++;
      } catch (err) {
        errors.push({
          entityId: doc.id,
          message: `Failed to export plan ${doc.fileName}: ${String(err)}`,
        });
      }
    }

    return { success: errors.length === 0, entityType: "plans", direction: "export", created, updated: 0, skipped, errors };
  } catch (err) {
    logError("STACK CT plan export failed", { error: String(err) });
    return {
      success: false,
      entityType: "plans",
      direction: "export",
      created,
      updated: 0,
      skipped,
      errors: [{ message: `Plan export failed: ${String(err)}` }],
    };
  }
}

export async function importEstimates(
  connection: IntegrationConnection,
  stackctProjectId: string,
  localProjectId: string,
  dryRun: boolean = false
): Promise<SyncResult> {
  const accessToken = getAccessToken(connection);
  const orgId = getOrgId(connection);
  const errors: SyncError[] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;

  try {
    const takeoffs = await stackctClient.listTakeoffs(accessToken, stackctProjectId);
    logInfo("STACK CT: Fetched takeoffs for import", { count: takeoffs.length });

    for (const takeoff of takeoffs) {
      try {
        const [existing] = await db
          .select()
          .from(integrationSyncState)
          .where(
            and(
              eq(integrationSyncState.connectionId, connection.id),
              eq(integrationSyncState.entityType, `stackct_takeoff_${takeoff.id}`)
            )
          );

        if (existing) {
          skipped++;
          continue;
        }

        if (dryRun) {
          created++;
          continue;
        }

        const fullTakeoff = await stackctClient.getTakeoff(accessToken, stackctProjectId, takeoff.id);

        const [newEstimate] = await db
          .insert(estimates)
          .values({
            projectId: localProjectId,
            status: "DRAFT" as any,
            notes: `Imported from STACK CT: ${fullTakeoff.name}`,
            createdById: connection.createdByUserId!,
          })
          .returning();

        if (fullTakeoff.items && fullTakeoff.items.length > 0) {
          for (const item of fullTakeoff.items) {
            await db.insert(estimateLineItems).values({
              estimateId: newEstimate.id,
              category: "OTHER" as any,
              description: item.description || "Imported from STACK CT",
              quantity: String(item.quantity || 0),
              unit: item.unit || "EA",
              source: "MANUAL" as any,
              materialCost: String(item.unitCost || 0),
              laborCost: "0",
              equipmentCost: "0",
              consumablesCost: "0",
              subcontractCost: "0",
              overheadAllocation: "0",
              profitAllocation: "0",
              totalCost: String(item.totalCost || (item.quantity || 0) * (item.unitCost || 0)),
              notes: item.notes || `STACK CT category: ${item.category || "uncategorized"}`,
            });
          }
        }

        await db.insert(integrationSyncState).values({
          organizationId: orgId,
          connectionId: connection.id,
          entityType: `stackct_takeoff_${takeoff.id}`,
          metadata: {
            localEstimateId: newEstimate.id,
            stackctTakeoffId: takeoff.id,
            stackctProjectId,
            takeoffName: takeoff.name,
            itemCount: fullTakeoff.items?.length || 0,
          },
          lastSyncAt: new Date(),
        });
        created++;
      } catch (err) {
        errors.push({
          entityId: takeoff.id,
          message: `Failed to import takeoff ${takeoff.name}: ${String(err)}`,
        });
      }
    }

    return { success: errors.length === 0, entityType: "estimates", direction: "import", created, updated, skipped, errors };
  } catch (err) {
    logError("STACK CT estimate import failed", { error: String(err) });
    return {
      success: false,
      entityType: "estimates",
      direction: "import",
      created,
      updated,
      skipped,
      errors: [{ message: `Estimate import failed: ${String(err)}` }],
    };
  }
}

export async function exportEstimates(
  connection: IntegrationConnection,
  stackctProjectId: string,
  localProjectId: string,
  dryRun: boolean = false
): Promise<SyncResult> {
  const accessToken = getAccessToken(connection);
  const orgId = getOrgId(connection);
  const errors: SyncError[] = [];
  let created = 0;
  let skipped = 0;

  try {
    const localEstimates = await db
      .select()
      .from(estimates)
      .where(eq(estimates.projectId, localProjectId));
    logInfo("STACK CT: Exporting estimates", { count: localEstimates.length });

    for (const est of localEstimates) {
      try {
        const [syncRecord] = await db
          .select()
          .from(integrationSyncState)
          .where(
            and(
              eq(integrationSyncState.connectionId, connection.id),
              eq(integrationSyncState.entityType, `stackct_export_estimate_${est.id}`)
            )
          );

        if (syncRecord) {
          skipped++;
          continue;
        }

        const lineItems = await db
          .select()
          .from(estimateLineItems)
          .where(eq(estimateLineItems.estimateId, est.id));

        if (dryRun) {
          created++;
          continue;
        }

        const takeoffItems = lineItems.map((li) => ({
          description: li.description,
          quantity: parseFloat(li.quantity) || 0,
          unit: li.unit,
          unitCost: parseFloat(li.materialCost || "0"),
          totalCost: parseFloat(li.totalCost || "0"),
          category: li.category,
        }));

        const stackctTakeoff = await stackctClient.createTakeoff(accessToken, stackctProjectId, {
          name: `Estimate v${est.versionNumber}`,
          description: est.notes || undefined,
          items: takeoffItems,
        });

        await db.insert(integrationSyncState).values({
          organizationId: orgId,
          connectionId: connection.id,
          entityType: `stackct_export_estimate_${est.id}`,
          metadata: {
            localEstimateId: est.id,
            stackctTakeoffId: stackctTakeoff.id,
            stackctProjectId,
            itemCount: takeoffItems.length,
          },
          lastSyncAt: new Date(),
        });
        created++;
      } catch (err) {
        errors.push({
          entityId: est.id,
          message: `Failed to export estimate: ${String(err)}`,
        });
      }
    }

    return { success: errors.length === 0, entityType: "estimates", direction: "export", created, updated: 0, skipped, errors };
  } catch (err) {
    logError("STACK CT estimate export failed", { error: String(err) });
    return {
      success: false,
      entityType: "estimates",
      direction: "export",
      created,
      updated: 0,
      skipped,
      errors: [{ message: `Estimate export failed: ${String(err)}` }],
    };
  }
}
