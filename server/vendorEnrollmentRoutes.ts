import { Router } from "express";
import { db } from "./db";
import { insertNotification } from "./services/notificationService";
import {
  crmOrganisations,
  vendorEnrollments,
  vendorUsers,
  vendorPricingCatalogs,
  auditLog, users, organizations, notifications,
} from "@shared/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { sendEmail } from "./email";
import { logAudit } from "./auditLogger";

const router = Router();

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

export default router;
