import { Router } from "express";
import { db } from "./db";
import { hustlerOrganizations, organizations, users } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { type AuthRequest, requireAuth, requireRole } from "./auth";
import { logInfo, logError } from "./utils/logger";
import { z } from "zod";

const router = Router();

const linkOrganizationSchema = z.object({
  organizationId: z.string().uuid(),
  roleOverride: z.enum(["ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "OFFICE_MANAGER"]).optional(),
});

const switchOrganizationSchema = z.object({
  organizationId: z.string().uuid(),
});

router.get("/hustler/organizations", requireAuth, requireRole("HUSTLER"), async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const linkedOrgs = await db
      .select({
        id: hustlerOrganizations.id,
        organizationId: hustlerOrganizations.organizationId,
        roleOverride: hustlerOrganizations.roleOverride,
        isActive: hustlerOrganizations.isActive,
        createdAt: hustlerOrganizations.createdAt,
        organization: {
          id: organizations.id,
          name: organizations.name,
          slug: organizations.slug,
          tradeType: organizations.tradeType,
          tradeName: organizations.tradeName,
          logoUrl: organizations.logoUrl,
          primaryColor: organizations.primaryColor,
          region: organizations.region,
        },
      })
      .from(hustlerOrganizations)
      .innerJoin(organizations, eq(hustlerOrganizations.organizationId, organizations.id))
      .where(
        and(
          eq(hustlerOrganizations.userId, req.user.id),
          eq(hustlerOrganizations.isActive, true)
        )
      );

    const currentOrgId = req.user.organizationId;

    res.json({
      organizations: linkedOrgs,
      currentOrganizationId: currentOrgId,
      count: linkedOrgs.length,
    });
  } catch (error: any) {
    logError( `[Hustler] Failed to fetch organizations: ${error.message}`);
    res.status(500).json({ error: "Failed to fetch organizations" });
  }
});

router.post("/hustler/link-organization", requireAuth, requireRole("HUSTLER"), async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const validationResult = linkOrganizationSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ error: "Invalid input", details: validationResult.error.issues });
    }

    const { organizationId, roleOverride } = validationResult.data;

    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId));

    if (!org) {
      return res.status(404).json({ error: "Organization not found" });
    }

    const [existing] = await db
      .select()
      .from(hustlerOrganizations)
      .where(
        and(
          eq(hustlerOrganizations.userId, req.user.id),
          eq(hustlerOrganizations.organizationId, organizationId)
        )
      );

    if (existing) {
      if (!existing.isActive) {
        await db
          .update(hustlerOrganizations)
          .set({ isActive: true, roleOverride: roleOverride || "ADMIN" })
          .where(eq(hustlerOrganizations.id, existing.id));
        
        logInfo( `[Hustler] Reactivated org link: user=${req.user.id} org=${organizationId}`);
        return res.json({ success: true, message: "Organization link reactivated" });
      }
      return res.status(400).json({ error: "Already linked to this organization" });
    }

    const [newLink] = await db.insert(hustlerOrganizations).values({
      userId: req.user.id,
      organizationId,
      roleOverride: roleOverride || "ADMIN",
      isActive: true,
    }).returning();

    logInfo( `[Hustler] Linked org: user=${req.user.id} org=${organizationId}`);

    res.json({
      success: true,
      link: newLink,
      message: "Organization linked successfully",
    });
  } catch (error: any) {
    logError( `[Hustler] Failed to link organization: ${error.message}`);
    res.status(500).json({ error: "Failed to link organization" });
  }
});

router.post("/hustler/switch-organization", requireAuth, requireRole("HUSTLER"), async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const validationResult = switchOrganizationSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ error: "Invalid input", details: validationResult.error.issues });
    }

    const { organizationId } = validationResult.data;

    const [link] = await db
      .select()
      .from(hustlerOrganizations)
      .where(
        and(
          eq(hustlerOrganizations.userId, req.user.id),
          eq(hustlerOrganizations.organizationId, organizationId),
          eq(hustlerOrganizations.isActive, true)
        )
      );

    if (!link) {
      return res.status(404).json({ error: "Organization not found or not linked" });
    }

    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId));

    if (!org) {
      return res.status(404).json({ error: "Organization not found" });
    }

    await db
      .update(users)
      .set({ organizationId })
      .where(eq(users.id, req.user.id));

    logInfo( `[Hustler] Switched org: user=${req.user.id} from=${req.user.organizationId} to=${organizationId}`);

    res.json({
      success: true,
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        tradeType: org.tradeType,
        tradeName: org.tradeName,
      },
      roleOverride: link.roleOverride,
      message: `Switched to ${org.name}`,
    });
  } catch (error: any) {
    logError( `[Hustler] Failed to switch organization: ${error.message}`);
    res.status(500).json({ error: "Failed to switch organization" });
  }
});

router.delete("/hustler/unlink-organization/:organizationId", requireAuth, requireRole("HUSTLER"), async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { organizationId } = req.params;

    if (req.user.organizationId === organizationId) {
      return res.status(400).json({ error: "Cannot unlink your current active organization. Switch to another organization first." });
    }

    const [link] = await db
      .select()
      .from(hustlerOrganizations)
      .where(
        and(
          eq(hustlerOrganizations.userId, req.user.id),
          eq(hustlerOrganizations.organizationId, organizationId)
        )
      );

    if (!link) {
      return res.status(404).json({ error: "Organization link not found" });
    }

    await db
      .update(hustlerOrganizations)
      .set({ isActive: false })
      .where(eq(hustlerOrganizations.id, link.id));

    logInfo( `[Hustler] Unlinked org: user=${req.user.id} org=${organizationId}`);

    res.json({
      success: true,
      message: "Organization unlinked successfully",
    });
  } catch (error: any) {
    logError( `[Hustler] Failed to unlink organization: ${error.message}`);
    res.status(500).json({ error: "Failed to unlink organization" });
  }
});

router.get("/hustler/current-role", requireAuth, requireRole("HUSTLER"), async (req: AuthRequest, res) => {
  try {
    if (!req.user || !req.user.organizationId) {
      return res.status(400).json({ error: "No active organization" });
    }

    const [link] = await db
      .select()
      .from(hustlerOrganizations)
      .where(
        and(
          eq(hustlerOrganizations.userId, req.user.id),
          eq(hustlerOrganizations.organizationId, req.user.organizationId),
          eq(hustlerOrganizations.isActive, true)
        )
      );

    const effectiveRole = link?.roleOverride || req.user.role;

    res.json({
      userId: req.user.id,
      organizationId: req.user.organizationId,
      baseRole: req.user.role,
      effectiveRole,
      isHustler: true,
    });
  } catch (error: any) {
    logError( `[Hustler] Failed to get current role: ${error.message}`);
    res.status(500).json({ error: "Failed to get current role" });
  }
});

export default router;
