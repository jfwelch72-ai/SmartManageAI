import { Router, Response, NextFunction } from "express";
import { promises as fs } from "fs";
import path from "path";
import { requireAuth, AuthRequest, requireRole } from "./auth";

const router = Router();

const DOCS_DIR = path.resolve("docs/features");

const VALID_MODULES = new Set([
  "auth",
  "onboarding",
  "dashboard",
  "estimating",
  "takeoff",
  "projects",
  "field-ops",
  "financials",
  "procurement",
  "document-control",
  "heavy-civil-dot",
  "crm",
  "equipment",
  "inventory",
  "safety",
  "workforce",
  "messaging",
  "notifications",
  "portals",
  "website-builder",
  "integrations",
  "ai-orchestration",
  "platform-admin",
  "vendor-marketplace",
]);

router.get(
  "/api/dev-docs/search",
  requireAuth,
  requireRole("SUPER_ADMIN", "ADMIN"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      if (!q || q.length < 2) {
        return res.json({ results: [] });
      }

      const lowerQ = q.toLowerCase();
      const results: Array<{ module: string; title: string; snippets: string[]; totalMatches: number }> = [];

      for (const moduleId of VALID_MODULES) {
        const filePath = path.join(DOCS_DIR, `${moduleId}.md`);
        let content: string;
        try {
          content = await fs.readFile(filePath, "utf-8");
        } catch {
          continue;
        }

        const lines = content.split("\n");
        const snippets: string[] = [];
        const seenRanges: Array<[number, number]> = [];

        for (let i = 0; i < lines.length && snippets.length < 4; i++) {
          const stripped = lines[i].trim();
          if (!stripped || !stripped.toLowerCase().includes(lowerQ)) continue;

          const start = Math.max(0, i - 1);
          const end = Math.min(lines.length - 1, i + 1);

          const overlaps = seenRanges.some(([s, e]) => start <= e && end >= s);
          if (overlaps) continue;
          seenRanges.push([start, end]);

          const ctx = lines
            .slice(start, end + 1)
            .map((l) => l.trim())
            .filter(Boolean)
            .join(" … ");
          snippets.push(ctx.slice(0, 280));
        }

        if (snippets.length > 0) {
          const totalMatches = lines.filter((l) =>
            l.toLowerCase().includes(lowerQ)
          ).length;
          const title = moduleId
            .split("-")
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" ");
          results.push({ module: moduleId, title, snippets, totalMatches });
        }
      }

      res.json({ results });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/api/dev-docs/:module",
  requireAuth,
  requireRole("SUPER_ADMIN", "ADMIN"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { module } = req.params;

      if (!VALID_MODULES.has(module)) {
        return res.status(404).json({ error: "Module not found" });
      }

      const filePath = path.join(DOCS_DIR, `${module}.md`);

      let content: string;
      try {
        content = await fs.readFile(filePath, "utf-8");
      } catch {
        return res.status(404).json({ error: "Documentation file not found" });
      }

      res.json({ module, content });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/api/dev-docs",
  requireAuth,
  requireRole("SUPER_ADMIN", "ADMIN"),
  async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const modules = Array.from(VALID_MODULES).map((id) => ({
        id,
        title: id
          .split("-")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" "),
      }));
      res.json({ modules });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
