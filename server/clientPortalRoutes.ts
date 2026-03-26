import { Router } from "express";
import { db } from "./db";
import {
  clientPortalAccess,
  projects,
  organizations,
  users,
  scopeItems,
  media,
  projectSchedules,
  projectScheduleTasks,
  planDocuments,
  changeOrders,
  changeOrderComments,
  changeOrderRevisions,
  changeOrderAttachments,
  tmInvoices,
} from "@shared/schema";
import { eq, and, desc, asc, inArray, ne, sql } from "drizzle-orm";
import { type AuthRequest, requireAuth, requireRole } from "./auth";
import { ObjectStorageService } from "./objectStorage";
import { insertNotifications } from "./services/notificationService";
import { z } from "zod";
import crypto from "crypto";
import { sendEmail } from "./email";
import { authLimiter } from "./rateLimiter";

const router = Router();

const portalAccessSchema = z.object({
  projectId: z.string(),
  email: z.string().email(),
  name: z.string().optional(),
});

router.post("/portal/access/create", requireAuth, requireRole("ADMIN", "MANAGER", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const organizationId = req.user?.organizationId;
    if (!userId || !organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsed = portalAccessSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
    }

    const { projectId, email, name } = parsed.data;

    const accessToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(accessToken).digest("hex");
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    const [access] = await db.insert(clientPortalAccess).values({
      organizationId,
      projectId,
      email,
      name,
      accessTokenHash: tokenHash,
      tokenExpiresAt: expiresAt,
      createdByUserId: userId,
    }).returning();

    res.json({
      success: true,
      accessId: access.id,
      accessToken,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    console.error("Create portal access error:", error);
    res.status(500).json({ error: "Failed to create access" });
  }
});

router.get("/portal/access/:projectId", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const accessList = await db.select()
      .from(clientPortalAccess)
      .where(and(
        eq(clientPortalAccess.projectId, req.params.projectId),
        eq(clientPortalAccess.organizationId, organizationId)
      ))
      .orderBy(desc(clientPortalAccess.createdAt));

    res.json({ accessList });
  } catch (error) {
    console.error("Get portal access error:", error);
    res.status(500).json({ error: "Failed to get access list" });
  }
});

router.delete("/portal/access/:accessId", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    await db.update(clientPortalAccess)
      .set({ isActive: false })
      .where(and(
        eq(clientPortalAccess.id, req.params.accessId),
        eq(clientPortalAccess.organizationId, organizationId)
      ));

    res.json({ success: true });
  } catch (error) {
    console.error("Revoke portal access error:", error);
    res.status(500).json({ error: "Failed to revoke access" });
  }
});

router.get("/client-portal/:projectId", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const orgId = req.user?.organizationId;
    if (!userId || !orgId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const projectId = req.params.projectId;

    const accessList = await db
      .select({
        access: clientPortalAccess,
        projectName: projects.name,
      })
      .from(clientPortalAccess)
      .leftJoin(projects, eq(clientPortalAccess.projectId, projects.id))
      .where(
        and(
          eq(clientPortalAccess.projectId, projectId),
          eq(clientPortalAccess.organizationId, orgId)
        )
      )
      .orderBy(desc(clientPortalAccess.createdAt));

    const formatted = accessList.map((row) => {
      let permissions = {
        viewProgress: true,
        viewPhotos: true,
        viewSchedule: true,
        viewDocuments: false,
        viewChangeOrders: false,
        viewInvoices: false,
        submitRequests: false,
      };
      try {
        if (row.access.permissionsJson) {
          permissions = { ...permissions, ...JSON.parse(row.access.permissionsJson) };
        }
      } catch {}

      return {
        id: row.access.id,
        projectId: row.access.projectId,
        projectName: row.projectName || "Unknown Project",
        email: row.access.email,
        name: row.access.name || "",
        accessType: row.access.accessType || "STAKEHOLDER",
        permissions,
        isActive: row.access.isActive,
        lastAccessedAt: row.access.lastAccessedAt?.toISOString(),
        expiresAt: row.access.tokenExpiresAt?.toISOString(),
        createdAt: row.access.createdAt.toISOString(),
      };
    });

    const activeCount = formatted.filter((a) => a.isActive).length;
    const lastActivity = formatted.reduce((latest: string | null, a) => {
      if (!a.lastAccessedAt) return latest;
      if (!latest) return a.lastAccessedAt;
      return a.lastAccessedAt > latest ? a.lastAccessedAt : latest;
    }, null);

    const host = req.get("host") || "";
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
    const portalUrl = `${protocol}://${host}/portal/${projectId}`;

    res.json({
      accessList: formatted,
      stats: {
        totalAccess: formatted.length,
        activeUsers: activeCount,
        lastActivity,
      },
      portalUrl,
    });
  } catch (error) {
    console.error("Error fetching client portal access:", error);
    res.status(500).json({ error: "Failed to fetch portal access" });
  }
});

router.post("/client-portal/invite", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const orgId = req.user?.organizationId;
    if (!userId || !orgId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { projectId, email, name, accessType, permissions } = req.body;

    if (!projectId || !email || !name) {
      return res.status(400).json({ error: "Project ID, email, and name are required" });
    }

    const validAccessTypes = ["OWNER_REP", "GC_REP", "STAKEHOLDER", "VIEWER"];
    const resolvedAccessType = validAccessTypes.includes(accessType) ? accessType : "STAKEHOLDER";

    const [existingProject] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.gcOrganizationId, orgId)))
      .limit(1);

    if (!existingProject) {
      return res.status(404).json({ error: "Project not found" });
    }

    const [existing] = await db
      .select()
      .from(clientPortalAccess)
      .where(
        and(
          eq(clientPortalAccess.projectId, projectId),
          eq(clientPortalAccess.organizationId, orgId),
          eq(clientPortalAccess.email, email.trim().toLowerCase())
        )
      )
      .limit(1);

    if (existing) {
      return res.status(409).json({ error: "This email already has portal access for this project" });
    }

    const permissionsJson = permissions
      ? JSON.stringify(permissions)
      : JSON.stringify({
          viewProgress: true,
          viewPhotos: true,
          viewSchedule: true,
          viewDocuments: false,
          viewChangeOrders: false,
          viewInvoices: false,
          submitRequests: false,
        });

    const [newAccess] = await db
      .insert(clientPortalAccess)
      .values({
        organizationId: orgId,
        projectId,
        email: email.trim().toLowerCase(),
        name: name.trim(),
        accessType: resolvedAccessType,
        permissionsJson,
        isActive: true,
        createdByUserId: userId,
      })
      .returning();

    let parsedPermissions;
    try {
      parsedPermissions = JSON.parse(newAccess.permissionsJson || "{}");
    } catch {
      parsedPermissions = {};
    }

    const host = req.get("host") || "";
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
    const portalLink = `${protocol}://${host}/portal/${projectId}`;

    const [invitingUser] = await db
      .select({ firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const [org] = await db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);

    const inviterName = invitingUser
      ? `${invitingUser.firstName || ""} ${invitingUser.lastName || ""}`.trim()
      : "Your project team";
    const orgName = org?.name || "your contractor";

    const accessTypeLabels: Record<string, string> = {
      OWNER_REP: "Owner Representative",
      GC_REP: "GC Representative",
      STAKEHOLDER: "Stakeholder",
      VIEWER: "Viewer",
    };
    const accessLabel = accessTypeLabels[resolvedAccessType] || "Stakeholder";

    const permissionsList = [];
    if (parsedPermissions.viewProgress) permissionsList.push("Progress Updates");
    if (parsedPermissions.viewPhotos) permissionsList.push("Photos & Media");
    if (parsedPermissions.viewSchedule) permissionsList.push("Schedule");
    if (parsedPermissions.viewDocuments) permissionsList.push("Documents");
    if (parsedPermissions.viewChangeOrders) permissionsList.push("Change Orders");
    if (parsedPermissions.viewInvoices) permissionsList.push("Invoices & Payments");
    if (parsedPermissions.submitRequests) permissionsList.push("Submit Requests");

    const permissionsHtml = permissionsList.length > 0
      ? `<ul style="margin: 8px 0; padding-left: 20px; color: #333333;">${permissionsList.map(p => `<li style="margin: 4px 0;">${p}</li>`).join("")}</ul>`
      : `<p style="color: #666666;">View access to project information</p>`;

    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Client Portal Invitation</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f5f5f5; margin: 0; padding: 20px;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <div style="background-color: #1a365d; padding: 24px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 24px;">Client Portal Invitation</h1>
    </div>
    <div style="padding: 32px 24px;">
      <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
        Hi ${name.trim()},
      </p>
      <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
        ${inviterName} from <strong>${orgName}</strong> has invited you to access the client portal for project <strong>${existingProject.name}</strong>.
      </p>
      <div style="background-color: #f8f9fa; border-radius: 6px; padding: 16px; margin: 16px 0;">
        <p style="color: #333333; font-size: 14px; margin: 0 0 8px;"><strong>Access Level:</strong> ${accessLabel}</p>
        <p style="color: #333333; font-size: 14px; margin: 0 0 4px;"><strong>You can view:</strong></p>
        ${permissionsHtml}
      </div>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${portalLink}" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-size: 16px; font-weight: 600;">
          View Project Portal
        </a>
      </div>
      <p style="color: #666666; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
        If you have questions, please reach out to your project team directly.
      </p>
    </div>
    <div style="background-color: #f8f9fa; padding: 16px 24px; text-align: center; border-top: 1px solid #e5e7eb;">
      <p style="color: #999999; font-size: 12px; margin: 0;">
        Sent via SmartManageAI Construction Management Platform
      </p>
    </div>
  </div>
</body>
</html>`;

    try {
      await sendEmail({
        to: email.trim().toLowerCase(),
        subject: `Client Portal Invitation - ${existingProject.name}`,
        html: emailHtml,
        text: `Hi ${name.trim()}, ${inviterName} from ${orgName} has invited you to access the client portal for project "${existingProject.name}". Your access level: ${accessLabel}. Visit: ${portalLink}`,
      });
    } catch (emailErr) {
      console.error("Failed to send portal invitation email:", emailErr);
    }

    res.status(201).json({
      id: newAccess.id,
      projectId: newAccess.projectId,
      projectName: existingProject.name,
      email: newAccess.email,
      name: newAccess.name,
      accessType: newAccess.accessType,
      permissions: parsedPermissions,
      isActive: newAccess.isActive,
      createdAt: newAccess.createdAt.toISOString(),
    });
  } catch (error) {
    console.error("Error creating portal invitation:", error);
    res.status(500).json({ error: "Failed to send invitation" });
  }
});

router.patch("/client-portal/access/:id", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const orgId = req.user?.organizationId;
    if (!userId || !orgId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const accessId = req.params.id;

    const [existing] = await db
      .select()
      .from(clientPortalAccess)
      .where(
        and(
          eq(clientPortalAccess.id, accessId),
          eq(clientPortalAccess.organizationId, orgId)
        )
      )
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Portal access not found" });
    }

    const updates: Record<string, any> = {};
    if (req.body.accessType) updates.accessType = req.body.accessType;
    if (req.body.permissions) updates.permissionsJson = JSON.stringify(req.body.permissions);
    if (typeof req.body.isActive === "boolean") updates.isActive = req.body.isActive;
    if (req.body.name) updates.name = req.body.name;

    const [updated] = await db
      .update(clientPortalAccess)
      .set(updates)
      .where(eq(clientPortalAccess.id, accessId))
      .returning();

    res.json({
      id: updated.id,
      accessType: updated.accessType,
      isActive: updated.isActive,
      name: updated.name,
    });
  } catch (error) {
    console.error("Error updating portal access:", error);
    res.status(500).json({ error: "Failed to update portal access" });
  }
});

router.delete("/client-portal/access/:id", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const orgId = req.user?.organizationId;
    if (!userId || !orgId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const accessId = req.params.id;

    const [existing] = await db
      .select()
      .from(clientPortalAccess)
      .where(
        and(
          eq(clientPortalAccess.id, accessId),
          eq(clientPortalAccess.organizationId, orgId)
        )
      )
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Portal access not found" });
    }

    await db
      .delete(clientPortalAccess)
      .where(eq(clientPortalAccess.id, accessId));

    res.json({ success: true, message: "Portal access revoked" });
  } catch (error) {
    console.error("Error revoking portal access:", error);
    res.status(500).json({ error: "Failed to revoke portal access" });
  }
});

router.post("/client-portal/public/verify", authLimiter, async (req, res) => {
  try {
    const { projectId, email } = req.body;

    if (!projectId || !email) {
      return res.status(400).json({ error: "Project ID and email are required" });
    }

    const [access] = await db
      .select({
        access: clientPortalAccess,
        projectName: projects.name,
        projectStatus: projects.status,
        orgName: organizations.name,
      })
      .from(clientPortalAccess)
      .leftJoin(projects, eq(clientPortalAccess.projectId, projects.id))
      .leftJoin(organizations, eq(clientPortalAccess.organizationId, organizations.id))
      .where(
        and(
          eq(clientPortalAccess.projectId, projectId),
          eq(clientPortalAccess.email, email.trim().toLowerCase()),
          eq(clientPortalAccess.isActive, true)
        )
      )
      .limit(1);

    if (!access) {
      return res.status(403).json({ error: "No portal access found for this email" });
    }

    let permissions = {
      viewProgress: true,
      viewPhotos: true,
      viewSchedule: true,
      viewDocuments: false,
      viewChangeOrders: false,
      viewInvoices: false,
      submitRequests: false,
    };
    try {
      if (access.access.permissionsJson) {
        permissions = { ...permissions, ...JSON.parse(access.access.permissionsJson) };
      }
    } catch {}

    await db
      .update(clientPortalAccess)
      .set({ lastAccessedAt: new Date() })
      .where(eq(clientPortalAccess.id, access.access.id));

    res.json({
      verified: true,
      accessId: access.access.id,
      projectName: access.projectName || "Unknown Project",
      projectStatus: access.projectStatus || "ACTIVE",
      organizationName: access.orgName || "",
      accessType: access.access.accessType || "STAKEHOLDER",
      name: access.access.name || "",
      permissions,
    });
  } catch (error) {
    console.error("Error verifying portal access:", error);
    res.status(500).json({ error: "Failed to verify portal access" });
  }
});

router.post("/client-portal/public/data", authLimiter, async (req, res) => {
  try {
    const { projectId, email } = req.body;

    if (!projectId || !email) {
      return res.status(400).json({ error: "Project ID and email are required" });
    }

    const [access] = await db
      .select()
      .from(clientPortalAccess)
      .where(
        and(
          eq(clientPortalAccess.projectId, projectId),
          eq(clientPortalAccess.email, email.trim().toLowerCase()),
          eq(clientPortalAccess.isActive, true)
        )
      )
      .limit(1);

    if (!access) {
      return res.status(403).json({ error: "No portal access" });
    }

    let permissions = {
      viewProgress: true,
      viewPhotos: true,
      viewSchedule: true,
      viewDocuments: false,
      viewChangeOrders: false,
      viewInvoices: false,
      submitRequests: false,
    };
    try {
      if (access.permissionsJson) {
        permissions = { ...permissions, ...JSON.parse(access.permissionsJson) };
      }
    } catch {}

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const result: Record<string, any> = {
      project: {
        name: project.name,
        status: project.status,
        startDate: project.startDate,
        endDate: project.endDate,
        address: project.locationAddress,
        city: project.city,
        state: project.state,
      },
    };

    if (permissions.viewProgress) {
      const progressItems = await db
        .select()
        .from(scopeItems)
        .where(eq(scopeItems.projectId, projectId))
        .orderBy(desc(scopeItems.updatedAt));

      result.progress = progressItems.map((item) => ({
        description: item.description,
        status: item.billingStatus || "NOT_STARTED",
        completionPercentage: item.completedQuantity && item.totalQuantity
          ? Math.round((parseFloat(item.completedQuantity) / parseFloat(item.totalQuantity)) * 100)
          : 0,
        updatedAt: item.updatedAt,
      }));
    }

    if (permissions.viewPhotos) {
      const photos = await db
        .select()
        .from(media)
        .where(eq(media.projectId, projectId))
        .orderBy(desc(media.uploadedAt))
        .limit(50);

      result.photos = photos.map((p) => ({
        id: p.id,
        fileName: p.fileName,
        fileUrl: p.fileUrl,
        fileType: p.mimeType,
        description: p.caption,
        createdAt: p.uploadedAt,
      }));
    }

    if (permissions.viewSchedule) {
      const schedules = await db
        .select()
        .from(projectSchedules)
        .where(eq(projectSchedules.projectId, projectId))
        .limit(1);

      if (schedules.length > 0) {
        const tasks = await db
          .select()
          .from(projectScheduleTasks)
          .where(eq(projectScheduleTasks.scheduleId, schedules[0].id))
          .orderBy(projectScheduleTasks.plannedStartDate);

        result.schedule = tasks.map((t) => ({
          name: t.name,
          startDate: t.plannedStartDate,
          endDate: t.plannedEndDate,
          status: t.status,
          progress: t.percentComplete,
        }));
      }
    }

    if (permissions.viewDocuments) {
      const docs = await db
        .select()
        .from(planDocuments)
        .where(eq(planDocuments.projectId, projectId))
        .orderBy(desc(planDocuments.uploadedAt))
        .limit(100);

      result.documents = docs.map((d) => ({
        id: d.id,
        title: d.title,
        fileName: d.fileName,
        fileUrl: d.fileUrl,
        type: d.type,
        mimeType: d.mimeType,
        fileSize: d.fileSize,
        uploadedAt: d.uploadedAt,
      }));
    }

    if (permissions.viewChangeOrders) {
      const cos = await db
        .select()
        .from(changeOrders)
        .where(
          and(
            eq(changeOrders.projectId, projectId),
            inArray(changeOrders.status, ["PENDING_APPROVAL", "SUBMITTED", "APPROVED", "REJECTED"])
          )
        )
        .orderBy(desc(changeOrders.createdAt))
        .limit(100);

      const coIds = cos.map(co => co.id);
      let attachmentsByCoId: Record<string, Array<{ id: string; fileName: string; fileSize: number | null; mimeType: string | null; storageKey: string }>> = {};
      if (coIds.length > 0) {
        const attachments = await db
          .select({
            id: changeOrderAttachments.id,
            changeOrderId: changeOrderAttachments.changeOrderId,
            fileName: changeOrderAttachments.fileName,
            fileSize: changeOrderAttachments.fileSize,
            mimeType: changeOrderAttachments.mimeType,
            storageKey: changeOrderAttachments.storageKey,
          })
          .from(changeOrderAttachments)
          .where(inArray(changeOrderAttachments.changeOrderId, coIds));

        for (const att of attachments) {
          if (!attachmentsByCoId[att.changeOrderId]) {
            attachmentsByCoId[att.changeOrderId] = [];
          }
          attachmentsByCoId[att.changeOrderId].push({
            id: att.id,
            fileName: att.fileName,
            fileSize: att.fileSize,
            mimeType: att.mimeType,
            storageKey: att.storageKey,
          });
        }
      }

      result.changeOrders = cos.map((co) => {
        let costBreakdown = null;
        if (co.costBreakdownJson) {
          try {
            const raw = JSON.parse(co.costBreakdownJson);
            costBreakdown = {
              labor: raw.labor || 0,
              material: raw.material || 0,
              equipment: raw.equipment || 0,
              subcontractor: raw.subcontractor || 0,
              total: raw.total || Number(co.amount) || 0,
            };
          } catch {}
        }
        return {
          id: co.id,
          changeOrderNumber: co.changeOrderNumber,
          description: co.description,
          amount: co.amount,
          status: co.status,
          submittedAt: co.submittedAt,
          approvedAt: co.approvedAt,
          createdAt: co.createdAt,
          clientResponseDueDate: co.clientResponseDueDate,
          costBreakdown,
          attachments: attachmentsByCoId[co.id] || [],
        };
      });
    }

    if (permissions.viewInvoices) {
      const invoices = await db
        .select()
        .from(tmInvoices)
        .where(
          and(
            eq(tmInvoices.projectId, projectId),
            ne(tmInvoices.status, "DRAFT")
          )
        )
        .orderBy(desc(tmInvoices.invoiceDate))
        .limit(100);

      result.payments = invoices.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate,
        dueDate: inv.dueDate,
        total: inv.total,
        subtotal: inv.subtotal,
        taxAmount: inv.taxAmount,
        status: inv.status,
        sentAt: inv.sentAt,
        paidAt: inv.paidAt,
        pdfUrl: inv.pdfUrl,
      }));
    }

    res.json(result);
  } catch (error) {
    console.error("Error fetching portal data:", error);
    res.status(500).json({ error: "Failed to fetch portal data" });
  }
});

async function verifyPortalAccess(projectId: string, email: string) {
  const [access] = await db
    .select()
    .from(clientPortalAccess)
    .where(
      and(
        eq(clientPortalAccess.projectId, projectId),
        eq(clientPortalAccess.email, email.trim().toLowerCase()),
        eq(clientPortalAccess.isActive, true)
      )
    )
    .limit(1);

  if (!access) return null;

  let permissions = {
    viewProgress: true,
    viewPhotos: true,
    viewSchedule: true,
    viewDocuments: false,
    viewChangeOrders: false,
    viewInvoices: false,
    submitRequests: false,
  };
  try {
    if (access.permissionsJson) {
      permissions = { ...permissions, ...JSON.parse(access.permissionsJson) };
    }
  } catch {}

  return { access, permissions };
}

router.get("/client-portal/public/change-orders/:coId/comments", authLimiter, async (req, res) => {
  try {
    const { coId } = req.params;
    const projectId = req.headers["x-client-project-id"] as string;
    const email = req.headers["x-client-email"] as string;

    if (!projectId || !email) {
      return res.status(400).json({ error: "Missing portal credentials" });
    }

    const verified = await verifyPortalAccess(projectId, email);
    if (!verified || !verified.permissions.viewChangeOrders) {
      return res.status(403).json({ error: "Access denied" });
    }

    const [co] = await db
      .select({ id: changeOrders.id })
      .from(changeOrders)
      .where(and(eq(changeOrders.id, coId), eq(changeOrders.projectId, projectId)))
      .limit(1);

    if (!co) {
      return res.status(404).json({ error: "Change order not found" });
    }

    const comments = await db
      .select()
      .from(changeOrderComments)
      .where(and(eq(changeOrderComments.changeOrderId, coId), eq(changeOrderComments.isInternal, false)))
      .orderBy(asc(changeOrderComments.createdAt));

    res.json(comments);
  } catch (error) {
    console.error("Error fetching CO comments:", error);
    res.status(500).json({ error: "Failed to fetch comments" });
  }
});

router.post("/client-portal/public/change-orders/:coId/comments", authLimiter, async (req, res) => {
  try {
    const { coId } = req.params;
    const projectId = req.headers["x-client-project-id"] as string;
    const email = req.headers["x-client-email"] as string;

    if (!projectId || !email) {
      return res.status(400).json({ error: "Missing portal credentials" });
    }

    const verified = await verifyPortalAccess(projectId, email);
    if (!verified || !verified.permissions.viewChangeOrders) {
      return res.status(403).json({ error: "Access denied" });
    }

    const { message } = req.body;
    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return res.status(400).json({ error: "Message is required" });
    }

    const [co] = await db
      .select({ id: changeOrders.id })
      .from(changeOrders)
      .where(and(eq(changeOrders.id, coId), eq(changeOrders.projectId, projectId)))
      .limit(1);

    if (!co) {
      return res.status(404).json({ error: "Change order not found" });
    }

    const [comment] = await db
      .insert(changeOrderComments)
      .values({
        changeOrderId: coId,
        authorName: verified.access.name || email.split("@")[0],
        authorEmail: email,
        authorType: "CLIENT",
        message: message.trim().substring(0, 2000),
        isInternal: false,
      })
      .returning();

    res.json(comment);
  } catch (error) {
    console.error("Error posting CO comment:", error);
    res.status(500).json({ error: "Failed to post comment" });
  }
});

router.post("/client-portal/public/change-orders/:coId/acknowledge", authLimiter, async (req, res) => {
  try {
    const { coId } = req.params;
    const projectId = req.headers["x-client-project-id"] as string;
    const email = req.headers["x-client-email"] as string;

    if (!projectId || !email) {
      return res.status(400).json({ error: "Missing portal credentials" });
    }

    const verified = await verifyPortalAccess(projectId, email);
    if (!verified || !verified.permissions.viewChangeOrders || !verified.permissions.submitRequests) {
      return res.status(403).json({ error: "Access denied — you do not have permission to respond to change orders" });
    }

    const [co] = await db
      .select()
      .from(changeOrders)
      .where(and(eq(changeOrders.id, coId), eq(changeOrders.projectId, projectId)))
      .limit(1);

    if (!co) {
      return res.status(404).json({ error: "Change order not found" });
    }

    if (co.status !== "SUBMITTED") {
      return res.status(400).json({ error: "Only submitted change orders can be acknowledged" });
    }

    const [updated] = await db
      .update(changeOrders)
      .set({ status: "APPROVED", approvedAt: new Date(), updatedAt: new Date() })
      .where(eq(changeOrders.id, coId))
      .returning();

    await db.insert(changeOrderComments).values({
      changeOrderId: coId,
      authorName: verified.access.name || email.split("@")[0],
      authorEmail: email,
      authorType: "CLIENT",
      message: "Change order acknowledged and approved by client.",
      isInternal: false,
    });

    const [maxRev] = await db
      .select({ maxNum: sql<number>`COALESCE(MAX(${changeOrderRevisions.revisionNumber}), 0)` })
      .from(changeOrderRevisions)
      .where(eq(changeOrderRevisions.changeOrderId, coId));

    await db.insert(changeOrderRevisions).values({
      changeOrderId: coId,
      revisionNumber: (maxRev?.maxNum || 0) + 1,
      previousStatus: "SUBMITTED",
      newStatus: "APPROVED",
      amount: co.amount,
      description: `Client acknowledged via portal (${email})`,
      revisedById: null,
    });

    try {
      const [project] = await db
        .select({ gcOrganizationId: projects.gcOrganizationId })
        .from(projects)
        .where(eq(projects.id, projectId));

      if (project?.gcOrganizationId) {
        const teamMembers = await db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.organizationId, project.gcOrganizationId), eq(users.isActive, true), inArray(users.role, ["ADMIN", "MANAGER"])));

        if (teamMembers.length > 0) {
          await insertNotifications(teamMembers.map(u => ({
            userId: u.id,
            type: "GENERAL" as const,
            title: "Change Order Acknowledged by Client",
            message: `CO #${updated.changeOrderNumber} has been acknowledged and approved by ${verified.access.name || email} via the client portal.`,
            relatedEntityId: coId,
            relatedEntityType: "change_order" as const,
          })));
        }
      }
    } catch (notifError) {
      console.error("Failed to send CO acknowledgment notifications:", notifError);
    }

    res.json(updated);
  } catch (error) {
    console.error("Error acknowledging CO:", error);
    res.status(500).json({ error: "Failed to acknowledge change order" });
  }
});

router.post("/client-portal/public/change-orders/:coId/request-revision", authLimiter, async (req, res) => {
  try {
    const { coId } = req.params;
    const projectId = req.headers["x-client-project-id"] as string;
    const email = req.headers["x-client-email"] as string;

    if (!projectId || !email) {
      return res.status(400).json({ error: "Missing portal credentials" });
    }

    const verified = await verifyPortalAccess(projectId, email);
    if (!verified || !verified.permissions.viewChangeOrders || !verified.permissions.submitRequests) {
      return res.status(403).json({ error: "Access denied — you do not have permission to respond to change orders" });
    }

    const { reason } = req.body;
    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      return res.status(400).json({ error: "Reason is required" });
    }

    const [co] = await db
      .select()
      .from(changeOrders)
      .where(and(eq(changeOrders.id, coId), eq(changeOrders.projectId, projectId)))
      .limit(1);

    if (!co) {
      return res.status(404).json({ error: "Change order not found" });
    }

    if (co.status !== "SUBMITTED") {
      return res.status(400).json({ error: "Only submitted change orders can be revised" });
    }

    const [updated] = await db
      .update(changeOrders)
      .set({ status: "PCO", updatedAt: new Date() })
      .where(eq(changeOrders.id, coId))
      .returning();

    await db.insert(changeOrderComments).values({
      changeOrderId: coId,
      authorName: verified.access.name || email.split("@")[0],
      authorEmail: email,
      authorType: "CLIENT",
      message: `Revision requested: ${reason.trim().substring(0, 2000)}`,
      isInternal: false,
    });

    const [maxRev] = await db
      .select({ maxNum: sql<number>`COALESCE(MAX(${changeOrderRevisions.revisionNumber}), 0)` })
      .from(changeOrderRevisions)
      .where(eq(changeOrderRevisions.changeOrderId, coId));

    await db.insert(changeOrderRevisions).values({
      changeOrderId: coId,
      revisionNumber: (maxRev?.maxNum || 0) + 1,
      previousStatus: "SUBMITTED",
      newStatus: "PCO",
      amount: co.amount,
      description: `Client requested revision via portal (${email}): ${reason.trim().substring(0, 500)}`,
      revisedById: null,
    });

    try {
      const [project] = await db
        .select({ gcOrganizationId: projects.gcOrganizationId })
        .from(projects)
        .where(eq(projects.id, projectId));

      if (project?.gcOrganizationId) {
        const teamMembers = await db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.organizationId, project.gcOrganizationId), eq(users.isActive, true), inArray(users.role, ["ADMIN", "MANAGER"])));

        if (teamMembers.length > 0) {
          await insertNotifications(teamMembers.map(u => ({
            userId: u.id,
            type: "GENERAL" as const,
            title: "Client Requested Change Order Revision",
            message: `${verified.access.name || email} requested a revision on CO #${updated.changeOrderNumber} via the client portal: "${reason.trim().substring(0, 200)}"`,
            relatedEntityId: coId,
            relatedEntityType: "change_order" as const,
          })));
        }
      }
    } catch (notifError) {
      console.error("Failed to send CO revision request notifications:", notifError);
    }

    res.json(updated);
  } catch (error) {
    console.error("Error requesting CO revision:", error);
    res.status(500).json({ error: "Failed to request revision" });
  }
});

router.get("/client-portal/public/change-orders/:coId/attachments/:attachmentId/download", async (req, res) => {
  try {
    const email = req.headers["x-client-email"] as string;
    const projectId = req.headers["x-client-project-id"] as string;
    if (!email || !projectId) {
      return res.status(401).json({ error: "Missing portal credentials" });
    }

    const verified = await verifyPortalAccess(projectId, email);
    if (!verified || !verified.permissions.viewChangeOrders) {
      return res.status(403).json({ error: "Access denied" });
    }

    const coId = req.params.coId;
    const attachmentId = req.params.attachmentId;

    const [co] = await db
      .select({ id: changeOrders.id })
      .from(changeOrders)
      .where(
        and(
          eq(changeOrders.id, coId),
          eq(changeOrders.projectId, projectId)
        )
      );

    if (!co) {
      return res.status(404).json({ error: "Change order not found" });
    }

    const [attachment] = await db
      .select()
      .from(changeOrderAttachments)
      .where(
        and(
          eq(changeOrderAttachments.id, attachmentId),
          eq(changeOrderAttachments.changeOrderId, coId)
        )
      );

    if (!attachment) {
      return res.status(404).json({ error: "Attachment not found" });
    }

    const objectStorageService = new ObjectStorageService();
    const objectFile = await objectStorageService.getObjectEntityFile(attachment.storageKey);

    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(attachment.fileName)}"`);

    await objectStorageService.downloadObject(objectFile, res, 0);
  } catch (error) {
    console.error("Error downloading portal CO attachment:", error);
    res.status(500).json({ error: "Failed to download attachment" });
  }
});

export default router;
