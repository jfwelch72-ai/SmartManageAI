import { Router } from "express";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import * as docService from "./services/documentRevisionService";
import { getOrgId, getUserOrThrow } from "./utils/routeHelpers";
import {logError, logWarn } from "./utils/logger";

const router = Router();

router.get("/revisions/:id", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;
    const revision = await docService.getRevisionById(orgId, req.params.id);
    if (!revision) return res.status(404).json({ error: "Revision not found" });
    res.json(revision);
  } catch (err) {
    next(err);
  }
});

router.post("/revisions/:id/supersede", requireAuth, requireRole("SUPER_ADMIN", "ADMIN"), async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;
    const result = await docService.supersedeRevision(orgId, req.params.id);
    if (!result) return res.status(404).json({ error: "Revision not found" });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get("/:docId/revisions", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;
    const revisions = await docService.getRevisionHistory(orgId, req.params.docId);
    res.json(revisions);
  } catch (err) {
    next(err);
  }
});

router.post("/:docId/revisions", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
  try {
    const user = getUserOrThrow(req, res);
    if (!user) return;
    const orgId = getOrgId(req, res);
    if (!orgId) return;
    const { sourceType, storageKey, checksum, metadata } = req.body;
    if (!storageKey) return res.status(400).json({ error: "storageKey required" });
    try {
      const revision = await docService.createRevision(
        orgId,
        req.params.docId,
        sourceType || "upload",
        storageKey,
        user.id,
        metadata,
        checksum
      );
      res.status(201).json(revision);
    } catch (err: any) {
      if (err?.status && typeof err.status === "number") {
        return res.status(err.status).json({ error: err.message || "Request failed" });
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

router.get("/revisions/:id/preview-url", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const user = getUserOrThrow(req, res);
    if (!user) return;
    const orgId = getOrgId(req, res);
    if (!orgId) return;
    const revision = await docService.getRevisionById(orgId, req.params.id);
    if (!revision) return res.status(404).json({ error: "Revision not found" });
    if (!revision.storageKey) return res.status(404).json({ error: "No file associated with this revision" });

    try {
      const { ObjectStorageService } = await import("./objectStorage");
      const { ObjectPermission } = await import("./objectAcl");
      const objectStorageService = new ObjectStorageService();
      const normalized = objectStorageService.normalizeObjectEntityPath(revision.storageKey);
      const objectFile = await objectStorageService.getObjectEntityFile(normalized);

      // Task #492: enforce ACL on the underlying object before streaming so a
      // malformed/cross-tenant revision row cannot leak another org's bytes.
      const allowed = await objectStorageService.canAccessObjectEntity({
        userId: user.id,
        userOrganizationId: orgId,
        objectFile,
        requestedPermission: ObjectPermission.READ,
        userRole: user.effectiveRole || user.role,
      });
      if (!allowed) {
        return res.status(403).json({ error: "Forbidden" });
      }

      await objectStorageService.downloadObject(objectFile, res, 3600);
    } catch (downloadErr) {
      logWarn("Non-critical operation failed");
      if (!res.headersSent) {
        next(downloadErr);
      }
    }
  } catch (err) {
    if (!res.headersSent) {
      next(err);
    }
  }
});

router.get("/:docId/compare", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;
    const { rev1, rev2 } = req.query;
    if (!rev1 || !rev2) return res.status(400).json({ error: "rev1 and rev2 query params required" });
    const comparison = await docService.compareRevisions(orgId, rev1 as string, rev2 as string);
    if (!comparison) return res.status(404).json({ error: "Revisions not found" });
    res.json(comparison);
  } catch (err) {
    next(err);
  }
});

export default router;
