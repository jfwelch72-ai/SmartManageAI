import { logError } from "./utils/logger";
import { Router, Response, NextFunction } from "express";
import { db } from "./db";
import { lidarScans, lidarAnnotations, lidarComparisons, projects } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { verifyOrgAccess } from "./orgFilter";
import { isFeatureEnabled } from "./services/featureFlagService";

const router = Router();

async function requireLidarFeature(req: AuthRequest, res: Response, next: NextFunction) {
  const user = req.user;
  if (!user) return res.status(401).json({ error: "Authentication required" });
  if (user.role === "SUPER_ADMIN") return next();
  if (!user.organizationId) return res.status(403).json({ error: "Organization required" });
  const enabled = await isFeatureEnabled(user.organizationId, "LIDAR_SCANNER");
  if (!enabled) return res.status(403).json({ error: "LiDAR Scanner is not enabled for this organization" });
  return next();
}

const createScanSchema = z.object({
  projectId: z.string().min(1),
  fileName: z.string().min(1),
  fileUrl: z.string().min(1),
  fileSize: z.number().int().positive().optional(),
  fileFormat: z.string().optional(),
  captureDate: z.coerce.date().optional(),
  captureDevice: z.string().optional(),
  location: z.string().optional(),
  notes: z.string().optional(),
  pointCount: z.number().int().positive().optional(),
  thumbnailUrl: z.string().optional(),
  metadata: z.string().optional(),
});

const updateScanSchema = z.object({
  fileName: z.string().min(1).optional(),
  status: z.enum(["UPLOADING", "PROCESSING", "READY", "ERROR"]).optional(),
  captureDate: z.coerce.date().optional(),
  captureDevice: z.string().optional(),
  location: z.string().optional(),
  notes: z.string().optional(),
  pointCount: z.number().int().positive().optional(),
  thumbnailUrl: z.string().optional(),
  metadata: z.string().optional(),
});

const LIDAR_READ_ROLES = ["ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "FIELD_WORKER", "HUSTLER"] as const;

router.get("/api/projects/:projectId/lidar-scans", requireAuth, requireLidarFeature, requireRole(...LIDAR_READ_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { projectId } = req.params;
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const scans = await db.select().from(lidarScans)
      .where(eq(lidarScans.projectId, projectId))
      .orderBy(desc(lidarScans.createdAt));

    res.json(scans);
  } catch (error) {
    next(error);
  }
});

router.get("/api/lidar-scans", requireAuth, requireLidarFeature, requireRole(...LIDAR_READ_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId;
    if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

    const scans = await db.select().from(lidarScans)
      .where(eq(lidarScans.organizationId, orgId))
      .orderBy(desc(lidarScans.createdAt));

    res.json(scans);
  } catch (error) {
    next(error);
  }
});

router.get("/api/lidar-scans/:id", requireAuth, requireLidarFeature, requireRole(...LIDAR_READ_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const [scan] = await db.select().from(lidarScans).where(eq(lidarScans.id, req.params.id)).limit(1);
    if (!scan) { res.status(404).json({ error: "Scan not found" }); return; }
    if (!verifyOrgAccess(req, res, scan.organizationId)) return;

    res.json(scan);
  } catch (error) {
    next(error);
  }
});

router.post("/api/lidar-scans", requireAuth, requireLidarFeature, requireRole("ADMIN", "MANAGER", "FIELD_WORKER", "HUSTLER"), async (req: AuthRequest, res, next) => {
  try {
    const parsed = createScanSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid input", details: parsed.error.errors }); return; }

    const [project] = await db.select().from(projects).where(eq(projects.id, parsed.data.projectId)).limit(1);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const [scan] = await db.insert(lidarScans).values({
      ...parsed.data,
      organizationId: req.user!.organizationId!,
      uploadedById: req.user!.id,
      captureDate: parsed.data.captureDate ?? null,
    }).returning();

    res.status(201).json(scan);
  } catch (error) {
    next(error);
  }
});

router.patch("/api/lidar-scans/:id", requireAuth, requireLidarFeature, requireRole("ADMIN", "MANAGER", "HUSTLER"), async (req: AuthRequest, res, next) => {
  try {
    const [scan] = await db.select().from(lidarScans).where(eq(lidarScans.id, req.params.id)).limit(1);
    if (!scan) { res.status(404).json({ error: "Scan not found" }); return; }
    if (!verifyOrgAccess(req, res, scan.organizationId)) return;

    const parsed = updateScanSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid input", details: parsed.error.errors }); return; }

    const [updated] = await db.update(lidarScans)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(lidarScans.id, req.params.id))
      .returning();

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.delete("/api/lidar-scans/:id", requireAuth, requireLidarFeature, requireRole("ADMIN", "MANAGER", "HUSTLER"), async (req: AuthRequest, res, next) => {
  try {
    const [scan] = await db.select().from(lidarScans).where(eq(lidarScans.id, req.params.id)).limit(1);
    if (!scan) { res.status(404).json({ error: "Scan not found" }); return; }
    if (!verifyOrgAccess(req, res, scan.organizationId)) return;

    await db.delete(lidarScans).where(eq(lidarScans.id, req.params.id));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

const createAnnotationSchema = z.object({
  scanId: z.string().min(1),
  type: z.enum(["DISTANCE", "AREA", "VOLUME", "NOTE"]),
  label: z.string().min(1),
  points: z.string().min(1),
  value: z.number().optional(),
  unit: z.string().optional(),
  note: z.string().optional(),
  color: z.string().optional(),
});

router.get("/api/lidar-scans/:scanId/annotations", requireAuth, requireLidarFeature, requireRole(...LIDAR_READ_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const [scan] = await db.select().from(lidarScans).where(eq(lidarScans.id, req.params.scanId)).limit(1);
    if (!scan) { res.status(404).json({ error: "Scan not found" }); return; }
    if (!verifyOrgAccess(req, res, scan.organizationId)) return;

    const annotations = await db.select().from(lidarAnnotations)
      .where(eq(lidarAnnotations.scanId, req.params.scanId))
      .orderBy(desc(lidarAnnotations.createdAt));

    res.json(annotations);
  } catch (error) {
    next(error);
  }
});

router.post("/api/lidar-scans/:scanId/annotations", requireAuth, requireLidarFeature, requireRole("ADMIN", "MANAGER", "FIELD_WORKER", "HUSTLER"), async (req: AuthRequest, res, next) => {
  try {
    const [scan] = await db.select().from(lidarScans).where(eq(lidarScans.id, req.params.scanId)).limit(1);
    if (!scan) { res.status(404).json({ error: "Scan not found" }); return; }
    if (!verifyOrgAccess(req, res, scan.organizationId)) return;

    const parsed = createAnnotationSchema.safeParse({ ...req.body, scanId: req.params.scanId });
    if (!parsed.success) { res.status(400).json({ error: "Invalid input", details: parsed.error.errors }); return; }

    const [annotation] = await db.insert(lidarAnnotations).values({
      ...parsed.data,
      createdById: req.user!.id,
    }).returning();

    res.status(201).json(annotation);
  } catch (error) {
    next(error);
  }
});

router.delete("/api/lidar-annotations/:id", requireAuth, requireLidarFeature, requireRole("ADMIN", "MANAGER", "HUSTLER"), async (req: AuthRequest, res, next) => {
  try {
    const [annotation] = await db.select().from(lidarAnnotations).where(eq(lidarAnnotations.id, req.params.id)).limit(1);
    if (!annotation) { res.status(404).json({ error: "Annotation not found" }); return; }

    const [scan] = await db.select().from(lidarScans).where(eq(lidarScans.id, annotation.scanId)).limit(1);
    if (!scan) { res.status(404).json({ error: "Scan not found" }); return; }
    if (!verifyOrgAccess(req, res, scan.organizationId)) return;

    await db.delete(lidarAnnotations).where(eq(lidarAnnotations.id, req.params.id));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

const createComparisonSchema = z.object({
  projectId: z.string().min(1),
  type: z.enum(["SCAN_VS_SCAN", "SCAN_VS_BIM"]),
  name: z.string().min(1),
  scanAId: z.string().min(1),
  scanBId: z.string().optional(),
  bimDocumentId: z.string().optional(),
  bimDocumentUrl: z.string().optional(),
  toleranceMm: z.number().positive().optional(),
  notes: z.string().optional(),
});

router.get("/api/projects/:projectId/lidar-comparisons", requireAuth, requireLidarFeature, requireRole(...LIDAR_READ_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.id, req.params.projectId)).limit(1);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const comparisons = await db.select().from(lidarComparisons)
      .where(eq(lidarComparisons.projectId, req.params.projectId))
      .orderBy(desc(lidarComparisons.createdAt));

    res.json(comparisons);
  } catch (error) {
    next(error);
  }
});

router.post("/api/lidar-comparisons", requireAuth, requireLidarFeature, requireRole("ADMIN", "MANAGER", "HUSTLER"), async (req: AuthRequest, res, next) => {
  try {
    const parsed = createComparisonSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid input", details: parsed.error.errors }); return; }

    const [project] = await db.select().from(projects).where(eq(projects.id, parsed.data.projectId)).limit(1);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    if (parsed.data.type === "SCAN_VS_SCAN" && !parsed.data.scanBId) {
      res.status(400).json({ error: "scanBId is required for scan-vs-scan comparisons" });
      return;
    }
    if (parsed.data.type === "SCAN_VS_BIM" && !parsed.data.bimDocumentUrl) {
      res.status(400).json({ error: "bimDocumentUrl is required for scan-vs-BIM comparisons" });
      return;
    }

    const [scanA] = await db.select().from(lidarScans).where(eq(lidarScans.id, parsed.data.scanAId)).limit(1);
    if (!scanA) { res.status(404).json({ error: "Scan A not found" }); return; }
    if (scanA.organizationId !== req.user!.organizationId) {
      res.status(403).json({ error: "Scan A does not belong to your organization" });
      return;
    }
    if (scanA.projectId !== parsed.data.projectId) {
      res.status(400).json({ error: "Scan A does not belong to the specified project" });
      return;
    }

    if (parsed.data.scanBId) {
      const [scanB] = await db.select().from(lidarScans).where(eq(lidarScans.id, parsed.data.scanBId)).limit(1);
      if (!scanB) { res.status(404).json({ error: "Scan B not found" }); return; }
      if (scanB.organizationId !== req.user!.organizationId) {
        res.status(403).json({ error: "Scan B does not belong to your organization" });
        return;
      }
      if (scanB.projectId !== parsed.data.projectId) {
        res.status(400).json({ error: "Scan B does not belong to the specified project" });
        return;
      }
    }

    const [comparison] = await db.insert(lidarComparisons).values({
      ...parsed.data,
      organizationId: req.user!.organizationId!,
      createdById: req.user!.id,
    }).returning();

    res.status(201).json(comparison);
  } catch (error) {
    next(error);
  }
});

router.delete("/api/lidar-comparisons/:id", requireAuth, requireLidarFeature, requireRole("ADMIN", "MANAGER", "HUSTLER"), async (req: AuthRequest, res, next) => {
  try {
    const [comparison] = await db.select().from(lidarComparisons).where(eq(lidarComparisons.id, req.params.id)).limit(1);
    if (!comparison) { res.status(404).json({ error: "Comparison not found" }); return; }
    if (!verifyOrgAccess(req, res, comparison.organizationId)) return;

    await db.delete(lidarComparisons).where(eq(lidarComparisons.id, req.params.id));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
