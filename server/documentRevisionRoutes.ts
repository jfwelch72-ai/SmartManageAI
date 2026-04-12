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
  } catch (err) {
    next(err);
  }
});

router.get("/revisions/:id/preview-url", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;
    const revision = await docService.getRevisionById(orgId, req.params.id);
    if (!revision) return res.status(404).json({ error: "Revision not found" });
    if (!revision.storageKey) return res.status(404).json({ error: "No file associated with this revision" });

    try {
      const { ObjectStorageService } = await import("./objectStorage");
      const objectStorageService = new ObjectStorageService();
      const objectFile = await objectStorageService.getObjectEntityFile(revision.storageKey);
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
