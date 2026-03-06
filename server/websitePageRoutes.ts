import express, { Request, Response } from "express";
import { randomUUID } from "crypto";
import { db } from "./db";
import { eq, and, desc, asc, sql } from "drizzle-orm";
import {
  organizationWebsitePages,
  organizationWebsites,
  organizations,
  pagePreviewLinks,
  pageVersions,
} from "@shared/schema";
import { requireAuth, AuthRequest } from "./auth";
import { logCreate, logUpdate, logDelete } from "./auditLogger";

const router = express.Router();

interface PresenceEntry {
  userId: string;
  userName: string;
  pageId: string;
  lastSeen: number;
  activity: "viewing" | "editing";
}

const presenceStore = new Map<string, PresenceEntry>();
const PRESENCE_TIMEOUT_MS = 30000;

function cleanExpiredPresence() {
  const now = Date.now();
  const keys = Array.from(presenceStore.keys());
  for (const key of keys) {
    const entry = presenceStore.get(key);
    if (entry && now - entry.lastSeen > PRESENCE_TIMEOUT_MS) {
      presenceStore.delete(key);
    }
  }
}

setInterval(cleanExpiredPresence, 15000);

function validateOrgAccess(req: AuthRequest, res: Response): string | null {
  const user = req.user!;
  if (user.role === "SUPER_ADMIN") {
    return null;
  }
  if (!user.organizationId) {
    res.status(403).json({ error: "No organization access" });
    return null;
  }
  return user.organizationId;
}

function orgLogoProxyUrl(orgId: string, url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("https://storage.googleapis.com/")) {
    return `/api/website/org-logo/${orgId}`;
  }
  return url;
}

// GET /api/website/pages - List all pages
router.get("/pages", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = validateOrgAccess(req, res);
    if (orgId === null && req.user?.role !== "SUPER_ADMIN") return;

    let pages = await db.query.organizationWebsitePages.findMany({
      where: orgId ? eq(organizationWebsitePages.organizationId, orgId) : undefined,
      orderBy: [asc(organizationWebsitePages.navigationOrder)],
    });

    if (orgId) {
      const website = await db.query.organizationWebsites.findFirst({
        where: eq(organizationWebsites.organizationId, orgId),
      });
      if (website) {
        const defaultPages = [
          { pageType: "HOME" as const, pageSlug: "home", pageTitle: "Homepage", navigationLabel: "Home", navigationOrder: 0 },
          { pageType: "SERVICES" as const, pageSlug: "services", pageTitle: "Services", navigationLabel: "Services", navigationOrder: 1 },
          { pageType: "ABOUT" as const, pageSlug: "about", pageTitle: "About", navigationLabel: "About", navigationOrder: 2 },
          { pageType: "CONTACT" as const, pageSlug: "contact", pageTitle: "Contact", navigationLabel: "Contact", navigationOrder: 3 },
        ];
        let created = false;
        for (const def of defaultPages) {
          if (!pages.some(p => p.pageType === def.pageType || p.pageSlug === def.pageSlug)) {
            const [newPage] = await db.insert(organizationWebsitePages)
              .values({
                websiteId: website.id,
                organizationId: orgId,
                pageType: def.pageType,
                pageSlug: def.pageSlug,
                pageTitle: def.pageTitle,
                navigationLabel: def.navigationLabel,
                showInNavigation: true,
                navigationOrder: def.navigationOrder,
                isPublished: true,
              })
              .returning();
            pages.push(newPage);
            created = true;
          }
        }
        if (created) {
          pages.sort((a, b) => (a.navigationOrder ?? 0) - (b.navigationOrder ?? 0));
        }
      }
    }

    res.json(pages);
  } catch (error) {
    console.error("Error fetching pages:", error);
    res.status(500).json({ error: "Failed to fetch pages" });
  }
});

// POST /api/website/pages - Create a new page
router.post("/pages", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const orgId = user.organizationId;
    if (!orgId && user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ error: "Organization access required" });
    }

    let website = await db.query.organizationWebsites.findFirst({
      where: eq(organizationWebsites.organizationId, orgId!),
    });

    if (!website) {
      return res.status(400).json({ error: "Please set up your website first" });
    }

    console.log("Creating page with request body:", JSON.stringify(req.body));

    const { pageType, pageTitle, pageSlug, navigationLabel, showInNavigation, parentPageId, ...rest } = req.body;

    if (parentPageId) {
      const parentPage = await db.query.organizationWebsitePages.findFirst({
        where: and(
          eq(organizationWebsitePages.id, parentPageId),
          eq(organizationWebsitePages.organizationId, orgId!)
        ),
      });
      if (!parentPage) {
        return res.status(400).json({ error: "Parent page not found in your organization" });
      }
      if (parentPage.parentPageId) {
        return res.status(400).json({ error: "Cannot nest pages more than one level deep" });
      }
    }

    const pageData = {
      ...rest,
      pageType: pageType || "CUSTOM",
      pageTitle: pageTitle || "",
      pageSlug: pageSlug || "",
      navigationLabel: navigationLabel || pageTitle || "",
      showInNavigation: showInNavigation !== undefined ? showInNavigation : true,
      parentPageId: parentPageId || null,
      websiteId: website.id,
      organizationId: orgId,
    };

    console.log("Page data to insert:", JSON.stringify(pageData));

    const [page] = await db.insert(organizationWebsitePages)
      .values(pageData)
      .returning();

    await logCreate(user.id, "organization_website_pages", page.id, pageData, req);

    res.status(201).json(page);
  } catch (error) {
    console.error("Error creating page:", error);
    res.status(500).json({ error: "Failed to create page" });
  }
});

// GET /api/website/pages/:id - Get a specific page
router.get("/pages/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const orgId = validateOrgAccess(req, res);
    if (orgId === null && req.user?.role !== "SUPER_ADMIN") return;

    const page = await db.query.organizationWebsitePages.findFirst({
      where: and(
        eq(organizationWebsitePages.id, id),
        orgId ? eq(organizationWebsitePages.organizationId, orgId) : undefined
      ),
    });

    if (!page) {
      return res.status(404).json({ error: "Page not found" });
    }

    res.json(page);
  } catch (error) {
    console.error("Error fetching page:", error);
    res.status(500).json({ error: "Failed to fetch page" });
  }
});

// PATCH /api/website/pages/:id - Update a page
router.patch("/pages/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const orgId = user.organizationId;
    
    const existing = await db.query.organizationWebsitePages.findFirst({
      where: and(
        eq(organizationWebsitePages.id, id),
        orgId ? eq(organizationWebsitePages.organizationId, orgId) : undefined
      ),
    });

    if (!existing) {
      return res.status(404).json({ error: "Page not found" });
    }

    if (req.body.parentPageId !== undefined && req.body.parentPageId) {
      if (req.body.parentPageId === id) {
        return res.status(400).json({ error: "A page cannot be its own parent" });
      }
      const parentPage = await db.query.organizationWebsitePages.findFirst({
        where: and(
          eq(organizationWebsitePages.id, req.body.parentPageId),
          eq(organizationWebsitePages.organizationId, existing.organizationId)
        ),
      });
      if (!parentPage) {
        return res.status(400).json({ error: "Parent page not found" });
      }
      if (parentPage.parentPageId) {
        return res.status(400).json({ error: "Cannot nest pages more than one level deep" });
      }
    }

    const isPublishing = req.body.isPublished === true && !existing.isPublished;

    const [updated] = await db.update(organizationWebsitePages)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(organizationWebsitePages.id, id))
      .returning();

    await logUpdate(user.id, "organization_website_pages", id, existing, updated, req);

    if (isPublishing) {
      try {
        await createVersionSnapshot(existing, user, "publish", "Published page");
      } catch (e) {
        console.error("Error creating version snapshot on publish:", e);
      }
    }

    res.json(updated);
  } catch (error) {
    console.error("Error updating page:", error);
    res.status(500).json({ error: "Failed to update page" });
  }
});

// DELETE /api/website/pages/:id - Delete a page
router.delete("/pages/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const orgId = user.organizationId;
    
    const existing = await db.query.organizationWebsitePages.findFirst({
      where: and(
        eq(organizationWebsitePages.id, id),
        orgId ? eq(organizationWebsitePages.organizationId, orgId) : undefined
      ),
    });

    if (!existing) {
      return res.status(404).json({ error: "Page not found" });
    }

    const corePageTypes = ["HOME", "SERVICES", "ABOUT", "CONTACT"];
    if (corePageTypes.includes(existing.pageType)) {
      return res.status(400).json({ error: "Cannot delete core navigation pages (Home, Services, About, Contact)." });
    }

    await db.delete(organizationWebsitePages)
      .where(eq(organizationWebsitePages.id, id));

    await logDelete(user.id, "organization_website_pages", id, existing, req);

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting page:", error);
    res.status(500).json({ error: "Failed to delete page" });
  }
});

// ==============================================
// Presence Routes
// ==============================================

router.post("/pages/:pageId/presence", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { pageId } = req.params;
    const user = req.user!;
    const activity = req.body.activity || "viewing";
    const userName = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || "Unknown";
    const key = `${user.id}:${pageId}`;

    presenceStore.set(key, {
      userId: user.id,
      userName,
      pageId,
      lastSeen: Date.now(),
      activity,
    });

    cleanExpiredPresence();

    const activeUsers: PresenceEntry[] = [];
    Array.from(presenceStore.values()).forEach(entry => {
      if (entry.pageId === pageId && entry.userId !== user.id) {
        activeUsers.push(entry);
      }
    });

    res.json({ users: activeUsers });
  } catch (error) {
    console.error("Error updating presence:", error);
    res.status(500).json({ error: "Failed to update presence" });
  }
});

router.delete("/pages/:pageId/presence", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { pageId } = req.params;
    const user = req.user!;
    presenceStore.delete(`${user.id}:${pageId}`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to remove presence" });
  }
});

// ==============================================
// Conflict-Safe Save Check
// ==============================================

router.get("/pages/:pageId/check-conflict", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { pageId } = req.params;
    const user = req.user!;
    const clientUpdatedAt = req.query.since as string;

    if (!clientUpdatedAt) {
      return res.json({ conflict: false });
    }

    const orgId = user.organizationId;
    const page = await db.query.organizationWebsitePages.findFirst({
      where: and(
        eq(organizationWebsitePages.id, pageId),
        orgId ? eq(organizationWebsitePages.organizationId, orgId) : undefined
      ),
    });

    if (!page) return res.status(404).json({ error: "Page not found" });

    const clientDate = new Date(clientUpdatedAt);
    const serverDate = new Date(page.updatedAt);
    const conflict = serverDate.getTime() > clientDate.getTime() + 1000;

    const lastVersion = conflict ? await db.query.pageVersions.findFirst({
      where: eq(pageVersions.pageId, pageId),
      orderBy: [desc(pageVersions.versionNumber)],
    }) : null;

    res.json({
      conflict,
      serverUpdatedAt: page.updatedAt,
      lastEditor: lastVersion?.editorName || null,
      lastSaved: lastVersion?.createdAt || null,
    });
  } catch (error) {
    console.error("Error checking conflict:", error);
    res.status(500).json({ error: "Failed to check conflict" });
  }
});

// ==============================================
// Version Diff Route
// ==============================================

router.get("/versions/diff/:versionIdA/:versionIdB", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { versionIdA, versionIdB } = req.params;
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const [versionA, versionB] = await Promise.all([
      db.query.pageVersions.findFirst({ where: eq(pageVersions.id, versionIdA) }),
      db.query.pageVersions.findFirst({ where: eq(pageVersions.id, versionIdB) }),
    ]);

    if (!versionA || !versionB) {
      return res.status(404).json({ error: "One or both versions not found" });
    }

    if (versionA.pageId !== versionB.pageId) {
      return res.status(400).json({ error: "Versions must belong to the same page" });
    }

    const parseComponents = (json: string | null) => {
      try {
        if (!json) return [];
        const parsed = JSON.parse(json);
        return parsed.components || [];
      } catch { return []; }
    };

    const parseSettings = (json: string | null) => {
      try {
        if (!json) return {};
        return JSON.parse(json);
      } catch { return {}; }
    };

    const compsA = parseComponents(versionA.contentJson);
    const compsB = parseComponents(versionB.contentJson);
    const settingsA = parseSettings(versionA.pageSettingsJson);
    const settingsB = parseSettings(versionB.pageSettingsJson);

    const idsA = new Set(compsA.map((c: any) => c.id));
    const idsB = new Set(compsB.map((c: any) => c.id));
    const compsMapA = new Map(compsA.map((c: any) => [c.id, c]));
    const compsMapB = new Map(compsB.map((c: any) => [c.id, c]));

    const diff: any[] = [];

    for (const comp of compsB) {
      if (!idsA.has(comp.id)) {
        diff.push({ id: comp.id, type: comp.type, label: comp.label, status: "added", component: comp });
      } else {
        const oldComp: any = compsMapA.get(comp.id);
        const oldJson = JSON.stringify(oldComp);
        const newJson = JSON.stringify(comp);
        if (oldJson !== newJson) {
          const changes: string[] = [];
          if (JSON.stringify(oldComp?.config) !== JSON.stringify(comp.config)) changes.push("content");
          if (JSON.stringify(oldComp?.styles) !== JSON.stringify(comp.styles)) changes.push("styles");
          if (oldComp?.label !== comp.label) changes.push("label");
          if (oldComp?.order !== comp.order) changes.push("order");
          if (oldComp?.enabled !== comp.enabled) changes.push("visibility");
          diff.push({ id: comp.id, type: comp.type, label: comp.label, status: "modified", changes, oldComponent: oldComp, component: comp });
        } else {
          diff.push({ id: comp.id, type: comp.type, label: comp.label, status: "unchanged" });
        }
      }
    }

    for (const comp of compsA) {
      if (!idsB.has(comp.id)) {
        diff.push({ id: comp.id, type: comp.type, label: comp.label, status: "removed", component: comp });
      }
    }

    const settingsChanges: any[] = [];
    const allKeysArr = Array.from(new Set([...Object.keys(settingsA), ...Object.keys(settingsB)]));
    for (const key of allKeysArr) {
      if (JSON.stringify(settingsA[key]) !== JSON.stringify(settingsB[key])) {
        settingsChanges.push({ field: key, oldValue: settingsA[key], newValue: settingsB[key] });
      }
    }

    res.json({
      versionA: { id: versionA.id, versionNumber: versionA.versionNumber, editorName: versionA.editorName, createdAt: versionA.createdAt, trigger: versionA.trigger },
      versionB: { id: versionB.id, versionNumber: versionB.versionNumber, editorName: versionB.editorName, createdAt: versionB.createdAt, trigger: versionB.trigger },
      componentDiff: diff,
      settingsChanges,
      summary: {
        added: diff.filter(d => d.status === "added").length,
        modified: diff.filter(d => d.status === "modified").length,
        removed: diff.filter(d => d.status === "removed").length,
        unchanged: diff.filter(d => d.status === "unchanged").length,
      },
    });
  } catch (error) {
    console.error("Error computing version diff:", error);
    res.status(500).json({ error: "Failed to compute version diff" });
  }
});

// ==============================================
// Version History Helper
// ==============================================
async function createVersionSnapshot(
  page: any,
  user: { id: string; firstName?: string | null; lastName?: string | null; email?: string | null },
  trigger: string,
  changeSummary: string
) {
  const lastVersion = await db.query.pageVersions.findFirst({
    where: eq(pageVersions.pageId, page.id),
    orderBy: [desc(pageVersions.versionNumber)],
  });
  const nextVersion = (lastVersion?.versionNumber ?? 0) + 1;
  const editorName = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || "Unknown";

  const pageSettingsJson = JSON.stringify({
    pageTitle: page.pageTitle,
    pageSlug: page.pageSlug,
    pageType: page.pageType,
    navigationLabel: page.navigationLabel,
    showInNavigation: page.showInNavigation,
    isPublished: page.isPublished,
    metaTitle: page.metaTitle,
    metaDescription: page.metaDescription,
  });

  const [version] = await db.insert(pageVersions).values({
    pageId: page.id,
    organizationId: page.organizationId,
    versionNumber: nextVersion,
    contentJson: page.contentJson,
    pageSettingsJson,
    editorId: user.id,
    editorName,
    changeSummary,
    trigger,
  }).returning();
  return version;
}

function generateChangeSummary(oldContent: string | null, newContent: string | null): string {
  try {
    const oldParsed = oldContent ? JSON.parse(oldContent) : { components: [] };
    const newParsed = newContent ? JSON.parse(newContent) : { components: [] };
    const oldCount = oldParsed.components?.length || 0;
    const newCount = newParsed.components?.length || 0;
    const parts: string[] = [];
    if (newCount > oldCount) parts.push(`Added ${newCount - oldCount} component(s)`);
    else if (newCount < oldCount) parts.push(`Removed ${oldCount - newCount} component(s)`);
    if (newCount === oldCount && newCount > 0) parts.push(`Updated ${newCount} component(s)`);
    if (parts.length === 0) return "Page content updated";
    return parts.join(", ");
  } catch {
    return "Page content updated";
  }
}

// ==============================================
// Preview Link Routes
// ==============================================

// POST /api/website/pages/:pageId/preview-link - Generate a preview link
router.post("/pages/:pageId/preview-link", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { pageId } = req.params;
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const orgId = user.organizationId;
    const page = await db.query.organizationWebsitePages.findFirst({
      where: and(
        eq(organizationWebsitePages.id, pageId),
        orgId ? eq(organizationWebsitePages.organizationId, orgId) : undefined
      ),
    });
    if (!page) return res.status(404).json({ error: "Page not found" });

    const expiresInHours = req.body.expiresInHours || 72;
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);
    const token = randomUUID();

    const [link] = await db.insert(pagePreviewLinks).values({
      pageId,
      organizationId: page.organizationId,
      token,
      createdById: user.id,
      expiresAt,
    }).returning();

    res.json(link);
  } catch (error) {
    console.error("Error creating preview link:", error);
    res.status(500).json({ error: "Failed to create preview link" });
  }
});

// GET /api/website/pages/:pageId/preview-links - List active preview links
router.get("/pages/:pageId/preview-links", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { pageId } = req.params;
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const links = await db.query.pagePreviewLinks.findMany({
      where: and(
        eq(pagePreviewLinks.pageId, pageId),
        sql`${pagePreviewLinks.revokedAt} IS NULL`,
        sql`${pagePreviewLinks.expiresAt} > NOW()`
      ),
      orderBy: [desc(pagePreviewLinks.createdAt)],
    });

    res.json(links);
  } catch (error) {
    console.error("Error listing preview links:", error);
    res.status(500).json({ error: "Failed to list preview links" });
  }
});

// DELETE /api/website/preview-links/:linkId - Revoke a preview link
router.delete("/preview-links/:linkId", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { linkId } = req.params;
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const [updated] = await db.update(pagePreviewLinks)
      .set({ revokedAt: new Date() })
      .where(eq(pagePreviewLinks.id, linkId))
      .returning();

    if (!updated) return res.status(404).json({ error: "Preview link not found" });
    res.json({ success: true });
  } catch (error) {
    console.error("Error revoking preview link:", error);
    res.status(500).json({ error: "Failed to revoke preview link" });
  }
});

// GET /api/website/shared-preview/:token - Public preview (no auth)
router.get("/shared-preview/:token", async (req: Request, res: Response) => {
  try {
    const { token } = req.params;

    const link = await db.query.pagePreviewLinks.findFirst({
      where: and(
        eq(pagePreviewLinks.token, token),
        sql`${pagePreviewLinks.revokedAt} IS NULL`,
        sql`${pagePreviewLinks.expiresAt} > NOW()`
      ),
    });

    if (!link) {
      return res.status(404).json({ error: "Preview link not found or expired" });
    }

    const page = await db.query.organizationWebsitePages.findFirst({
      where: eq(organizationWebsitePages.id, link.pageId),
    });

    if (!page) {
      return res.status(404).json({ error: "Page not found" });
    }

    const website = await db.query.organizationWebsites.findFirst({
      where: eq(organizationWebsites.id, page.websiteId),
    });

    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, page.organizationId),
    });

    res.set("Cache-Control", "no-store");
    res.json({
      page,
      website: website ? {
        ...website,
        logoUrl: orgLogoProxyUrl(page.organizationId, website.logoUrl),
      } : null,
      organization: org ? {
        name: org.name,
        tradeType: org.tradeType,
        logoUrl: orgLogoProxyUrl(page.organizationId, org.logoUrl),
      } : null,
      expiresAt: link.expiresAt,
    });
  } catch (error) {
    console.error("Error fetching shared preview:", error);
    res.status(500).json({ error: "Failed to fetch preview" });
  }
});

// ==============================================
// Version History Routes
// ==============================================

// POST /api/website/pages/:pageId/versions - Create a version snapshot manually
router.post("/pages/:pageId/versions", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { pageId } = req.params;
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const orgId = user.organizationId;
    const page = await db.query.organizationWebsitePages.findFirst({
      where: and(
        eq(organizationWebsitePages.id, pageId),
        orgId ? eq(organizationWebsitePages.organizationId, orgId) : undefined
      ),
    });
    if (!page) return res.status(404).json({ error: "Page not found" });

    const changeSummary = req.body.changeSummary || generateChangeSummary(null, page.contentJson);
    const version = await createVersionSnapshot(page, user, req.body.trigger || "manual", changeSummary);
    res.json(version);
  } catch (error) {
    console.error("Error creating version:", error);
    res.status(500).json({ error: "Failed to create version" });
  }
});

// GET /api/website/pages/:pageId/versions - List versions for a page
router.get("/pages/:pageId/versions", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { pageId } = req.params;
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const versions = await db.query.pageVersions.findMany({
      where: eq(pageVersions.pageId, pageId),
      orderBy: [desc(pageVersions.versionNumber)],
      limit: 50,
    });

    res.json(versions);
  } catch (error) {
    console.error("Error listing versions:", error);
    res.status(500).json({ error: "Failed to list versions" });
  }
});

// GET /api/website/versions/:versionId - Get a specific version
router.get("/versions/:versionId", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { versionId } = req.params;
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const version = await db.query.pageVersions.findFirst({
      where: eq(pageVersions.id, versionId),
    });

    if (!version) return res.status(404).json({ error: "Version not found" });
    res.json(version);
  } catch (error) {
    console.error("Error fetching version:", error);
    res.status(500).json({ error: "Failed to fetch version" });
  }
});

// POST /api/website/pages/:pageId/revert/:versionId - Revert to a version
router.post("/pages/:pageId/revert/:versionId", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { pageId, versionId } = req.params;
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const orgId = user.organizationId;
    const currentPage = await db.query.organizationWebsitePages.findFirst({
      where: and(
        eq(organizationWebsitePages.id, pageId),
        orgId ? eq(organizationWebsitePages.organizationId, orgId) : undefined
      ),
    });
    if (!currentPage) return res.status(404).json({ error: "Page not found" });

    const targetVersion = await db.query.pageVersions.findFirst({
      where: and(
        eq(pageVersions.id, versionId),
        eq(pageVersions.pageId, pageId)
      ),
    });
    if (!targetVersion) return res.status(404).json({ error: "Version not found" });

    await createVersionSnapshot(currentPage, user, "revert", `Reverted to version ${targetVersion.versionNumber}`);

    const settingsToRestore: any = { contentJson: targetVersion.contentJson, updatedAt: new Date() };
    if (targetVersion.pageSettingsJson) {
      try {
        const settings = JSON.parse(targetVersion.pageSettingsJson);
        if (settings.pageTitle) settingsToRestore.pageTitle = settings.pageTitle;
        if (settings.pageSlug) settingsToRestore.pageSlug = settings.pageSlug;
        if (settings.navigationLabel !== undefined) settingsToRestore.navigationLabel = settings.navigationLabel;
        if (settings.showInNavigation !== undefined) settingsToRestore.showInNavigation = settings.showInNavigation;
        if (settings.metaTitle !== undefined) settingsToRestore.metaTitle = settings.metaTitle;
        if (settings.metaDescription !== undefined) settingsToRestore.metaDescription = settings.metaDescription;
      } catch {}
    }

    const [updated] = await db.update(organizationWebsitePages)
      .set(settingsToRestore)
      .where(eq(organizationWebsitePages.id, pageId))
      .returning();

    res.json(updated);
  } catch (error) {
    console.error("Error reverting version:", error);
    res.status(500).json({ error: "Failed to revert to version" });
  }
});

export default router;