import { Router } from "express";
import { requireAuth } from "./auth";
import * as docService from "./services/documentRevisionService";
import { logError } from "./utils/logger";

const router = Router();

router.get("/:docId/revisions", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    const revisions = await docService.getRevisionHistory(user.organizationId, req.params.docId);
    res.json(revisions);
  } catch (err) {
    logError("Failed to list revisions", { error: String(err) });
    res.status(500).json({ error: "Failed to list revisions" });
  }
});

router.post("/:docId/revisions", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const { sourceType, storageKey, checksum, metadata } = req.body;
    if (!storageKey) return res.status(400).json({ error: "storageKey required" });
    const revision = await docService.createRevision(
      user.organizationId,
      req.params.docId,
      sourceType || "upload",
      storageKey,
      user.id,
      metadata,
      checksum
    );
    res.status(201).json(revision);
  } catch (err) {
    logError("Failed to create revision", { error: String(err) });
    res.status(500).json({ error: "Failed to create revision" });
  }
});

router.get("/revisions/:id", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    const revision = await docService.getRevisionById(user.organizationId, req.params.id);
    if (!revision) return res.status(404).json({ error: "Revision not found" });
    res.json(revision);
  } catch (err) {
    res.status(500).json({ error: "Failed to get revision" });
  }
});

router.post("/revisions/:id/supersede", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const result = await docService.supersedeRevision(user.organizationId, req.params.id);
    if (!result) return res.status(404).json({ error: "Revision not found" });
    res.json(result);
  } catch (err) {
    logError("Failed to supersede revision", { error: String(err) });
    res.status(500).json({ error: "Failed to supersede" });
  }
});

router.get("/:docId/compare", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    const { rev1, rev2 } = req.query;
    if (!rev1 || !rev2) return res.status(400).json({ error: "rev1 and rev2 query params required" });
    const comparison = await docService.compareRevisions(user.organizationId, rev1 as string, rev2 as string);
    if (!comparison) return res.status(404).json({ error: "Revisions not found" });
    res.json(comparison);
  } catch (err) {
    res.status(500).json({ error: "Failed to compare revisions" });
  }
});

export default router;
