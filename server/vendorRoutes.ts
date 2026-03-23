import { Router } from "express";
import { db } from "./db";
import { insertNotification } from "./services/notificationService";
import { crmOrganisations, vendorEnrollments, vendorUsers, vendorPricingCatalogs, auditLog, users, organizations, notifications, pricebookImportJobs, insertVendorPricingCatalogSchema, rentalEquipmentCatalog, insertRentalEquipmentCatalogSchema, vendorPricebooks, vendorPricebookItems } from "@shared/schema";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest, requireFeaturePermission } from "./auth";
import { sendEmail } from "./email";
import { logAudit } from "./auditLogger";
import { logInfo, logError } from "./utils/logger";
import { z } from "zod";
import multer from "multer";
import { getOrgIdForFilter } from "./orgFilter";

const router = Router();

// ========================================
// Routes from vendorEnrollmentRoutes.ts
// ========================================

router.get("/api/vendor-enrollments", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: "Organization not found" });
    }

    const enrollments = await db
      .select({
        id: vendorEnrollments.id,
        vendorCrmOrgId: vendorEnrollments.vendorCrmOrgId,
        contractorOrgId: vendorEnrollments.contractorOrgId,
        status: vendorEnrollments.status,
        autoApproveNewPricing: vendorEnrollments.autoApproveNewPricing,
        notifyOnPriceUpdate: vendorEnrollments.notifyOnPriceUpdate,
        invitedAt: vendorEnrollments.invitedAt,
        enrolledAt: vendorEnrollments.enrolledAt,
        enrolledCategories: vendorEnrollments.enrolledCategories,
        notes: vendorEnrollments.notes,
        vendorName: crmOrganisations.name,
        vendorType: crmOrganisations.type,
        vendorCity: crmOrganisations.city,
        vendorState: crmOrganisations.state,
      })
      .from(vendorEnrollments)
      .innerJoin(crmOrganisations, eq(crmOrganisations.id, vendorEnrollments.vendorCrmOrgId))
      .where(eq(vendorEnrollments.contractorOrgId, organizationId))
      .orderBy(crmOrganisations.name);

    res.json(enrollments);
  } catch (error) {
    console.error("Get vendor enrollments error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/vendor-enrollments", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: "Organization not found" });
    }

    const { vendorCrmOrgId, enrolledCategories, autoApproveNewPricing, notifyOnPriceUpdate, notes } = req.body;

    const [vendor] = await db.select().from(crmOrganisations).where(eq(crmOrganisations.id, vendorCrmOrgId)).limit(1);
    if (!vendor) {
      return res.status(404).json({ error: "Vendor not found" });
    }
    if (vendor.type !== "VENDOR" && vendor.type !== "SUPPLIER") {
      return res.status(400).json({ error: "Organization must be a Vendor or Supplier type" });
    }

    const enrollmentCode = `VE-${organizationId.slice(0, 4)}-${vendorCrmOrgId.slice(0, 4)}-${Date.now().toString(36)}`.toUpperCase();

    const [enrollment] = await db.insert(vendorEnrollments).values({
      vendorCrmOrgId,
      contractorOrgId: organizationId,
      status: "PENDING",
      autoApproveNewPricing: autoApproveNewPricing || false,
      notifyOnPriceUpdate: notifyOnPriceUpdate !== false,
      invitedByUserId: req.user!.id,
      enrolledCategories: enrolledCategories || [],
      enrollmentCode,
      notes,
    }).returning();

    await db.insert(auditLog).values({
      userId: req.user!.id,
      action: "CREATE",
      entityType: "vendor_enrollment",
      entityId: enrollment.id,
      newValue: JSON.stringify({ vendorName: vendor.name, status: "PENDING" }),
    });

    res.status(201).json({ ...enrollment, vendorName: vendor.name });
  } catch (error: any) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Vendor is already enrolled" });
    }
    console.error("Create vendor enrollment error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/api/vendor-enrollments/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: "Organization not found" });
    }

    const [existing] = await db.select().from(vendorEnrollments)
      .where(and(eq(vendorEnrollments.id, req.params.id), eq(vendorEnrollments.contractorOrgId, organizationId)))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Enrollment not found" });
    }

    const { status, autoApproveNewPricing, notifyOnPriceUpdate, enrolledCategories, notes } = req.body;

    const [updated] = await db
      .update(vendorEnrollments)
      .set({
        ...(status && { status }),
        ...(autoApproveNewPricing !== undefined && { autoApproveNewPricing }),
        ...(notifyOnPriceUpdate !== undefined && { notifyOnPriceUpdate }),
        ...(enrolledCategories && { enrolledCategories }),
        ...(notes !== undefined && { notes }),
        ...(status === "ACTIVE" && !existing.enrolledAt && { enrolledAt: new Date() }),
        updatedAt: new Date(),
      })
      .where(eq(vendorEnrollments.id, req.params.id))
      .returning();

    res.json(updated);
  } catch (error) {
    console.error("Update vendor enrollment error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/api/vendor-enrollments/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: "Organization not found" });
    }

    const [existing] = await db.select().from(vendorEnrollments)
      .where(and(eq(vendorEnrollments.id, req.params.id), eq(vendorEnrollments.contractorOrgId, organizationId)))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Enrollment not found" });
    }

    await db.delete(vendorEnrollments).where(eq(vendorEnrollments.id, req.params.id));

    res.json({ success: true });
  } catch (error) {
    console.error("Delete vendor enrollment error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/vendor-enrollments/by-crm-org/:crmOrgId", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: "Organization not found" });
    }

    const [enrollment] = await db
      .select({
        id: vendorEnrollments.id,
        vendorCrmOrganisationId: vendorEnrollments.vendorCrmOrgId,
        contractorOrganizationId: vendorEnrollments.contractorOrgId,
        status: vendorEnrollments.status,
        autoApproveNewPricing: vendorEnrollments.autoApproveNewPricing,
        invitedAt: vendorEnrollments.invitedAt,
        enrolledAt: vendorEnrollments.enrolledAt,
        suspendedAt: vendorEnrollments.updatedAt,
        vendorName: crmOrganisations.name,
      })
      .from(vendorEnrollments)
      .innerJoin(crmOrganisations, eq(crmOrganisations.id, vendorEnrollments.vendorCrmOrgId))
      .where(and(
        eq(vendorEnrollments.vendorCrmOrgId, req.params.crmOrgId),
        eq(vendorEnrollments.contractorOrgId, organizationId)
      ))
      .limit(1);

    if (enrollment) {
      const [vendorUser] = await db.select({ email: users.email })
        .from(vendorUsers)
        .innerJoin(users, eq(users.id, vendorUsers.userId))
        .where(and(
          eq(vendorUsers.crmOrganisationId, req.params.crmOrgId),
          eq(vendorUsers.isActive, true)
        ))
        .limit(1);

      res.json({
        ...enrollment,
        vendorUserEmail: vendorUser?.email || null,
      });
    } else {
      res.json(null);
    }
  } catch (error) {
    console.error("Get enrollment by CRM org error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/vendor-enrollments/invite", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: "Organization not found" });
    }

    const { vendorCrmOrganisationId, vendorEmail, autoApproveNewPricing } = req.body;

    if (!vendorCrmOrganisationId || !vendorEmail) {
      return res.status(400).json({ error: "Vendor CRM organization ID and email are required" });
    }

    const [vendor] = await db.select().from(crmOrganisations)
      .where(eq(crmOrganisations.id, vendorCrmOrganisationId))
      .limit(1);
    if (!vendor) {
      return res.status(404).json({ error: "Vendor not found" });
    }
    if (vendor.type !== "VENDOR" && vendor.type !== "SUPPLIER") {
      return res.status(400).json({ error: "Organization must be a Vendor or Supplier type" });
    }

    const [existing] = await db.select().from(vendorEnrollments)
      .where(and(
        eq(vendorEnrollments.vendorCrmOrgId, vendorCrmOrganisationId),
        eq(vendorEnrollments.contractorOrgId, organizationId)
      ))
      .limit(1);

    if (existing) {
      return res.status(409).json({ error: "Vendor is already enrolled or invited" });
    }

    const enrollmentCode = `VE-${organizationId.slice(0, 4)}-${vendorCrmOrganisationId.slice(0, 4)}-${Date.now().toString(36)}`.toUpperCase();

    const [contractorOrg] = await db.select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    const contractorName = contractorOrg?.name || "A contractor";

    const [enrollment] = await db.insert(vendorEnrollments).values({
      vendorCrmOrgId: vendorCrmOrganisationId,
      contractorOrgId: organizationId,
      status: "PENDING",
      autoApproveNewPricing: autoApproveNewPricing || false,
      notifyOnPriceUpdate: true,
      invitedByUserId: req.user!.id,
      enrollmentCode,
    }).returning();

    try {
      const acceptLink = `${process.env.REPLIT_DEV_DOMAIN || 'https://smartmanage.app'}/vendor/accept?code=${enrollmentCode}`;
      const emailSent = await sendEmail({
        to: vendorEmail,
        subject: `Vendor Portal Invitation from ${contractorName}`,
        html: `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Vendor Portal Invitation</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f5f5f5; margin: 0; padding: 20px;">
<div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
  <div style="background-color: #1a365d; padding: 24px; text-align: center;">
    <h1 style="color: #ffffff; margin: 0; font-size: 24px;">Vendor Portal Invitation</h1>
  </div>
  <div style="padding: 32px 24px;">
    <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
      You have been invited by <strong>${contractorName}</strong> to join their vendor portal on SmartManageAI.
    </p>
    <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
      As a vendor, you'll be able to:
    </p>
    <ul style="color: #333333; font-size: 14px; line-height: 1.8; margin: 0 0 24px; padding-left: 20px;">
      <li>Submit and update material pricing</li>
      <li>View enrolled contractor clients</li>
      <li>Manage your vendor profile</li>
    </ul>
    <div style="text-align: center; margin: 32px 0;">
      <a href="${acceptLink}" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-size: 16px; font-weight: 600;">
        Accept Invitation
      </a>
    </div>
    <p style="color: #666666; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
      Your enrollment code: <strong>${enrollmentCode}</strong>
    </p>
    <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;">
    <p style="color: #999999; font-size: 12px; line-height: 1.6; margin: 0;">
      If you didn't expect this invitation, you can safely ignore this email.
    </p>
  </div>
  <div style="background-color: #f9fafb; padding: 16px 24px; text-align: center;">
    <p style="color: #999999; font-size: 12px; margin: 0;">
      SmartManageAI Construction Management Platform
    </p>
  </div>
</div>
</body>
</html>`,
        text: `
Vendor Portal Invitation

You have been invited by ${contractorName} to join their vendor portal on SmartManageAI.

As a vendor, you'll be able to:
- Submit and update material pricing
- View enrolled contractor clients  
- Manage your vendor profile

Accept the invitation here: ${acceptLink}

Your enrollment code: ${enrollmentCode}

If you didn't expect this invitation, you can safely ignore this email.

---
SmartManageAI Construction Management Platform
`,
      });
      console.log(`Vendor invitation email ${emailSent ? 'sent' : 'logged'} to: ${vendorEmail}`);
    } catch (emailError) {
      console.error("Failed to send vendor invitation email:", emailError);
    }

    await db.insert(auditLog).values({
      userId: req.user!.id,
      action: "CREATE",
      entityType: "vendor_enrollment",
      entityId: enrollment.id,
      newValue: JSON.stringify({ vendorName: vendor.name, vendorEmail, status: "PENDING" }),
    });

    res.status(201).json({
      ...enrollment,
      vendorName: vendor.name,
      message: `Invitation will be sent to ${vendorEmail}`,
    });
  } catch (error) {
    console.error("Invite vendor error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/api/vendor-enrollments/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: "Organization not found" });
    }

    const [existing] = await db.select().from(vendorEnrollments)
      .where(and(eq(vendorEnrollments.id, req.params.id), eq(vendorEnrollments.contractorOrgId, organizationId)))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Enrollment not found" });
    }

    const { autoApproveNewPricing, notifyOnPriceUpdate } = req.body;

    const [updated] = await db
      .update(vendorEnrollments)
      .set({
        ...(autoApproveNewPricing !== undefined && { autoApproveNewPricing }),
        ...(notifyOnPriceUpdate !== undefined && { notifyOnPriceUpdate }),
        updatedAt: new Date(),
      })
      .where(eq(vendorEnrollments.id, req.params.id))
      .returning();

    res.json(updated);
  } catch (error) {
    console.error("Update enrollment settings error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/vendor-enrollments/:id/suspend", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: "Organization not found" });
    }

    const [existing] = await db.select().from(vendorEnrollments)
      .where(and(eq(vendorEnrollments.id, req.params.id), eq(vendorEnrollments.contractorOrgId, organizationId)))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Enrollment not found" });
    }

    if (existing.status === "SUSPENDED") {
      return res.status(400).json({ error: "Enrollment is already suspended" });
    }

    const [updated] = await db
      .update(vendorEnrollments)
      .set({
        status: "SUSPENDED",
        updatedAt: new Date(),
      })
      .where(eq(vendorEnrollments.id, req.params.id))
      .returning();

    await db.insert(auditLog).values({
      userId: req.user!.id,
      action: "UPDATE",
      entityType: "vendor_enrollment",
      entityId: req.params.id,
      oldValue: JSON.stringify({ status: existing.status }),
      newValue: JSON.stringify({ status: "SUSPENDED" }),
    });

    res.json(updated);
  } catch (error) {
    console.error("Suspend vendor enrollment error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/vendor-enrollments/:id/reactivate", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: "Organization not found" });
    }

    const [existing] = await db.select().from(vendorEnrollments)
      .where(and(eq(vendorEnrollments.id, req.params.id), eq(vendorEnrollments.contractorOrgId, organizationId)))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Enrollment not found" });
    }

    if (existing.status === "ACTIVE") {
      return res.status(400).json({ error: "Enrollment is already active" });
    }

    const [updated] = await db
      .update(vendorEnrollments)
      .set({
        status: "ACTIVE",
        enrolledAt: existing.enrolledAt || new Date(),
        updatedAt: new Date(),
      })
      .where(eq(vendorEnrollments.id, req.params.id))
      .returning();

    await db.insert(auditLog).values({
      userId: req.user!.id,
      action: "UPDATE",
      entityType: "vendor_enrollment",
      entityId: req.params.id,
      oldValue: JSON.stringify({ status: existing.status }),
      newValue: JSON.stringify({ status: "ACTIVE" }),
    });

    res.json(updated);
  } catch (error) {
    console.error("Reactivate vendor enrollment error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/vendor/portal", requireAuth, requireRole("VENDOR"), async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const [vendorUser] = await db.select().from(vendorUsers)
      .where(and(eq(vendorUsers.userId, userId), eq(vendorUsers.isActive, true)))
      .limit(1);

    if (!vendorUser) {
      return res.status(403).json({ error: "Vendor account not linked to any organization" });
    }

    const [crmOrg] = await db.select().from(crmOrganisations)
      .where(eq(crmOrganisations.id, vendorUser.crmOrganisationId))
      .limit(1);

    if (!crmOrg) {
      return res.status(404).json({ error: "Vendor organization not found" });
    }

    const enrollments = await db
      .select({
        id: vendorEnrollments.id,
        contractorOrgId: vendorEnrollments.contractorOrgId,
        status: vendorEnrollments.status,
        autoApproveNewPricing: vendorEnrollments.autoApproveNewPricing,
        enrolledAt: vendorEnrollments.enrolledAt,
        enrolledCategories: vendorEnrollments.enrolledCategories,
        contractorName: organizations.name,
        contractorRegion: organizations.region,
      })
      .from(vendorEnrollments)
      .innerJoin(organizations, eq(organizations.id, vendorEnrollments.contractorOrgId))
      .where(and(
        eq(vendorEnrollments.vendorCrmOrgId, vendorUser.crmOrganisationId),
        eq(vendorEnrollments.status, "ACTIVE")
      ));

    res.json({
      vendor: {
        id: crmOrg.id,
        name: crmOrg.name,
        type: crmOrg.type,
        city: crmOrg.city,
        state: crmOrg.state,
      },
      permissions: {
        canSubmitPricing: vendorUser.canSubmitPricing,
        canViewEnrollments: vendorUser.canViewEnrollments,
        canManageUsers: vendorUser.canManageUsers,
        isPrimaryContact: vendorUser.isPrimaryContact,
      },
      enrolledClients: enrollments,
    });
  } catch (error) {
    console.error("Get vendor portal error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/vendor/enrollments", requireAuth, requireRole("VENDOR"), async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const [vendorUser] = await db.select().from(vendorUsers)
      .where(and(eq(vendorUsers.userId, userId), eq(vendorUsers.isActive, true)))
      .limit(1);

    if (!vendorUser) {
      return res.json([]);
    }

    const enrollments = await db
      .select({
        id: vendorEnrollments.id,
        vendorId: vendorEnrollments.vendorCrmOrgId,
        contractorOrgId: vendorEnrollments.contractorOrgId,
        contractorOrgName: organizations.name,
        status: vendorEnrollments.status,
        autoApproveNewPricing: vendorEnrollments.autoApproveNewPricing,
        notifyOnPriceUpdate: vendorEnrollments.notifyOnPriceUpdate,
        enrolledAt: vendorEnrollments.enrolledAt,
        invitedByUserId: vendorEnrollments.invitedByUserId,
      })
      .from(vendorEnrollments)
      .innerJoin(organizations, eq(organizations.id, vendorEnrollments.contractorOrgId))
      .where(eq(vendorEnrollments.vendorCrmOrgId, vendorUser.crmOrganisationId))
      .orderBy(organizations.name);

    res.json(enrollments);
  } catch (error) {
    console.error("Get vendor enrollments error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/vendor/pricing", requireAuth, requireRole("VENDOR"), async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const [vendorUser] = await db.select().from(vendorUsers)
      .where(and(eq(vendorUsers.userId, userId), eq(vendorUsers.isActive, true), eq(vendorUsers.canSubmitPricing, true)))
      .limit(1);

    if (!vendorUser) {
      return res.status(403).json({ error: "No permission to submit pricing" });
    }

    const { items, targetContractorOrgIds } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "At least one pricing item is required" });
    }

    const conditions: any[] = [
      eq(vendorEnrollments.vendorCrmOrgId, vendorUser.crmOrganisationId),
      eq(vendorEnrollments.status, "ACTIVE"),
    ];
    if (targetContractorOrgIds && targetContractorOrgIds.length > 0) {
      conditions.push(sql`${vendorEnrollments.contractorOrgId} IN (${sql.join(targetContractorOrgIds.map((id: string) => sql`${id}`), sql`, `)})`);
    }

    const enrollments = await db.select().from(vendorEnrollments).where(and(...conditions));

    if (enrollments.length === 0) {
      return res.status(400).json({ error: "No active enrollments found for pricing submission" });
    }

    const now = new Date();
    const currentQuarter = `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`;
    const insertedItems: any[] = [];

    for (const enrollment of enrollments) {
      for (const item of items) {
        const approvalStatus = enrollment.autoApproveNewPricing ? "AUTO_APPROVED" : "PENDING_REVIEW";
        
        const [inserted] = await db.insert(vendorPricingCatalogs).values({
          crmOrganisationId: vendorUser.crmOrganisationId,
          organizationId: enrollment.contractorOrgId,
          itemName: item.itemName,
          itemCode: item.itemCode,
          category: item.category,
          description: item.description,
          unit: item.unit,
          unitPrice: item.unitPrice,
          minimumOrder: item.minimumOrder,
          deliveryFee: item.deliveryFee,
          effectiveQuarter: currentQuarter,
          effectiveDate: now,
          expirationDate: item.expirationDate ? new Date(item.expirationDate) : null,
          leadTimeDays: item.leadTimeDays,
          sourceType: "VENDOR_PORTAL",
          approvalStatus,
          submittedByVendorUserId: userId,
          isActive: approvalStatus === "AUTO_APPROVED",
        }).returning();

        insertedItems.push(inserted);

        if (enrollment.notifyOnPriceUpdate && enrollment.invitedByUserId) {
          await insertNotification({
            userId: enrollment.invitedByUserId,
            type: "GENERAL",
            title: "New Vendor Pricing Submitted",
            message: `Vendor has submitted ${items.length} pricing item(s) for review.`,
            isRead: false,
          });
        }
      }
    }

    res.status(201).json({
      success: true,
      itemsCreated: insertedItems.length,
      enrollmentsServed: enrollments.length,
    });
  } catch (error) {
    console.error("Submit vendor pricing error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/vendor/pricing", requireAuth, requireRole("VENDOR"), async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const [vendorUser] = await db.select().from(vendorUsers)
      .where(and(eq(vendorUsers.userId, userId), eq(vendorUsers.isActive, true)))
      .limit(1);

    if (!vendorUser) {
      return res.status(403).json({ error: "Vendor account not linked" });
    }

    const items = await db
      .select()
      .from(vendorPricingCatalogs)
      .where(eq(vendorPricingCatalogs.crmOrganisationId, vendorUser.crmOrganisationId))
      .orderBy(vendorPricingCatalogs.createdAt);

    res.json(items);
  } catch (error) {
    console.error("Get vendor pricing error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/vendor/pricing/csv-template", requireAuth, requireRole("VENDOR"), async (req: AuthRequest, res) => {
  try {
    const headers = [
      "itemName",
      "itemCode", 
      "category",
      "description",
      "unit",
      "unitPrice",
      "minimumOrder",
      "deliveryFee",
      "leadTimeDays"
    ];
    
    const sampleRow = [
      "Ready Mix Concrete 4000 PSI",
      "RMC-4000",
      "Concrete & Masonry",
      "High strength concrete for slabs and foundations",
      "CY",
      "145.00",
      "10",
      "75.00",
      "2"
    ];
    
    const csvContent = [
      headers.join(","),
      sampleRow.join(",")
    ].join("\n");
    
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=pricing_template.csv");
    res.send(csvContent);
  } catch (error) {
    console.error("Get CSV template error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/vendor/pricing/bulk", requireAuth, requireRole("VENDOR"), async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const [vendorUser] = await db.select().from(vendorUsers)
      .where(and(eq(vendorUsers.userId, userId), eq(vendorUsers.isActive, true), eq(vendorUsers.canSubmitPricing, true)))
      .limit(1);

    if (!vendorUser) {
      return res.status(403).json({ error: "No permission to submit pricing" });
    }

    const { csvData, contractorOrgIds } = req.body;

    if (!csvData || typeof csvData !== "string") {
      return res.status(400).json({ error: "CSV data is required" });
    }

    const lines = csvData.trim().split("\n");
    if (lines.length < 2) {
      return res.status(400).json({ 
        error: "EMPTY_FILE",
        message: "You uploaded an empty file. Please fill out the CSV and upload again."
      });
    }

    const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ''));
    
    const expectedHeaders = ["itemName", "itemCode", "category", "description", "unit", "unitPrice", "minimumOrder", "deliveryFee", "leadTimeDays"];
    const missingHeaders = expectedHeaders.filter(h => !headers.includes(h));
    
    if (missingHeaders.length > 0) {
      return res.status(400).json({ 
        error: "INVALID_FORMAT",
        message: "Error: File does not match the required format.",
        details: `Missing headers: ${missingHeaders.join(", ")}`
      });
    }

    const items: any[] = [];
    const errors: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const values: string[] = [];
      let currentValue = "";
      let insideQuotes = false;
      
      for (const char of line) {
        if (char === '"') {
          insideQuotes = !insideQuotes;
        } else if (char === ',' && !insideQuotes) {
          values.push(currentValue.trim());
          currentValue = "";
        } else {
          currentValue += char;
        }
      }
      values.push(currentValue.trim());

      const rowData: any = {};
      headers.forEach((header, index) => {
        rowData[header] = values[index]?.replace(/^"|"$/g, '') || null;
      });

      if (!rowData.itemName || rowData.itemName.trim() === "") {
        errors.push(`Row ${i + 1}: itemName is required`);
        continue;
      }
      if (!rowData.unitPrice || isNaN(parseFloat(rowData.unitPrice))) {
        errors.push(`Row ${i + 1}: valid unitPrice is required`);
        continue;
      }
      if (!rowData.unit || rowData.unit.trim() === "") {
        errors.push(`Row ${i + 1}: unit is required`);
        continue;
      }

      items.push({
        itemName: rowData.itemName.trim(),
        itemCode: rowData.itemCode?.trim() || null,
        category: rowData.category?.trim() || null,
        description: rowData.description?.trim() || null,
        unit: rowData.unit.trim(),
        unitPrice: rowData.unitPrice.trim(),
        minimumOrder: rowData.minimumOrder ? parseInt(rowData.minimumOrder) : null,
        deliveryFee: rowData.deliveryFee?.trim() || null,
        leadTimeDays: rowData.leadTimeDays ? parseInt(rowData.leadTimeDays) : null,
      });
    }

    if (items.length === 0) {
      return res.status(400).json({ 
        error: "EMPTY_FILE",
        message: "You uploaded an empty file. Please fill out the CSV and upload again.",
        validationErrors: errors.length > 0 ? errors : undefined
      });
    }

    const conditions: any[] = [
      eq(vendorEnrollments.vendorCrmOrgId, vendorUser.crmOrganisationId),
      eq(vendorEnrollments.status, "ACTIVE"),
    ];
    if (contractorOrgIds && contractorOrgIds.length > 0) {
      conditions.push(sql`${vendorEnrollments.contractorOrgId} IN (${sql.join(contractorOrgIds.map((id: string) => sql`${id}`), sql`, `)})`);
    }

    const enrollments = await db.select().from(vendorEnrollments).where(and(...conditions));

    if (enrollments.length === 0) {
      return res.status(400).json({ error: "No active enrollments found for pricing submission" });
    }

    const now = new Date();
    const currentQuarter = `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`;
    const insertedItems: any[] = [];

    for (const enrollment of enrollments) {
      for (const item of items) {
        const approvalStatus = enrollment.autoApproveNewPricing ? "AUTO_APPROVED" : "PENDING_REVIEW";
        
        const [inserted] = await db.insert(vendorPricingCatalogs).values({
          crmOrganisationId: vendorUser.crmOrganisationId,
          organizationId: enrollment.contractorOrgId,
          itemName: item.itemName,
          itemCode: item.itemCode,
          category: item.category,
          description: item.description,
          unit: item.unit,
          unitPrice: item.unitPrice,
          minimumOrder: item.minimumOrder,
          deliveryFee: item.deliveryFee,
          effectiveQuarter: currentQuarter,
          effectiveDate: now,
          leadTimeDays: item.leadTimeDays,
          sourceType: "MANUAL",
          approvalStatus: approvalStatus,
          submittedByVendorUserId: userId,
          isActive: true,
          createdById: userId,
        }).returning();
        
        insertedItems.push(inserted);
      }
    }

    await logAudit({
      action: "CREATE",
      entityType: "vendor_pricing_catalogs",
      entityId: insertedItems[0]?.id || "bulk",
      userId: userId,
      oldValue: null,
      newValue: JSON.stringify({ 
        itemCount: items.length,
        totalInserted: insertedItems.length,
        enrollmentsServed: enrollments.length
      }),
    }, req);

    res.json({
      success: true,
      message: "Items added successfully.",
      itemsCreated: items.length,
      totalRecords: insertedItems.length,
      enrollmentsServed: enrollments.length,
      validationWarnings: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error("Bulk upload vendor pricing error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ========================================
// Routes from vendorPricebookRoutes.ts
// ========================================

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  }
});

const createImportJobSchema = z.object({
  crmOrganisationId: z.string().uuid(),
  effectiveQuarter: z.string().optional(),
  effectiveDate: z.string().optional(),
});

router.get("/pricebook-imports", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user || !req.user.organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const statusFilter = req.query.status as string;

    const conditions = [eq(pricebookImportJobs.organizationId, req.user.organizationId)];
    if (statusFilter && ["PENDING", "PROCESSING", "COMPLETED", "FAILED"].includes(statusFilter)) {
      conditions.push(eq(pricebookImportJobs.status, statusFilter as any));
    }

    const jobs = await db
      .select({
        id: pricebookImportJobs.id,
        crmOrganisationId: pricebookImportJobs.crmOrganisationId,
        vendorName: crmOrganisations.name,
        fileName: pricebookImportJobs.fileName,
        status: pricebookImportJobs.status,
        itemsExtracted: pricebookImportJobs.itemsExtracted,
        itemsApproved: pricebookImportJobs.itemsApproved,
        errorMessage: pricebookImportJobs.errorMessage,
        effectiveQuarter: pricebookImportJobs.effectiveQuarter,
        effectiveDate: pricebookImportJobs.effectiveDate,
        processedAt: pricebookImportJobs.processedAt,
        createdAt: pricebookImportJobs.createdAt,
        createdBy: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
        },
      })
      .from(pricebookImportJobs)
      .leftJoin(crmOrganisations, eq(pricebookImportJobs.crmOrganisationId, crmOrganisations.id))
      .leftJoin(users, eq(pricebookImportJobs.createdById, users.id))
      .where(and(...conditions))
      .orderBy(desc(pricebookImportJobs.createdAt))
      .limit(limit)
      .offset(offset);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(pricebookImportJobs)
      .where(and(...conditions));

    res.json({
      jobs,
      pagination: {
        total: countResult?.count || 0,
        limit,
        offset,
        hasMore: (countResult?.count || 0) > offset + limit,
      },
    });
  } catch (error: any) {
    logError(`[VendorPricebook] Failed to fetch import jobs: ${error.message}`);
    res.status(500).json({ error: "Failed to fetch import jobs" });
  }
});

router.get("/pricebook-imports/:jobId", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user || !req.user.organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { jobId } = req.params;

    const [job] = await db
      .select({
        id: pricebookImportJobs.id,
        organizationId: pricebookImportJobs.organizationId,
        crmOrganisationId: pricebookImportJobs.crmOrganisationId,
        vendorName: crmOrganisations.name,
        fileName: pricebookImportJobs.fileName,
        fileRef: pricebookImportJobs.fileRef,
        status: pricebookImportJobs.status,
        itemsExtracted: pricebookImportJobs.itemsExtracted,
        itemsApproved: pricebookImportJobs.itemsApproved,
        errorMessage: pricebookImportJobs.errorMessage,
        effectiveQuarter: pricebookImportJobs.effectiveQuarter,
        effectiveDate: pricebookImportJobs.effectiveDate,
        processedAt: pricebookImportJobs.processedAt,
        createdAt: pricebookImportJobs.createdAt,
      })
      .from(pricebookImportJobs)
      .leftJoin(crmOrganisations, eq(pricebookImportJobs.crmOrganisationId, crmOrganisations.id))
      .where(
        and(
          eq(pricebookImportJobs.id, jobId),
          eq(pricebookImportJobs.organizationId, req.user.organizationId)
        )
      )
      .limit(1);

    if (!job) {
      return res.status(404).json({ error: "Import job not found" });
    }

    const extractedItems = await db
      .select()
      .from(vendorPricingCatalogs)
      .where(eq(vendorPricingCatalogs.pricebookImportId, jobId))
      .orderBy(vendorPricingCatalogs.category, vendorPricingCatalogs.itemName);

    res.json({
      job,
      extractedItems,
    });
  } catch (error: any) {
    logError(`[VendorPricebook] Failed to fetch import job: ${error.message}`);
    res.status(500).json({ error: "Failed to fetch import job" });
  }
});

router.post("/pricebook-imports", requireAuth, upload.single('file'), async (req: AuthRequest, res) => {
  try {
    if (!req.user || !req.user.organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const bodyValidation = createImportJobSchema.safeParse(req.body);
    if (!bodyValidation.success) {
      return res.status(400).json({ error: "Invalid input", details: bodyValidation.error.issues });
    }

    const { crmOrganisationId, effectiveQuarter, effectiveDate } = bodyValidation.data;

    const [vendor] = await db
      .select()
      .from(crmOrganisations)
      .where(
        and(
          eq(crmOrganisations.id, crmOrganisationId),
          eq(crmOrganisations.organizationId, req.user.organizationId)
        )
      );

    if (!vendor) {
      return res.status(404).json({ error: "Vendor not found" });
    }

    const fileBuffer = req.file.buffer;
    const fileName = req.file.originalname;
    const timestamp = Date.now();
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const fileRef = `pricebooks/${req.user.organizationId}/${crmOrganisationId}/${timestamp}_${sanitizedFileName}`;

    let storageAvailable = false;
    try {
      const { Storage } = await import('@google-cloud/storage');
      const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
      if (bucketId) {
        const storage = new Storage();
        const bucket = storage.bucket(bucketId);
        const file = bucket.file(fileRef);
        await file.save(fileBuffer, {
          contentType: 'application/pdf',
          metadata: {
            organizationId: req.user.organizationId,
            crmOrganisationId,
            uploadedBy: req.user.id,
          },
        });
        storageAvailable = true;
        logInfo(`[VendorPricebook] File uploaded to storage: ${fileRef}`);
      }
    } catch (storageError: any) {
      logError(`[VendorPricebook] Storage upload failed (will continue with DB record): ${storageError.message}`);
    }

    const [importJob] = await db.insert(pricebookImportJobs).values({
      organizationId: req.user.organizationId,
      crmOrganisationId,
      fileRef: storageAvailable ? fileRef : `local:${fileName}`,
      fileName,
      status: "PENDING",
      effectiveQuarter: effectiveQuarter || getCurrentQuarter(),
      effectiveDate: effectiveDate ? new Date(effectiveDate) : new Date(),
      createdById: req.user.id,
    }).returning();

    logInfo(`[VendorPricebook] Import job created: ${importJob.id} for vendor ${crmOrganisationId}`);

    res.status(201).json({
      success: true,
      job: importJob,
      message: "Pricebook uploaded. AI extraction will begin shortly.",
    });
  } catch (error: any) {
    logError(`[VendorPricebook] Failed to create import job: ${error.message}`);
    res.status(500).json({ error: "Failed to upload pricebook" });
  }
});

router.post("/pricebook-imports/:jobId/process", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user || !req.user.organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { jobId } = req.params;

    const [job] = await db
      .select()
      .from(pricebookImportJobs)
      .where(
        and(
          eq(pricebookImportJobs.id, jobId),
          eq(pricebookImportJobs.organizationId, req.user.organizationId)
        )
      );

    if (!job) {
      return res.status(404).json({ error: "Import job not found" });
    }

    if (job.status !== "PENDING") {
      return res.status(400).json({ error: `Job is already ${job.status.toLowerCase()}` });
    }

    await db
      .update(pricebookImportJobs)
      .set({ status: "PROCESSING", updatedAt: new Date() })
      .where(eq(pricebookImportJobs.id, jobId));

    try {
      const { extractPricingFromPDF } = await import("./ai/vendorPriceListExtractor");
      
      const extractedItems = await extractPricingFromPDF(
        job.fileRef,
        job.crmOrganisationId,
        job.effectiveQuarter || getCurrentQuarter(),
        { orgId: job.organizationId || req.user?.organizationId || "system", userId: req.user?.id || "system" }
      );

      const insertedItems = [];
      for (const item of extractedItems) {
        const [inserted] = await db.insert(vendorPricingCatalogs).values({
          crmOrganisationId: job.crmOrganisationId,
          organizationId: job.organizationId,
          itemName: item.itemName,
          itemCode: item.itemCode,
          category: item.category,
          description: item.description,
          unit: item.unit,
          unitPrice: item.unitPrice,
          minimumOrder: item.minimumOrder,
          deliveryFee: item.deliveryFee,
          effectiveQuarter: job.effectiveQuarter || getCurrentQuarter(),
          effectiveDate: job.effectiveDate || new Date(),
          sourceDocUrl: job.fileRef,
          sourceDocName: job.fileName,
          sourceType: "PRICEBOOK_IMPORT",
          approvalStatus: "PENDING_REVIEW",
          pricebookImportId: job.id,
          isActive: true,
          createdById: job.createdById,
        }).returning();
        insertedItems.push(inserted);
      }

      await db
        .update(pricebookImportJobs)
        .set({
          status: "COMPLETED",
          itemsExtracted: insertedItems.length,
          processedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(pricebookImportJobs.id, jobId));

      logInfo(`[VendorPricebook] Job ${jobId} completed: ${insertedItems.length} items extracted`);

      res.json({
        success: true,
        itemsExtracted: insertedItems.length,
        message: `Successfully extracted ${insertedItems.length} pricing items`,
      });
    } catch (extractionError: any) {
      await db
        .update(pricebookImportJobs)
        .set({
          status: "FAILED",
          errorMessage: extractionError.message,
          processedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(pricebookImportJobs.id, jobId));

      logError(`[VendorPricebook] Job ${jobId} failed: ${extractionError.message}`);
      res.status(500).json({ error: "AI extraction failed", details: extractionError.message });
    }
  } catch (error: any) {
    logError(`[VendorPricebook] Failed to process import job: ${error.message}`);
    res.status(500).json({ error: "Failed to process import job" });
  }
});

router.post("/pricebook-imports/:jobId/items/:itemId/approve", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user || !req.user.organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { jobId, itemId } = req.params;

    const [job] = await db
      .select()
      .from(pricebookImportJobs)
      .where(
        and(
          eq(pricebookImportJobs.id, jobId),
          eq(pricebookImportJobs.organizationId, req.user.organizationId)
        )
      );

    if (!job) {
      return res.status(404).json({ error: "Import job not found" });
    }

    const [item] = await db
      .select()
      .from(vendorPricingCatalogs)
      .where(
        and(
          eq(vendorPricingCatalogs.id, itemId),
          eq(vendorPricingCatalogs.pricebookImportId, jobId)
        )
      );

    if (!item) {
      return res.status(404).json({ error: "Item not found" });
    }

    await db
      .update(vendorPricingCatalogs)
      .set({
        approvalStatus: "APPROVED",
        approvedByUserId: req.user.id,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(vendorPricingCatalogs.id, itemId));

    const [approvedCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(vendorPricingCatalogs)
      .where(
        and(
          eq(vendorPricingCatalogs.pricebookImportId, jobId),
          eq(vendorPricingCatalogs.approvalStatus, "APPROVED")
        )
      );

    await db
      .update(pricebookImportJobs)
      .set({
        itemsApproved: approvedCount?.count || 0,
        updatedAt: new Date(),
      })
      .where(eq(pricebookImportJobs.id, jobId));

    res.json({ success: true, message: "Item approved" });
  } catch (error: any) {
    logError(`[VendorPricebook] Failed to approve item: ${error.message}`);
    res.status(500).json({ error: "Failed to approve item" });
  }
});

router.post("/pricebook-imports/:jobId/items/:itemId/reject", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user || !req.user.organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { jobId, itemId } = req.params;

    const [job] = await db
      .select()
      .from(pricebookImportJobs)
      .where(
        and(
          eq(pricebookImportJobs.id, jobId),
          eq(pricebookImportJobs.organizationId, req.user.organizationId)
        )
      );

    if (!job) {
      return res.status(404).json({ error: "Import job not found" });
    }

    await db
      .update(vendorPricingCatalogs)
      .set({
        approvalStatus: "REJECTED",
        isActive: false,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(vendorPricingCatalogs.id, itemId),
          eq(vendorPricingCatalogs.pricebookImportId, jobId)
        )
      );

    res.json({ success: true, message: "Item rejected" });
  } catch (error: any) {
    logError(`[VendorPricebook] Failed to reject item: ${error.message}`);
    res.status(500).json({ error: "Failed to reject item" });
  }
});

router.post("/pricebook-imports/:jobId/approve-all", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user || !req.user.organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { jobId } = req.params;

    const [job] = await db
      .select()
      .from(pricebookImportJobs)
      .where(
        and(
          eq(pricebookImportJobs.id, jobId),
          eq(pricebookImportJobs.organizationId, req.user.organizationId)
        )
      );

    if (!job) {
      return res.status(404).json({ error: "Import job not found" });
    }

    await db
      .update(vendorPricingCatalogs)
      .set({
        approvalStatus: "APPROVED",
        approvedByUserId: req.user.id,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(vendorPricingCatalogs.pricebookImportId, jobId),
          eq(vendorPricingCatalogs.approvalStatus, "PENDING_REVIEW")
        )
      );

    await db
      .update(pricebookImportJobs)
      .set({
        itemsApproved: job.itemsExtracted,
        updatedAt: new Date(),
      })
      .where(eq(pricebookImportJobs.id, jobId));

    res.json({ success: true, message: "All items approved" });
  } catch (error: any) {
    logError(`[VendorPricebook] Failed to approve all items: ${error.message}`);
    res.status(500).json({ error: "Failed to approve all items" });
  }
});

function getCurrentQuarter(): string {
  const now = new Date();
  const year = now.getFullYear();
  const quarter = Math.ceil((now.getMonth() + 1) / 3);
  return `${year}-Q${quarter}`;
}

// ========================================
// Routes from vendorPricingRoutes.ts
// ========================================

router.use("/api/crm", requireAuth, requireFeaturePermission('canManageProcurement'));
router.use("/api/vendor-pricing", requireAuth, requireFeaturePermission('canManageProcurement'));
router.use("/api/rental-catalog", requireAuth, requireFeaturePermission('canManageProcurement'));
router.use("/api/ai-features/vendor-pricebooks", requireAuth, requireFeaturePermission('canManageProcurement'));

router.get("/api/crm/organisations/:id/pricing", requireAuth, async (req: AuthRequest, res) => {
  try {
    const items = await db
      .select()
      .from(vendorPricingCatalogs)
      .where(eq(vendorPricingCatalogs.crmOrganisationId, req.params.id))
      .orderBy(vendorPricingCatalogs.category, vendorPricingCatalogs.itemName);
    
    res.json(items);
  } catch (error) {
    console.error("Get vendor pricing error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/crm/organisations/:id/pricing/current", requireAuth, async (req: AuthRequest, res) => {
  try {
    const now = new Date();
    const currentQuarter = `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`;
    
    const items = await db
      .select()
      .from(vendorPricingCatalogs)
      .where(and(
        eq(vendorPricingCatalogs.crmOrganisationId, req.params.id),
        eq(vendorPricingCatalogs.isActive, true),
        eq(vendorPricingCatalogs.effectiveQuarter, currentQuarter)
      ))
      .orderBy(vendorPricingCatalogs.category, vendorPricingCatalogs.itemName);
    
    res.json(items);
  } catch (error) {
    console.error("Get current vendor pricing error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/crm/organisations/:id/pricing", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [org] = await db.select().from(crmOrganisations).where(eq(crmOrganisations.id, req.params.id)).limit(1);
    if (!org) {
      res.status(404).json({ error: "Organisation not found" });
      return;
    }

    const bodyWithDates = {
      ...req.body,
      effectiveDate: req.body.effectiveDate ? new Date(req.body.effectiveDate) : new Date(),
      expirationDate: req.body.expirationDate ? new Date(req.body.expirationDate) : null,
      crmOrganisationId: req.params.id,
      createdById: req.user!.id,
    };

    const validationResult = insertVendorPricingCatalogSchema.safeParse(bodyWithDates);

    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const [newItem] = await db.insert(vendorPricingCatalogs).values(validationResult.data).returning();

    await db.insert(auditLog).values({
      userId: req.user!.id,
      action: "CREATE",
      entityType: "vendor_pricing_catalogs",
      entityId: newItem.id,
      newValue: JSON.stringify({ itemName: newItem.itemName, category: newItem.category, unitPrice: newItem.unitPrice }),
    });

    res.status(201).json(newItem);
  } catch (error) {
    console.error("Create vendor pricing error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/api/crm/pricing/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [existing] = await db.select().from(vendorPricingCatalogs).where(eq(vendorPricingCatalogs.id, req.params.id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Pricing item not found" });
      return;
    }

    const bodyWithDates = {
      ...req.body,
      ...(req.body.effectiveDate && { effectiveDate: new Date(req.body.effectiveDate) }),
      ...(req.body.expirationDate && { expirationDate: new Date(req.body.expirationDate) }),
    };

    const validationResult = insertVendorPricingCatalogSchema.partial().safeParse(bodyWithDates);
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const [updated] = await db
      .update(vendorPricingCatalogs)
      .set({ ...validationResult.data, updatedAt: new Date() })
      .where(eq(vendorPricingCatalogs.id, req.params.id))
      .returning();

    await db.insert(auditLog).values({
      userId: req.user!.id,
      action: "UPDATE",
      entityType: "vendor_pricing_catalogs",
      entityId: updated.id,
      oldValue: JSON.stringify({ itemName: existing.itemName, unitPrice: existing.unitPrice }),
      newValue: JSON.stringify({ itemName: updated.itemName, unitPrice: updated.unitPrice }),
    });

    res.json(updated);
  } catch (error) {
    console.error("Update vendor pricing error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/api/crm/pricing/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [existing] = await db.select().from(vendorPricingCatalogs).where(eq(vendorPricingCatalogs.id, req.params.id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Pricing item not found" });
      return;
    }

    await db.delete(vendorPricingCatalogs).where(eq(vendorPricingCatalogs.id, req.params.id));

    await db.insert(auditLog).values({
      userId: req.user!.id,
      action: "DELETE",
      entityType: "vendor_pricing_catalogs",
      entityId: existing.id,
      oldValue: JSON.stringify({ itemName: existing.itemName, category: existing.category }),
    });

    res.json({ success: true });
  } catch (error) {
    console.error("Delete vendor pricing error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/vendor-pricing/search", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { category, search, quarter } = req.query;
    const now = new Date();
    const currentQuarter = quarter as string || `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`;

    const conditions: any[] = [
      eq(vendorPricingCatalogs.isActive, true),
    ];

    if (category) {
      conditions.push(eq(vendorPricingCatalogs.category, category as string));
    }
    if (search) {
      conditions.push(sql`LOWER(${vendorPricingCatalogs.itemName}) LIKE LOWER(${'%' + search + '%'})`);
    }

    const items = await db
      .select({
        id: vendorPricingCatalogs.id,
        itemName: vendorPricingCatalogs.itemName,
        itemCode: vendorPricingCatalogs.itemCode,
        category: vendorPricingCatalogs.category,
        description: vendorPricingCatalogs.description,
        unit: vendorPricingCatalogs.unit,
        unitPrice: vendorPricingCatalogs.unitPrice,
        minimumOrder: vendorPricingCatalogs.minimumOrder,
        deliveryFee: vendorPricingCatalogs.deliveryFee,
        effectiveQuarter: vendorPricingCatalogs.effectiveQuarter,
        leadTimeDays: vendorPricingCatalogs.leadTimeDays,
        vendorId: crmOrganisations.id,
        vendorName: crmOrganisations.name,
        vendorType: crmOrganisations.type,
      })
      .from(vendorPricingCatalogs)
      .innerJoin(crmOrganisations, eq(crmOrganisations.id, vendorPricingCatalogs.crmOrganisationId))
      .where(and(...conditions))
      .orderBy(vendorPricingCatalogs.unitPrice)
      .limit(50);

    res.json(items);
  } catch (error) {
    console.error("Search vendor pricing error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/crm/organisations/:id/rental-catalog", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.json([]);
    }
    
    const [crmOrg] = await db.select().from(crmOrganisations).where(eq(crmOrganisations.id, req.params.id)).limit(1);
    if (!crmOrg) {
      return res.json([]);
    }
    
    if (shouldFilter && crmOrg.organizationId !== orgId) {
      return res.json([]);
    }
    
    const items = await db
      .select()
      .from(rentalEquipmentCatalog)
      .where(eq(rentalEquipmentCatalog.crmOrganisationId, req.params.id))
      .orderBy(rentalEquipmentCatalog.equipmentType, rentalEquipmentCatalog.name);
    
    res.json(items);
  } catch (error) {
    console.error("Get CRM rental catalog error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/crm/organisations/:id/rental-catalog", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied - no organization" });
    }
    
    const [org] = await db.select().from(crmOrganisations).where(eq(crmOrganisations.id, req.params.id)).limit(1);
    if (!org) {
      res.status(404).json({ error: "Organisation not found" });
      return;
    }
    
    if (shouldFilter && org.organizationId !== orgId) {
      return res.status(404).json({ error: "Organisation not found" });
    }
    
    if (org.type !== "RENTAL_VENDOR" && org.type !== "VENDOR") {
      res.status(400).json({ error: "Organisation must be a Rental Vendor or Vendor type" });
      return;
    }

    const validationResult = insertRentalEquipmentCatalogSchema.safeParse({
      ...req.body,
      crmOrganisationId: req.params.id,
    });

    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const [newItem] = await db.insert(rentalEquipmentCatalog).values(validationResult.data).returning();

    await db.insert(auditLog).values({
      userId: req.user!.id,
      action: "CREATE",
      entityType: "rental_equipment_catalog",
      entityId: newItem.id,
      newValue: JSON.stringify({ name: newItem.name, equipmentType: newItem.equipmentType }),
    });

    res.status(201).json(newItem);
  } catch (error) {
    console.error("Create CRM rental catalog error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/api/crm/rental-catalog/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied - no organization" });
    }
    
    const [existing] = await db
      .select({ 
        catalogItem: rentalEquipmentCatalog, 
        orgOrgId: crmOrganisations.organizationId,
        crmOrgId: crmOrganisations.id
      })
      .from(rentalEquipmentCatalog)
      .innerJoin(crmOrganisations, eq(crmOrganisations.id, rentalEquipmentCatalog.crmOrganisationId))
      .where(eq(rentalEquipmentCatalog.id, req.params.id))
      .limit(1);
    
    if (!existing) {
      res.status(404).json({ error: "Catalog item not found" });
      return;
    }
    
    if (shouldFilter && existing.orgOrgId !== orgId) {
      return res.status(404).json({ error: "Catalog item not found" });
    }

    const validationResult = insertRentalEquipmentCatalogSchema.partial().safeParse(req.body);
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const updateConditions = and(
      eq(rentalEquipmentCatalog.id, req.params.id),
      eq(rentalEquipmentCatalog.crmOrganisationId, existing.crmOrgId)
    );

    const { crmOrganisationId, ...safeUpdateData } = validationResult.data;

    const [updated] = await db
      .update(rentalEquipmentCatalog)
      .set({ ...safeUpdateData, updatedAt: new Date() })
      .where(updateConditions)
      .returning();

    res.json(updated);
  } catch (error) {
    console.error("Update CRM rental catalog error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/api/crm/rental-catalog/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied - no organization" });
    }
    
    const [existing] = await db
      .select({ 
        catalogItem: rentalEquipmentCatalog, 
        orgOrgId: crmOrganisations.organizationId,
        crmOrgId: crmOrganisations.id
      })
      .from(rentalEquipmentCatalog)
      .innerJoin(crmOrganisations, eq(crmOrganisations.id, rentalEquipmentCatalog.crmOrganisationId))
      .where(eq(rentalEquipmentCatalog.id, req.params.id))
      .limit(1);
    
    if (!existing) {
      res.status(404).json({ error: "Catalog item not found" });
      return;
    }
    
    if (shouldFilter && existing.orgOrgId !== orgId) {
      return res.status(404).json({ error: "Catalog item not found" });
    }

    const deleteConditions = and(
      eq(rentalEquipmentCatalog.id, req.params.id),
      eq(rentalEquipmentCatalog.crmOrganisationId, existing.crmOrgId)
    );

    await db.delete(rentalEquipmentCatalog).where(deleteConditions);

    res.json({ success: true });
  } catch (error) {
    console.error("Delete CRM rental catalog error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/rental-catalog/search", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.json([]);
    }
    
    const { type, search } = req.query;

    const conditions: any[] = [
      eq(rentalEquipmentCatalog.isActive, true),
      sql`${rentalEquipmentCatalog.crmOrganisationId} IS NOT NULL`,
    ];
    
    if (shouldFilter && orgId) {
      conditions.push(eq(crmOrganisations.organizationId, orgId));
    }

    if (type) {
      conditions.push(eq(rentalEquipmentCatalog.equipmentType, type as string));
    }
    if (search) {
      conditions.push(sql`LOWER(${rentalEquipmentCatalog.name}) LIKE LOWER(${'%' + search + '%'})`);
    }

    const items = await db
      .select({
        id: rentalEquipmentCatalog.id,
        name: rentalEquipmentCatalog.name,
        equipmentType: rentalEquipmentCatalog.equipmentType,
        make: rentalEquipmentCatalog.make,
        model: rentalEquipmentCatalog.model,
        description: rentalEquipmentCatalog.description,
        hourlyRate: rentalEquipmentCatalog.hourlyRate,
        dailyRate: rentalEquipmentCatalog.dailyRate,
        weeklyRate: rentalEquipmentCatalog.weeklyRate,
        monthlyRate: rentalEquipmentCatalog.monthlyRate,
        deliveryFee: rentalEquipmentCatalog.deliveryFee,
        pickupFee: rentalEquipmentCatalog.pickupFee,
        minimumRentalDays: rentalEquipmentCatalog.minimumRentalDays,
        vendorId: crmOrganisations.id,
        vendorName: crmOrganisations.name,
      })
      .from(rentalEquipmentCatalog)
      .innerJoin(crmOrganisations, eq(crmOrganisations.id, rentalEquipmentCatalog.crmOrganisationId))
      .where(and(...conditions))
      .orderBy(rentalEquipmentCatalog.dailyRate)
      .limit(50);

    res.json(items);
  } catch (error) {
    console.error("Search rental catalog error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/crm/organisations/:id/pricing/pending", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: "Organization not found" });
    }

    const pendingPricing = await db
      .select({
        id: vendorPricingCatalogs.id,
        itemName: vendorPricingCatalogs.itemName,
        itemCode: vendorPricingCatalogs.itemCode,
        category: vendorPricingCatalogs.category,
        description: vendorPricingCatalogs.description,
        unit: vendorPricingCatalogs.unit,
        unitPrice: vendorPricingCatalogs.unitPrice,
        effectiveQuarter: vendorPricingCatalogs.effectiveQuarter,
        effectiveDate: vendorPricingCatalogs.effectiveDate,
        approvalStatus: vendorPricingCatalogs.approvalStatus,
        createdAt: vendorPricingCatalogs.createdAt,
        submittedByEmail: users.email,
        submittedByName: sql`CONCAT(${users.firstName}, ' ', ${users.lastName})`,
      })
      .from(vendorPricingCatalogs)
      .leftJoin(users, eq(users.id, vendorPricingCatalogs.submittedByVendorUserId))
      .where(and(
        eq(vendorPricingCatalogs.crmOrganisationId, req.params.id),
        eq(vendorPricingCatalogs.organizationId, organizationId),
        eq(vendorPricingCatalogs.approvalStatus, "PENDING_REVIEW")
      ))
      .orderBy(vendorPricingCatalogs.createdAt);

    res.json(pendingPricing);
  } catch (error) {
    console.error("Get pending pricing error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/crm/pricing/:id/approve", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: "Organization not found" });
    }

    const [existing] = await db.select().from(vendorPricingCatalogs)
      .where(and(
        eq(vendorPricingCatalogs.id, req.params.id),
        eq(vendorPricingCatalogs.organizationId, organizationId)
      ))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Pricing item not found" });
    }

    if (existing.approvalStatus !== "PENDING_REVIEW") {
      return res.status(400).json({ error: "Pricing item is not pending approval" });
    }

    const [updated] = await db
      .update(vendorPricingCatalogs)
      .set({
        approvalStatus: "APPROVED",
        approvedByUserId: req.user!.id,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(vendorPricingCatalogs.id, req.params.id))
      .returning();

    await db.insert(auditLog).values({
      userId: req.user!.id,
      action: "UPDATE",
      entityType: "vendor_pricing",
      entityId: req.params.id,
      oldValue: JSON.stringify({ approvalStatus: "PENDING_REVIEW" }),
      newValue: JSON.stringify({ approvalStatus: "APPROVED" }),
    });

    res.json(updated);
  } catch (error) {
    console.error("Approve pricing error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/crm/pricing/:id/reject", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: "Organization not found" });
    }

    const [existing] = await db.select().from(vendorPricingCatalogs)
      .where(and(
        eq(vendorPricingCatalogs.id, req.params.id),
        eq(vendorPricingCatalogs.organizationId, organizationId)
      ))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Pricing item not found" });
    }

    if (existing.approvalStatus !== "PENDING_REVIEW") {
      return res.status(400).json({ error: "Pricing item is not pending approval" });
    }

    const [updated] = await db
      .update(vendorPricingCatalogs)
      .set({
        approvalStatus: "REJECTED",
        approvedByUserId: req.user!.id,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(vendorPricingCatalogs.id, req.params.id))
      .returning();

    await db.insert(auditLog).values({
      userId: req.user!.id,
      action: "UPDATE",
      entityType: "vendor_pricing",
      entityId: req.params.id,
      oldValue: JSON.stringify({ approvalStatus: "PENDING_REVIEW" }),
      newValue: JSON.stringify({ approvalStatus: "REJECTED" }),
    });

    res.json(updated);
  } catch (error) {
    console.error("Reject pricing error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/crm/pricing-reviews", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: "Organization not found" });
    }

    const items = await db
      .select({
        id: vendorPricingCatalogs.id,
        itemName: vendorPricingCatalogs.itemName,
        itemCode: vendorPricingCatalogs.itemCode,
        category: vendorPricingCatalogs.category,
        description: vendorPricingCatalogs.description,
        unit: vendorPricingCatalogs.unit,
        unitPrice: vendorPricingCatalogs.unitPrice,
        minimumOrder: vendorPricingCatalogs.minimumOrder,
        deliveryFee: vendorPricingCatalogs.deliveryFee,
        effectiveQuarter: vendorPricingCatalogs.effectiveQuarter,
        sourceType: vendorPricingCatalogs.sourceType,
        approvalStatus: vendorPricingCatalogs.approvalStatus,
        createdAt: vendorPricingCatalogs.createdAt,
        vendorName: crmOrganisations.name,
        vendorId: crmOrganisations.id,
      })
      .from(vendorPricingCatalogs)
      .innerJoin(crmOrganisations, eq(crmOrganisations.id, vendorPricingCatalogs.crmOrganisationId))
      .where(and(
        eq(vendorPricingCatalogs.organizationId, organizationId),
        eq(vendorPricingCatalogs.approvalStatus, "PENDING_REVIEW")
      ))
      .orderBy(vendorPricingCatalogs.createdAt);

    res.json(items);
  } catch (error) {
    console.error("Get pricing reviews error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/crm/pricing-reviews/:id/:action", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: "Organization not found" });
    }

    const { action } = req.params;
    if (action !== "approve" && action !== "reject") {
      return res.status(400).json({ error: "Invalid action" });
    }

    const [item] = await db.select().from(vendorPricingCatalogs)
      .where(and(
        eq(vendorPricingCatalogs.id, req.params.id),
        eq(vendorPricingCatalogs.organizationId, organizationId),
        eq(vendorPricingCatalogs.approvalStatus, "PENDING_REVIEW")
      ))
      .limit(1);

    if (!item) {
      return res.status(404).json({ error: "Pricing item not found or already reviewed" });
    }

    const [updated] = await db
      .update(vendorPricingCatalogs)
      .set({
        approvalStatus: action === "approve" ? "APPROVED" : "REJECTED",
        isActive: action === "approve",
        approvedByUserId: req.user!.id,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(vendorPricingCatalogs.id, req.params.id))
      .returning();

    res.json(updated);
  } catch (error) {
    console.error("Review pricing error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/ai-features/vendor-pricebooks", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: "Organization not found" });
    }

    const pricebooks = await db
      .select({
        id: vendorPricebooks.id,
        vendorId: vendorPricebooks.vendorId,
        vendorName: crmOrganisations.name,
        version: sql<string>`COALESCE(${vendorPricebooks.fileName}, 'Imported')`,
        effectiveDate: vendorPricebooks.effectiveDate,
        expirationDate: vendorPricebooks.expirationDate,
        itemCount: vendorPricebooks.itemCount,
        isActive: sql<boolean>`${vendorPricebooks.status} = 'ACTIVE'`,
        lastSyncedAt: vendorPricebooks.importedAt,
        createdAt: vendorPricebooks.createdAt,
        status: vendorPricebooks.status,
      })
      .from(vendorPricebooks)
      .innerJoin(crmOrganisations, eq(crmOrganisations.id, vendorPricebooks.vendorId))
      .where(eq(vendorPricebooks.organizationId, organizationId))
      .orderBy(sql`${vendorPricebooks.createdAt} DESC`);

    res.json({ pricebooks });
  } catch (error) {
    console.error("Get vendor pricebooks error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/ai-features/vendor-pricebooks/:pricebookId/items", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: "Organization not found" });
    }

    const items = await db
      .select({
        id: vendorPricebookItems.id,
        vendorCode: vendorPricebookItems.vendorCode,
        vendorDescription: vendorPricebookItems.vendorDescription,
        category: vendorPricebookItems.category,
        unit: vendorPricebookItems.unit,
        unitPrice: vendorPricebookItems.unitPrice,
        uom: vendorPricebookItems.vendorUnit,
        lastUpdated: vendorPricebookItems.updatedAt,
        isActive: vendorPricebookItems.isActive,
      })
      .from(vendorPricebookItems)
      .where(and(
        eq(vendorPricebookItems.pricebookId, req.params.pricebookId),
        eq(vendorPricebookItems.organizationId, organizationId)
      ))
      .orderBy(vendorPricebookItems.category, vendorPricebookItems.vendorDescription);

    res.json({ items });
  } catch (error) {
    console.error("Get pricebook items error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/ai-features/vendor-pricebooks/upload", requireAuth, upload.single("file"), async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: "Organization not found" });
    }

    const { vendorId, effectiveDate } = req.body;
    const file = req.file;

    if (!file || !vendorId) {
      return res.status(400).json({ error: "File and vendor ID are required" });
    }

    const [vendor] = await db.select().from(crmOrganisations)
      .where(eq(crmOrganisations.id, vendorId))
      .limit(1);
    if (!vendor) {
      return res.status(404).json({ error: "Vendor not found" });
    }

    const [pricebook] = await db.insert(vendorPricebooks).values({
      organizationId,
      vendorId,
      fileKey: `pricebooks/${organizationId}/${Date.now()}_${file.originalname}`,
      fileName: file.originalname,
      fileType: file.mimetype.includes("csv") ? "CSV" : "XLSX",
      effectiveDate: effectiveDate || null,
      status: "PROCESSING",
      uploadedByUserId: req.user!.id,
    }).returning();

    const xlsx = await import("xlsx");
    const workbook = xlsx.read(file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

    if (rows.length < 2) {
      await db.update(vendorPricebooks)
        .set({ status: "PENDING", errorMessage: "File is empty or has no data rows" })
        .where(eq(vendorPricebooks.id, pricebook.id));
      return res.status(400).json({ error: "File has no data rows" });
    }

    const headers = rows[0] as string[];
    const dataRows = rows.slice(1);

    const codeIdx = headers.findIndex(h => /code|sku|item.*no|part.*no/i.test(String(h)));
    const descIdx = headers.findIndex(h => /desc|name|item/i.test(String(h)));
    const priceIdx = headers.findIndex(h => /price|cost|unit.*price/i.test(String(h)));
    const unitIdx = headers.findIndex(h => /unit|uom/i.test(String(h)));
    const categoryIdx = headers.findIndex(h => /cat|type|group/i.test(String(h)));

    let itemsCreated = 0;
    for (const row of dataRows) {
      const code = codeIdx >= 0 ? String(row[codeIdx] || "") : "";
      const descVal = descIdx >= 0 ? String(row[descIdx] || "") : "";
      const price = priceIdx >= 0 ? parseFloat(String(row[priceIdx] || "0")) : 0;
      const unit = unitIdx >= 0 ? String(row[unitIdx] || "EA") : "EA";
      const category = categoryIdx >= 0 ? String(row[categoryIdx] || "Uncategorized") : "Uncategorized";

      if (code || descVal) {
        await db.insert(vendorPricebookItems).values({
          pricebookId: pricebook.id,
          organizationId,
          vendorId,
          vendorCode: code || `AUTO-${itemsCreated + 1}`,
          vendorDescription: descVal || code,
          vendorUnit: unit,
          category,
          unit,
          unitPrice: String(price || 0),
          effectiveDate: effectiveDate || null,
        });
        itemsCreated++;
      }
    }

    await db.update(vendorPricebooks)
      .set({
        itemCount: itemsCreated,
        status: "ACTIVE",
        importedAt: new Date(),
      })
      .where(eq(vendorPricebooks.id, pricebook.id));

    res.status(201).json({
      pricebookId: pricebook.id,
      itemCount: itemsCreated,
      message: `Successfully imported ${itemsCreated} items`,
    });
  } catch (error) {
    console.error("Upload pricebook error:", error);
    res.status(500).json({ error: "Failed to process pricebook file" });
  }
});

router.post("/api/ai-features/vendor-pricebooks/:pricebookId/items", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: "Organization not found" });
    }

    const [pricebook] = await db.select().from(vendorPricebooks)
      .where(and(
        eq(vendorPricebooks.id, req.params.pricebookId),
        eq(vendorPricebooks.organizationId, organizationId)
      ))
      .limit(1);

    if (!pricebook) {
      return res.status(404).json({ error: "Pricebook not found" });
    }

    const { vendorCode, vendorDescription, category, unit, unitPrice } = req.body;

    const [item] = await db.insert(vendorPricebookItems).values({
      pricebookId: pricebook.id,
      organizationId,
      vendorId: pricebook.vendorId,
      vendorCode: vendorCode || `MANUAL-${Date.now()}`,
      vendorDescription: vendorDescription || "",
      vendorUnit: unit || "EA",
      category: category || "Uncategorized",
      unit: unit || "EA",
      unitPrice: String(unitPrice || 0),
    }).returning();

    await db.update(vendorPricebooks)
      .set({ itemCount: sql`${vendorPricebooks.itemCount} + 1` })
      .where(eq(vendorPricebooks.id, pricebook.id));

    res.status(201).json(item);
  } catch (error) {
    console.error("Add pricebook item error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/api/ai-features/vendor-pricebooks/items/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: "Organization not found" });
    }

    const [existing] = await db.select().from(vendorPricebookItems)
      .where(and(
        eq(vendorPricebookItems.id, req.params.id),
        eq(vendorPricebookItems.organizationId, organizationId)
      ))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Item not found" });
    }

    const { vendorCode, vendorDescription, category, unit, unitPrice, isActive } = req.body;

    const [updated] = await db.update(vendorPricebookItems)
      .set({
        ...(vendorCode !== undefined && { vendorCode }),
        ...(vendorDescription !== undefined && { vendorDescription }),
        ...(category !== undefined && { category }),
        ...(unit !== undefined && { unit, vendorUnit: unit }),
        ...(unitPrice !== undefined && { unitPrice: String(unitPrice) }),
        ...(isActive !== undefined && { isActive }),
        updatedAt: new Date(),
      })
      .where(eq(vendorPricebookItems.id, req.params.id))
      .returning();

    res.json(updated);
  } catch (error) {
    console.error("Update pricebook item error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/ai-features/vendor-pricebooks/:pricebookId/sync", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: "Organization not found" });
    }

    const [pricebook] = await db.select().from(vendorPricebooks)
      .where(and(
        eq(vendorPricebooks.id, req.params.pricebookId),
        eq(vendorPricebooks.organizationId, organizationId)
      ))
      .limit(1);

    if (!pricebook) {
      return res.status(404).json({ error: "Pricebook not found" });
    }

    const items = await db.select().from(vendorPricebookItems)
      .where(and(
        eq(vendorPricebookItems.pricebookId, pricebook.id),
        eq(vendorPricebookItems.isActive, true)
      ));

    let syncedCount = 0;
    for (const item of items) {
      const [existing] = await db.select().from(vendorPricingCatalogs)
        .where(and(
          eq(vendorPricingCatalogs.organizationId, organizationId),
          eq(vendorPricingCatalogs.crmOrganisationId, pricebook.vendorId),
          eq(vendorPricingCatalogs.itemCode, item.vendorCode)
        ))
        .limit(1);

      if (existing) {
        await db.update(vendorPricingCatalogs)
          .set({
            itemName: item.vendorDescription,
            category: item.category,
            unit: item.unit,
            unitPrice: item.unitPrice,
            sourceType: "PRICEBOOK_IMPORT",
            updatedAt: new Date(),
          })
          .where(eq(vendorPricingCatalogs.id, existing.id));
      } else {
        const now = new Date();
        const quarter = `${now.getFullYear()}-Q${Math.ceil((now.getMonth() + 1) / 3)}`;
        await db.insert(vendorPricingCatalogs).values({
          organizationId,
          crmOrganisationId: pricebook.vendorId,
          itemCode: item.vendorCode,
          itemName: item.vendorDescription,
          description: item.vendorDescription,
          category: item.category,
          unit: item.unit,
          unitPrice: item.unitPrice,
          sourceType: "PRICEBOOK_IMPORT",
          approvalStatus: "APPROVED",
          isActive: true,
          effectiveDate: now,
          effectiveQuarter: quarter,
        });
      }
      syncedCount++;
    }

    await db.update(vendorPricebooks)
      .set({ importedAt: new Date() })
      .where(eq(vendorPricebooks.id, pricebook.id));

    res.json({
      success: true,
      syncedItems: syncedCount,
      message: `Successfully synced ${syncedCount} items to catalog`,
    });
  } catch (error) {
    console.error("Sync pricebook error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
