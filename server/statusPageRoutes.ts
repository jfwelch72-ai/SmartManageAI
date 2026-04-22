import { Router } from "express";
import { z } from "zod";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { requireAuth, requireRole } from "./auth";
import { sendEmail } from "./services/emailService";
import { logError, logInfo } from "./utils/logger";
import { runProbeSweep } from "./statusProbeScheduler";

const router = Router();

// ---------- helpers ----------

type DailyUptime = {
  date: string; // YYYY-MM-DD (UTC)
  total: number;
  ok: number;
};

type ComponentSummary = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: "operational" | "degraded" | "outage" | "unknown";
  uptime24h: number | null;
  uptime30d: number | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  daily: DailyUptime[];
};

async function buildComponentSummaries(): Promise<ComponentSummary[]> {
  const compsRes = await db.execute(sql`
    SELECT id, key, name, description
    FROM "status_components"
    WHERE enabled = true
    ORDER BY sort_order, name
  `);
  const comps = compsRes.rows as Array<{ id: string; key: string; name: string; description: string | null }>;
  if (comps.length === 0) return [];

  // Latest probe per component
  const latestRes = await db.execute(sql`
    SELECT DISTINCT ON (component_id) component_id, ok, error, checked_at
    FROM "status_probes"
    ORDER BY component_id, checked_at DESC
  `);
  const latestByComp = new Map<string, { ok: boolean; error: string | null; checked_at: Date }>();
  for (const r of latestRes.rows as any[]) {
    latestByComp.set(r.component_id, { ok: r.ok, error: r.error, checked_at: new Date(r.checked_at) });
  }

  // Aggregate uptime — last 1h windows for status determination + 24h/30d
  const aggRes = await db.execute(sql`
    SELECT
      component_id,
      SUM(CASE WHEN checked_at >= NOW() - INTERVAL '1 hour' THEN 1 ELSE 0 END) AS total_1h,
      SUM(CASE WHEN checked_at >= NOW() - INTERVAL '1 hour' AND ok THEN 1 ELSE 0 END) AS ok_1h,
      SUM(CASE WHEN checked_at >= NOW() - INTERVAL '24 hours' THEN 1 ELSE 0 END) AS total_24h,
      SUM(CASE WHEN checked_at >= NOW() - INTERVAL '24 hours' AND ok THEN 1 ELSE 0 END) AS ok_24h,
      SUM(CASE WHEN checked_at >= NOW() - INTERVAL '30 days' THEN 1 ELSE 0 END) AS total_30d,
      SUM(CASE WHEN checked_at >= NOW() - INTERVAL '30 days' AND ok THEN 1 ELSE 0 END) AS ok_30d
    FROM "status_probes"
    GROUP BY component_id
  `);
  const aggByComp = new Map<string, any>();
  for (const r of aggRes.rows as any[]) aggByComp.set(r.component_id, r);

  // Daily rollup for the last 90 days (UTC)
  const dailyRes = await db.execute(sql`
    SELECT
      component_id,
      to_char(date_trunc('day', checked_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
      COUNT(*)::int AS total,
      SUM(CASE WHEN ok THEN 1 ELSE 0 END)::int AS ok
    FROM "status_probes"
    WHERE checked_at >= (NOW() AT TIME ZONE 'UTC')::date - INTERVAL '89 days'
    GROUP BY component_id, day
    ORDER BY day ASC
  `);
  const dailyByComp = new Map<string, DailyUptime[]>();
  for (const r of dailyRes.rows as any[]) {
    const arr = dailyByComp.get(r.component_id) || [];
    arr.push({ date: r.day, total: Number(r.total), ok: Number(r.ok) });
    dailyByComp.set(r.component_id, arr);
  }

  return comps.map((c) => {
    const latest = latestByComp.get(c.id);
    const agg = aggByComp.get(c.id);
    let status: ComponentSummary["status"] = "unknown";
    if (latest) {
      const total1h = Number(agg?.total_1h ?? 0);
      const ok1h = Number(agg?.ok_1h ?? 0);
      if (total1h > 0) {
        const ratio = ok1h / total1h;
        if (ratio >= 0.95) status = latest.ok ? "operational" : "degraded";
        else if (ratio >= 0.5) status = "degraded";
        else status = "outage";
      } else {
        status = latest.ok ? "operational" : "outage";
      }
    }
    const uptime24h = agg && Number(agg.total_24h) > 0 ? Number(agg.ok_24h) / Number(agg.total_24h) : null;
    const uptime30d = agg && Number(agg.total_30d) > 0 ? Number(agg.ok_30d) / Number(agg.total_30d) : null;
    return {
      id: c.id,
      key: c.key,
      name: c.name,
      description: c.description,
      status,
      uptime24h,
      uptime30d,
      lastCheckedAt: latest ? latest.checked_at.toISOString() : null,
      lastError: latest?.ok === false ? latest.error : null,
      daily: dailyByComp.get(c.id) ?? [],
    };
  });
}

async function fetchRecentIncidents(days = 90) {
  // Include any incident that overlaps the window: either it started inside the
  // window, or it is still open, or it resolved inside the window. This keeps
  // long-running incidents that began before the window visible on the strip.
  const incRes = await db.execute(sql`
    SELECT id, title, status, impact, affected_components, started_at, resolved_at, postmortem_url, postmortem
    FROM "status_incidents"
    WHERE started_at >= NOW() - (${days} || ' days')::interval
       OR resolved_at IS NULL
       OR resolved_at >= NOW() - (${days} || ' days')::interval
    ORDER BY started_at DESC
    LIMIT 50
  `);
  const incidents = incRes.rows as any[];
  if (incidents.length === 0) return [];
  const ids = incidents.map((i) => i.id);
  const updRes = await db.execute(sql`
    SELECT id, incident_id, status, body, created_at
    FROM "status_incident_updates"
    WHERE incident_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
    ORDER BY created_at ASC
  `);
  const updatesByIncident = new Map<string, any[]>();
  for (const u of updRes.rows as any[]) {
    const arr = updatesByIncident.get(u.incident_id) || [];
    arr.push({ id: u.id, status: u.status, body: u.body, createdAt: u.created_at });
    updatesByIncident.set(u.incident_id, arr);
  }
  return incidents.map((i) => ({
    id: i.id,
    title: i.title,
    status: i.status,
    impact: i.impact,
    affectedComponents: i.affected_components,
    startedAt: i.started_at,
    resolvedAt: i.resolved_at,
    postmortemUrl: i.postmortem_url,
    postmortem: i.postmortem,
    updates: updatesByIncident.get(i.id) || [],
  }));
}

function publicBaseUrl(req: any): string {
  const explicit = process.env.PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const proto = (req.headers["x-forwarded-proto"] as string)?.split(",")[0] || req.protocol || "https";
  const host = (req.headers["x-forwarded-host"] as string) || req.get("host") || "";
  return `${proto}://${host}`;
}

// ---------- public read endpoints ----------

router.get("/api/public/status/summary", async (_req, res, next) => {
  try {
    const [components, incidents] = await Promise.all([
      buildComponentSummaries(),
      fetchRecentIncidents(90),
    ]);
    const overall: "operational" | "degraded" | "outage" | "unknown" =
      components.some((c) => c.status === "outage")
        ? "outage"
        : components.some((c) => c.status === "degraded")
        ? "degraded"
        : components.length === 0 || components.every((c) => c.status === "unknown")
        ? "unknown"
        : "operational";

    const activeIncident = incidents.find((i: any) => i.status !== "RESOLVED");
    res.set("Cache-Control", "public, max-age=15");
    res.json({
      overall,
      components,
      incidents,
      activeIncident: activeIncident ?? null,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// ---------- public subscribe endpoints ----------

const subscribeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
});

const subscribeSchema = z.object({
  email: z.string().email().max(200),
  // Honeypot
  website: z.string().optional(),
});

router.post("/api/public/status/subscribe", subscribeLimiter, async (req, res, next) => {
  try {
    const parsed = subscribeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid email" });
    if (parsed.data.website && parsed.data.website.length > 0) return res.status(200).json({ ok: true });

    const email = parsed.data.email.toLowerCase().trim();
    const confirmToken = crypto.randomBytes(24).toString("hex");
    const unsubscribeToken = crypto.randomBytes(24).toString("hex");

    const existing = await db.execute(sql`SELECT id, confirmed FROM "status_subscribers" WHERE email = ${email} LIMIT 1`);
    let subId: string;
    let alreadyConfirmed = false;
    if (existing.rows.length > 0) {
      const row = existing.rows[0] as { id: string; confirmed: boolean };
      subId = row.id;
      alreadyConfirmed = row.confirmed;
      if (!alreadyConfirmed) {
        await db.execute(sql`UPDATE "status_subscribers" SET confirm_token = ${confirmToken} WHERE id = ${subId}`);
      }
    } else {
      const ins = await db.execute(sql`
        INSERT INTO "status_subscribers" (email, confirm_token, unsubscribe_token)
        VALUES (${email}, ${confirmToken}, ${unsubscribeToken})
        RETURNING id
      `);
      subId = (ins.rows[0] as { id: string }).id;
    }

    if (!alreadyConfirmed) {
      const confirmUrl = `${publicBaseUrl(req)}/api/public/status/confirm?token=${confirmToken}`;
      const unsubscribeUrl = `${publicBaseUrl(req)}/api/public/status/unsubscribe?token=${unsubscribeToken}`;
      sendEmail({
        to: email,
        subject: "Confirm your SmartManageAI status subscription",
        text: `Confirm your subscription to SmartManageAI status updates: ${confirmUrl}\n\nIf you didn't request this, you can ignore this email.\n\nUnsubscribe: ${unsubscribeUrl}`,
        html: `<p>Confirm your subscription to SmartManageAI status updates by clicking the link below:</p>
<p><a href="${confirmUrl}">Confirm subscription</a></p>
<p>If you didn't request this, you can ignore this email.</p>
<p style="color:#666;font-size:12px"><a href="${unsubscribeUrl}">Unsubscribe</a></p>`,
      }).catch((err) => logError("Failed to send status subscribe email", { email }, err instanceof Error ? err : new Error(String(err))));
    }

    res.status(200).json({ ok: true, alreadyConfirmed });
  } catch (err) {
    next(err);
  }
});

router.get("/api/public/status/confirm", async (req, res, next) => {
  try {
    const token = String(req.query.token || "");
    if (!token) return res.status(400).send("Invalid token");
    const result = await db.execute(sql`
      UPDATE "status_subscribers"
      SET confirmed = true, confirmed_at = NOW()
      WHERE confirm_token = ${token}
      RETURNING id, email
    `);
    if (result.rows.length === 0) return res.status(404).send("Subscription not found or already confirmed.");
    res.set("Content-Type", "text/html").send(`<!doctype html><html><body style="font-family:system-ui;max-width:640px;margin:80px auto;padding:24px">
<h1>Subscription confirmed</h1>
<p>Thanks. You'll receive an email whenever SmartManageAI opens, updates, or resolves a status incident.</p>
<p><a href="/status">Back to status page</a></p>
</body></html>`);
  } catch (err) {
    next(err);
  }
});

router.get("/api/public/status/unsubscribe", async (req, res, next) => {
  try {
    const token = String(req.query.token || "");
    if (!token) return res.status(400).send("Invalid token");
    const result = await db.execute(sql`DELETE FROM "status_subscribers" WHERE unsubscribe_token = ${token} RETURNING id`);
    if (result.rows.length === 0) return res.status(404).send("Subscription not found.");
    res.set("Content-Type", "text/html").send(`<!doctype html><html><body style="font-family:system-ui;max-width:640px;margin:80px auto;padding:24px">
<h1>Unsubscribed</h1>
<p>You will no longer receive SmartManageAI status notifications.</p>
<p><a href="/status">Back to status page</a></p>
</body></html>`);
  } catch (err) {
    next(err);
  }
});

// ---------- admin endpoints (SUPER_ADMIN) ----------

const adminGuard = [requireAuth, requireRole("SUPER_ADMIN")];

router.get("/api/admin/status/components", ...adminGuard, async (_req, res, next) => {
  try {
    const r = await db.execute(sql`SELECT * FROM "status_components" ORDER BY sort_order, name`);
    res.json(r.rows);
  } catch (err) {
    next(err);
  }
});

const componentSchema = z.object({
  key: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().nullable(),
  probeKind: z.enum(["http_get", "http_self", "http_public", "http_self_health", "db_ping", "object_storage", "config_present"]).default("http_get"),
  probeUrl: z.string().url().max(500).optional().nullable(),
  probeExpectStatus: z.number().int().min(100).max(599).default(200),
  probeTimeoutMs: z.number().int().min(500).max(60000).default(8000),
  enabled: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

router.post("/api/admin/status/components", ...adminGuard, async (req, res, next) => {
  try {
    const data = componentSchema.parse(req.body);
    const r = await db.execute(sql`
      INSERT INTO "status_components" (key, name, description, probe_kind, probe_url, probe_expect_status, probe_timeout_ms, enabled, sort_order)
      VALUES (${data.key}, ${data.name}, ${data.description ?? null}, ${data.probeKind}, ${data.probeUrl ?? null}, ${data.probeExpectStatus}, ${data.probeTimeoutMs}, ${data.enabled}, ${data.sortOrder})
      RETURNING *
    `);
    res.status(201).json(r.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.patch("/api/admin/status/components/:id", ...adminGuard, async (req, res, next) => {
  try {
    const data = componentSchema.partial().parse(req.body);
    const sets: any[] = [];
    if (data.name !== undefined) sets.push(sql`name = ${data.name}`);
    if (data.description !== undefined) sets.push(sql`description = ${data.description}`);
    if (data.probeKind !== undefined) sets.push(sql`probe_kind = ${data.probeKind}`);
    if (data.probeUrl !== undefined) sets.push(sql`probe_url = ${data.probeUrl}`);
    if (data.probeExpectStatus !== undefined) sets.push(sql`probe_expect_status = ${data.probeExpectStatus}`);
    if (data.probeTimeoutMs !== undefined) sets.push(sql`probe_timeout_ms = ${data.probeTimeoutMs}`);
    if (data.enabled !== undefined) sets.push(sql`enabled = ${data.enabled}`);
    if (data.sortOrder !== undefined) sets.push(sql`sort_order = ${data.sortOrder}`);
    if (sets.length === 0) return res.json({ ok: true });
    await db.execute(sql`UPDATE "status_components" SET ${sql.join(sets, sql`, `)} WHERE id = ${req.params.id}`);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete("/api/admin/status/components/:id", ...adminGuard, async (req, res, next) => {
  try {
    await db.execute(sql`DELETE FROM "status_components" WHERE id = ${req.params.id}`);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post("/api/admin/status/probe-now", ...adminGuard, async (_req, res, next) => {
  try {
    const result = await runProbeSweep();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

const incidentImpactEnum = z.enum(["NONE", "MINOR", "MAJOR", "CRITICAL"]);
const incidentStatusEnum = z.enum(["INVESTIGATING", "IDENTIFIED", "MONITORING", "RESOLVED"]);

const incidentSchema = z.object({
  title: z.string().min(3).max(200),
  status: incidentStatusEnum.default("INVESTIGATING"),
  impact: incidentImpactEnum.default("MINOR"),
  affectedComponents: z.array(z.string()).default([]),
  initialUpdate: z.string().max(4000).optional(),
  postmortemUrl: z.string().url().max(500).optional().nullable(),
  postmortem: z.string().max(20000).optional().nullable(),
});

router.get("/api/admin/status/incidents", ...adminGuard, async (_req, res, next) => {
  try {
    const incidents = await fetchRecentIncidents(365);
    res.json(incidents);
  } catch (err) {
    next(err);
  }
});

router.post("/api/admin/status/incidents", ...adminGuard, async (req: any, res, next) => {
  try {
    const data = incidentSchema.parse(req.body);
    const ins = await db.execute(sql`
      INSERT INTO "status_incidents" (title, status, impact, affected_components, postmortem_url, postmortem, created_by_user_id)
      VALUES (${data.title}, ${data.status}, ${data.impact}, ${JSON.stringify(data.affectedComponents)}::jsonb, ${data.postmortemUrl ?? null}, ${data.postmortem ?? null}, ${req.user?.id ?? null})
      RETURNING id
    `);
    const incidentId = (ins.rows[0] as { id: string }).id;
    let updateId: string | null = null;
    if (data.initialUpdate) {
      const upd = await db.execute(sql`
        INSERT INTO "status_incident_updates" (incident_id, status, body, created_by_user_id)
        VALUES (${incidentId}, ${data.status}, ${data.initialUpdate}, ${req.user?.id ?? null})
        RETURNING id
      `);
      updateId = (upd.rows[0] as { id: string }).id;
    }
    notifySubscribersOfIncident(incidentId, updateId, /*isNew*/ true).catch((err) => logError("Notify subscribers failed", { incidentId }, err instanceof Error ? err : new Error(String(err))));
    res.status(201).json({ id: incidentId });
  } catch (err) {
    next(err);
  }
});

const incidentUpdateSchema = z.object({
  status: incidentStatusEnum,
  body: z.string().min(1).max(4000),
});

router.post("/api/admin/status/incidents/:id/updates", ...adminGuard, async (req: any, res, next) => {
  try {
    const data = incidentUpdateSchema.parse(req.body);
    const upd = await db.execute(sql`
      INSERT INTO "status_incident_updates" (incident_id, status, body, created_by_user_id)
      VALUES (${req.params.id}, ${data.status}, ${data.body}, ${req.user?.id ?? null})
      RETURNING id
    `);
    const updateId = (upd.rows[0] as { id: string }).id;
    await db.execute(sql`
      UPDATE "status_incidents"
      SET status = ${data.status},
          updated_at = NOW(),
          resolved_at = CASE WHEN ${data.status} = 'RESOLVED' AND resolved_at IS NULL THEN NOW() ELSE resolved_at END
      WHERE id = ${req.params.id}
    `);
    notifySubscribersOfIncident(req.params.id, updateId, false).catch((err) => logError("Notify subscribers failed", { incidentId: req.params.id }, err instanceof Error ? err : new Error(String(err))));
    res.status(201).json({ id: updateId });
  } catch (err) {
    next(err);
  }
});

router.patch("/api/admin/status/incidents/:id", ...adminGuard, async (req, res, next) => {
  try {
    const data = z
      .object({
        title: z.string().min(3).max(200).optional(),
        impact: incidentImpactEnum.optional(),
        affectedComponents: z.array(z.string()).optional(),
        postmortemUrl: z.string().url().max(500).nullable().optional(),
        postmortem: z.string().max(20000).nullable().optional(),
      })
      .parse(req.body);
    const sets: any[] = [sql`updated_at = NOW()`];
    if (data.title !== undefined) sets.push(sql`title = ${data.title}`);
    if (data.impact !== undefined) sets.push(sql`impact = ${data.impact}`);
    if (data.affectedComponents !== undefined) sets.push(sql`affected_components = ${JSON.stringify(data.affectedComponents)}::jsonb`);
    if (data.postmortemUrl !== undefined) sets.push(sql`postmortem_url = ${data.postmortemUrl}`);
    if (data.postmortem !== undefined) sets.push(sql`postmortem = ${data.postmortem}`);
    await db.execute(sql`UPDATE "status_incidents" SET ${sql.join(sets, sql`, `)} WHERE id = ${req.params.id}`);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete("/api/admin/status/incidents/:id", ...adminGuard, async (req, res, next) => {
  try {
    await db.execute(sql`DELETE FROM "status_incidents" WHERE id = ${req.params.id}`);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get("/api/admin/status/subscribers", ...adminGuard, async (_req, res, next) => {
  try {
    const r = await db.execute(sql`SELECT id, email, confirmed, created_at, confirmed_at FROM "status_subscribers" ORDER BY created_at DESC`);
    res.json(r.rows);
  } catch (err) {
    next(err);
  }
});

// ---------- notification fanout ----------

async function notifySubscribersOfIncident(incidentId: string, updateId: string | null, isNew: boolean): Promise<void> {
  const incRes = await db.execute(sql`SELECT id, title, status, impact FROM "status_incidents" WHERE id = ${incidentId} LIMIT 1`);
  const incident = incRes.rows[0] as { id: string; title: string; status: string; impact: string } | undefined;
  if (!incident) return;

  let updateBody: string | null = null;
  if (updateId) {
    const u = await db.execute(sql`SELECT body FROM "status_incident_updates" WHERE id = ${updateId} LIMIT 1`);
    updateBody = (u.rows[0] as { body: string } | undefined)?.body ?? null;
  }

  const subsRes = await db.execute(sql`
    SELECT s.id, s.email, s.unsubscribe_token
    FROM "status_subscribers" s
    WHERE s.confirmed = true
      AND NOT EXISTS (
        SELECT 1 FROM "status_incident_notifications" n
        WHERE n.subscriber_id = s.id AND n.incident_id = ${incidentId}
          AND ((n.update_id IS NULL AND ${updateId}::text IS NULL) OR n.update_id = ${updateId})
      )
  `);
  const subs = subsRes.rows as Array<{ id: string; email: string; unsubscribe_token: string }>;
  if (subs.length === 0) return;

  const subjectPrefix = isNew ? "[New Incident]" : `[${incident.status}]`;
  const subject = `${subjectPrefix} ${incident.title} — SmartManageAI Status`;
  const baseUrl =
    process.env.PUBLIC_APP_URL?.replace(/\/$/, "") ||
    (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "") ||
    "https://smartmanageai.ai";

  for (const sub of subs) {
    const unsubscribeUrl = `${baseUrl}/api/public/status/unsubscribe?token=${sub.unsubscribe_token}`;
    const text = `${incident.title}\nStatus: ${incident.status} • Impact: ${incident.impact}\n\n${updateBody ?? ""}\n\nView: ${baseUrl || ""}/status\n\nUnsubscribe: ${unsubscribeUrl}`;
    const html = `<h2>${incident.title}</h2>
<p><strong>Status:</strong> ${incident.status} &nbsp; <strong>Impact:</strong> ${incident.impact}</p>
${updateBody ? `<p>${updateBody.replace(/\n/g, "<br>")}</p>` : ""}
<p><a href="${baseUrl || ""}/status">View status page</a></p>
<p style="color:#666;font-size:12px"><a href="${unsubscribeUrl}">Unsubscribe</a></p>`;
    try {
      await sendEmail({ to: sub.email, subject, text, html });
      await db.execute(sql`
        INSERT INTO "status_incident_notifications" (incident_id, update_id, subscriber_id)
        VALUES (${incidentId}, ${updateId}, ${sub.id})
        ON CONFLICT DO NOTHING
      `);
    } catch (err) {
      logError("Status incident email failed", { email: sub.email, incidentId }, err instanceof Error ? err : new Error(String(err)));
    }
  }
  logInfo("Status incident notifications dispatched", { incidentId, recipients: subs.length });
}

export default router;
