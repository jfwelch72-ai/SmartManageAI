import { Router } from "express";
import { db } from "../db";
import { projects, bids, changeOrders, rfis, submittals, integrationWebhookSubscriptions, integrationConnections, PUBLIC_API_EVENT_TYPES, PUBLIC_API_SCOPES } from "@shared/schema";
import { and, eq, desc, inArray, sql } from "drizzle-orm";
import { publicApiAuth, publicApiError } from "./middleware";
import * as keyService from "./apiKeyService";
import { z } from "zod";
import crypto from "crypto";
import oauthRoutes from "./oauthRoutes";
import { assertWebhookUrlSafe } from "../integrations/webhookService";

const router = Router();

router.use("/oauth", oauthRoutes);

/**
 * @swagger
 * tags:
 *   - name: Public API
 * /api/v1/public:
 *   get:
 *     tags: [Public API]
 *     summary: Public API discovery / root document
 *     description: Returns API metadata, supported scopes, webhook event catalog, and authentication scheme info. No authentication required.
 *     responses:
 *       200:
 *         description: API metadata
 */
router.get("/", (_req, res) => {
  res.json({
    name: "Public API v1",
    version: "1.0.0",
    docs: "/api-docs",
    scopes: PUBLIC_API_SCOPES,
    events: PUBLIC_API_EVENT_TYPES,
    auth: { schemes: ["Bearer", "X-API-Key"], header: "Authorization: Bearer ckp_xxxx.yyyy" },
  });
});

/**
 * @swagger
 * /api/v1/public/health:
 *   get:
 *     tags: [Public API]
 *     summary: Authenticated health probe
 *     security:
 *       - publicApiKey: []
 *       - publicApiOAuth: []
 *     responses:
 *       200: { description: API is reachable and credentials are valid }
 *       401: { description: Missing or invalid credentials }
 */
// ---- Health ----
router.get("/health", publicApiAuth(), async (req, res) => {
  res.json({ ok: true, organizationId: req.orgId, keyId: req.apiKey!.id, ts: new Date().toISOString() });
});

// ---- Pagination helper ----
function parsePagination(req: any): { page: number; limit: number; offset: number } {
  const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || "50"), 10) || 50));
  return { page, limit, offset: (page - 1) * limit };
}

/**
 * @swagger
 * /api/v1/public/projects:
 *   get:
 *     tags: [Public API]
 *     summary: List projects
 *     security: [{ publicApiKey: [] }, { publicApiOAuth: [projects:read] }]
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *     responses:
 *       200: { description: Page of projects scoped to the authenticated organization }
 *       401: { description: Missing or invalid credentials }
 *       403: { description: Missing required scope projects:read }
 *       429: { description: Rate limit exceeded }
 * /api/v1/public/projects/{id}:
 *   get:
 *     tags: [Public API]
 *     summary: Get a single project
 *     security: [{ publicApiKey: [] }, { publicApiOAuth: [projects:read] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Project }
 *       404: { description: Not found or not in your organization }
 * /api/v1/public/bids:
 *   get:
 *     tags: [Public API]
 *     summary: List bids
 *     security: [{ publicApiKey: [] }, { publicApiOAuth: [bids:read] }]
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *     responses:
 *       200: { description: Page of bids }
 * /api/v1/public/change-orders:
 *   get:
 *     tags: [Public API]
 *     summary: List change orders
 *     security: [{ publicApiKey: [] }, { publicApiOAuth: [change_orders:read] }]
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *     responses:
 *       200: { description: Page of change orders }
 * /api/v1/public/rfis:
 *   get:
 *     tags: [Public API]
 *     summary: List RFIs
 *     security: [{ publicApiKey: [] }, { publicApiOAuth: [rfis:read] }]
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *     responses:
 *       200: { description: Page of RFIs }
 * /api/v1/public/submittals:
 *   get:
 *     tags: [Public API]
 *     summary: List submittals
 *     security: [{ publicApiKey: [] }, { publicApiOAuth: [submittals:read] }]
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *     responses:
 *       200: { description: Page of submittals }
 * /api/v1/public/webhooks:
 *   get:
 *     tags: [Public API]
 *     summary: List webhook subscriptions
 *     security: [{ publicApiKey: [] }, { publicApiOAuth: [webhooks:manage] }]
 *     responses:
 *       200: { description: List of subscriptions (secrets masked) }
 *   post:
 *     tags: [Public API]
 *     summary: Create a webhook subscription
 *     description: Outbound deliveries are signed with HMAC-SHA256 using the returned secret in header X-Webhook-Signature, with timestamp in X-Webhook-Timestamp.
 *     security: [{ publicApiKey: [] }, { publicApiOAuth: [webhooks:manage] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [eventType, targetUrl]
 *             properties:
 *               eventType:
 *                 type: string
 *                 description: One of the supported event types (see GET /api/v1/public for catalog)
 *               targetUrl:
 *                 type: string
 *                 format: uri
 *                 description: HTTPS URL that will receive POST deliveries
 *     responses:
 *       201: { description: Subscription created (secret returned ONCE) }
 *       400: { description: Invalid payload }
 * /api/v1/public/webhooks/{id}:
 *   delete:
 *     tags: [Public API]
 *     summary: Disable a webhook subscription
 *     security: [{ publicApiKey: [] }, { publicApiOAuth: [webhooks:manage] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Subscription disabled }
 *       404: { description: Not found }
 */
// ---- Projects ----
router.get("/projects", publicApiAuth("projects:read"), async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req);
    const rows = await db.select().from(projects)
      .where(eq(projects.gcOrganizationId, req.orgId!))
      .orderBy(desc(projects.createdAt))
      .limit(limit).offset(offset);
    res.json({ data: rows, pagination: { page, limit, count: rows.length } });
  } catch (err) { next(err); }
});

router.get("/projects/:id", publicApiAuth("projects:read"), async (req, res, next) => {
  try {
    const [row] = await db.select().from(projects)
      .where(and(eq(projects.id, req.params.id), eq(projects.gcOrganizationId, req.orgId!)))
      .limit(1);
    if (!row) return res.status(404).json({ error: "Not found", code: "not_found" });
    res.json(row);
  } catch (err) { next(err); }
});

// ---- Bids ----
router.get("/bids", publicApiAuth("bids:read"), async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req);
    const rows = await db.select().from(bids)
      .where(eq(bids.gcOrganizationId, req.orgId!))
      .orderBy(desc(bids.createdAt))
      .limit(limit).offset(offset);
    res.json({ data: rows, pagination: { page, limit, count: rows.length } });
  } catch (err) { next(err); }
});

async function getOrgProjectIds(orgId: string): Promise<string[]> {
  const rows = await db.select({ id: projects.id }).from(projects).where(eq(projects.gcOrganizationId, orgId));
  return rows.map(r => r.id);
}

// ---- Change orders ----
router.get("/change-orders", publicApiAuth("change_orders:read"), async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req);
    const ids = await getOrgProjectIds(req.orgId!);
    if (ids.length === 0) return res.json({ data: [], pagination: { page, limit, count: 0 } });
    const rows = await db.select().from(changeOrders)
      .where(inArray(changeOrders.projectId, ids))
      .orderBy(desc(changeOrders.createdAt))
      .limit(limit).offset(offset);
    res.json({ data: rows, pagination: { page, limit, count: rows.length } });
  } catch (err) { next(err); }
});

// ---- RFIs ----
router.get("/rfis", publicApiAuth("rfis:read"), async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req);
    const ids = await getOrgProjectIds(req.orgId!);
    if (ids.length === 0) return res.json({ data: [], pagination: { page, limit, count: 0 } });
    const rows = await db.select().from(rfis)
      .where(inArray(rfis.projectId, ids))
      .orderBy(desc(rfis.createdAt))
      .limit(limit).offset(offset);
    res.json({ data: rows, pagination: { page, limit, count: rows.length } });
  } catch (err) { next(err); }
});

// ---- Submittals ----
router.get("/submittals", publicApiAuth("submittals:read"), async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req);
    const ids = await getOrgProjectIds(req.orgId!);
    if (ids.length === 0) return res.json({ data: [], pagination: { page, limit, count: 0 } });
    const rows = await db.select().from(submittals)
      .where(inArray(submittals.projectId, ids))
      .orderBy(desc(submittals.createdAt))
      .limit(limit).offset(offset);
    res.json({ data: rows, pagination: { page, limit, count: rows.length } });
  } catch (err) { next(err); }
});

// ---- Webhook subscription management ----
const webhookCreateSchema = z.object({
  eventType: z.enum(PUBLIC_API_EVENT_TYPES as unknown as [string, ...string[]]),
  targetUrl: z.string().url(),
});

router.get("/webhooks", publicApiAuth("webhooks:manage"), async (req, res, next) => {
  try {
    const rows = await db.select().from(integrationWebhookSubscriptions)
      .where(eq(integrationWebhookSubscriptions.organizationId, req.orgId!))
      .orderBy(desc(integrationWebhookSubscriptions.createdAt));
    res.json({ data: rows.map(r => ({ ...r, secret: r.secret ? `${(r.secret as string).slice(0, 8)}...` : null })) });
  } catch (err) { next(err); }
});

router.post("/webhooks", publicApiAuth("webhooks:manage"), async (req, res, next) => {
  try {
    const parsed = webhookCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    const { eventType, targetUrl } = parsed.data;
    try { await assertWebhookUrlSafe(targetUrl); } catch (e: any) { return res.status(400).json({ error: e?.message || "Invalid webhook URL" }); }
    const secret = crypto.randomBytes(32).toString("hex");
    // Lazy create a synthetic "Public API" connection to satisfy FK constraint
    let [conn] = await db.select().from(integrationConnections)
      .where(and(eq(integrationConnections.organizationId, req.orgId!), eq(integrationConnections.provider, "zapier"), eq(integrationConnections.displayName, "Public API")))
      .limit(1);
    if (!conn) {
      [conn] = await db.insert(integrationConnections).values({
        organizationId: req.orgId!,
        provider: "zapier",
        displayName: "Public API",
        status: "active",
        metadata: { source: "public_api" },
      }).returning();
    }
    const [row] = await db.insert(integrationWebhookSubscriptions).values({
      organizationId: req.orgId!,
      connectionId: conn.id,
      eventType,
      targetUrl,
      secret,
    }).returning();
    res.status(201).json({ ...row, secret });
  } catch (err) { next(err); }
});

router.delete("/webhooks/:id", publicApiAuth("webhooks:manage"), async (req, res, next) => {
  try {
    const [row] = await db.update(integrationWebhookSubscriptions)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(integrationWebhookSubscriptions.id, req.params.id), eq(integrationWebhookSubscriptions.organizationId, req.orgId!)))
      .returning();
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.use(publicApiError);

export default router;
