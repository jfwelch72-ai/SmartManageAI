import { Router } from "express";
import { db } from "./db";
import {
  crmCustomFieldDefinitions,
  crmCustomFieldValues,
  type CrmCustomFieldDefinition,
} from "@shared/schema";
import { and, eq, asc, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";

const router = Router();

const READ_ROLES = ["ADMIN", "HUSTLER", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"] as const;
const ADMIN_ROLES = ["ADMIN", "HUSTLER", "MANAGER"] as const;
// Roles permitted to mutate CRM entity values (mirrors the contact/org/opportunity edit endpoints).
const WRITE_ROLES = ["ADMIN", "HUSTLER", "MANAGER", "ESTIMATOR"] as const;

const ENTITY_TYPES = ["CONTACT", "ORGANISATION", "OPPORTUNITY"] as const;
type EntityType = typeof ENTITY_TYPES[number];

const FIELD_TYPES = [
  "TEXT", "LONG_TEXT", "NUMBER", "CURRENCY", "DATE",
  "DROPDOWN", "MULTI_SELECT", "CHECKBOX", "URL", "EMAIL", "PHONE",
] as const;

const KEY_REGEX = /^[a-z][a-z0-9_]{0,49}$/;

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

function toJsonValue(v: unknown): JsonValue {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.map(toJsonValue);
  if (typeof v === "object") {
    const out: { [k: string]: JsonValue } = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = toJsonValue(val);
    return out;
  }
  return null;
}

const definitionBodySchema = z.object({
  entityType: z.enum(ENTITY_TYPES),
  key: z.string().regex(KEY_REGEX, "Key must be lowercase, start with a letter, max 50 chars (a-z, 0-9, _)"),
  label: z.string().min(1).max(100),
  fieldType: z.enum(FIELD_TYPES),
  options: z.array(z.string().min(1)).optional().nullable(),
  isRequired: z.boolean().optional().default(false),
  defaultValue: z.any().optional().nullable(),
  helpText: z.string().max(500).optional().nullable(),
  sortOrder: z.number().int().optional().default(0),
  isActive: z.boolean().optional().default(true),
});

const definitionPatchSchema = definitionBodySchema.partial().omit({ entityType: true, key: true });

// ===== Helpers exported for use in other CRM routes =====

export function validateValueAgainstDefinition(def: CrmCustomFieldDefinition, raw: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  const isEmpty = raw === undefined || raw === null || raw === "";
  if (isEmpty) {
    if (def.isActive && def.isRequired) return { ok: false, error: `${def.label} is required` };
    return { ok: true, value: null };
  }
  switch (def.fieldType) {
    case "TEXT":
    case "LONG_TEXT": {
      if (typeof raw !== "string") return { ok: false, error: `${def.label} must be text` };
      const max = def.fieldType === "LONG_TEXT" ? 5000 : 500;
      if (raw.length > max) return { ok: false, error: `${def.label} exceeds ${max} chars` };
      return { ok: true, value: raw };
    }
    case "NUMBER":
    case "CURRENCY": {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(n)) return { ok: false, error: `${def.label} must be a number` };
      return { ok: true, value: n };
    }
    case "DATE": {
      if (typeof raw !== "string") return { ok: false, error: `${def.label} must be a date string (YYYY-MM-DD)` };
      const d = new Date(raw);
      if (isNaN(d.getTime())) return { ok: false, error: `${def.label} is not a valid date` };
      return { ok: true, value: raw };
    }
    case "CHECKBOX": {
      return { ok: true, value: Boolean(raw) };
    }
    case "DROPDOWN": {
      if (typeof raw !== "string") return { ok: false, error: `${def.label} must be a string` };
      const opts = (def.options as string[] | null) ?? [];
      if (opts.length && !opts.includes(raw)) return { ok: false, error: `${def.label}: invalid option` };
      return { ok: true, value: raw };
    }
    case "MULTI_SELECT": {
      if (!Array.isArray(raw)) return { ok: false, error: `${def.label} must be an array` };
      const opts = (def.options as string[] | null) ?? [];
      for (const v of raw) {
        if (typeof v !== "string") return { ok: false, error: `${def.label}: values must be strings` };
        if (opts.length && !opts.includes(v)) return { ok: false, error: `${def.label}: invalid option ${v}` };
      }
      return { ok: true, value: raw };
    }
    case "URL": {
      if (typeof raw !== "string") return { ok: false, error: `${def.label} must be text` };
      try { new URL(raw); } catch { return { ok: false, error: `${def.label} must be a valid URL` }; }
      return { ok: true, value: raw };
    }
    case "EMAIL": {
      if (typeof raw !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
        return { ok: false, error: `${def.label} must be a valid email` };
      }
      return { ok: true, value: raw };
    }
    case "PHONE": {
      if (typeof raw !== "string" || raw.replace(/\D/g, "").length < 7) {
        return { ok: false, error: `${def.label} must be a valid phone number` };
      }
      return { ok: true, value: raw };
    }
    default:
      return { ok: true, value: raw };
  }
}

/**
 * Delete all custom field values for a given entity (CONTACT/ORGANISATION/OPPORTUNITY).
 * Call from entity DELETE routes to keep custom_field_values clean.
 */
export async function deleteCustomFieldValuesForEntity(
  orgId: string,
  entityType: EntityType,
  entityId: string,
  executor: typeof db = db,
): Promise<void> {
  await executor.delete(crmCustomFieldValues).where(and(
    eq(crmCustomFieldValues.organizationId, orgId),
    eq(crmCustomFieldValues.entityType, entityType),
    eq(crmCustomFieldValues.entityId, entityId),
  ));
}

export async function getDefinitionsForEntity(orgId: string, entityType: EntityType, executor: typeof db = db): Promise<CrmCustomFieldDefinition[]> {
  return executor.select().from(crmCustomFieldDefinitions)
    .where(and(eq(crmCustomFieldDefinitions.organizationId, orgId), eq(crmCustomFieldDefinitions.entityType, entityType)))
    .orderBy(asc(crmCustomFieldDefinitions.sortOrder), asc(crmCustomFieldDefinitions.label));
}

export async function getCustomFieldsMap(orgId: string, entityType: EntityType, entityId: string): Promise<Record<string, unknown>> {
  const rows = await db
    .select({ key: crmCustomFieldDefinitions.key, value: crmCustomFieldValues.value })
    .from(crmCustomFieldValues)
    .innerJoin(crmCustomFieldDefinitions, eq(crmCustomFieldValues.definitionId, crmCustomFieldDefinitions.id))
    .where(and(
      eq(crmCustomFieldValues.organizationId, orgId),
      eq(crmCustomFieldValues.entityType, entityType),
      eq(crmCustomFieldValues.entityId, entityId),
    ));
  const out: Record<string, unknown> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

/**
 * Parse `cf:<key>` filter params from a request query and return either:
 *  - { applies: false } if no filters were provided,
 *  - { applies: true, ids: string[] } with the entity ids that match ALL filters.
 *
 * Supported value semantics:
 *  - text/long_text/url/email/phone: case-insensitive substring match
 *  - dropdown/checkbox/date: exact match
 *  - number/currency: exact numeric match
 *  - multi_select: comma-separated values; entity must contain all of them
 *
 * Unknown / archived fields are ignored so removed filters don't break lists.
 */
export async function getEntityIdsMatchingCustomFieldFilters(
  orgId: string,
  entityType: EntityType,
  query: Record<string, any>,
): Promise<{ applies: false } | { applies: true; ids: string[] }> {
  const filters: Array<{ key: string; raw: string }> = [];
  for (const [k, v] of Object.entries(query)) {
    if (k.startsWith("cf:") && typeof v === "string" && v.length > 0) {
      filters.push({ key: k.slice(3), raw: v });
    }
  }
  if (filters.length === 0) return { applies: false };

  const defs = await getDefinitionsForEntity(orgId, entityType);
  const byKey = new Map(defs.filter(d => d.isActive).map(d => [d.key, d]));

  let matchingIds: Set<string> | null = null;
  for (const f of filters) {
    const def = byKey.get(f.key);
    if (!def) continue;
    let condition;
    switch (def.fieldType) {
      case "TEXT":
      case "LONG_TEXT":
      case "URL":
      case "EMAIL":
      case "PHONE":
        condition = sql`(${crmCustomFieldValues.value} #>> '{}') ILIKE ${"%" + f.raw + "%"}`;
        break;
      case "DROPDOWN":
        condition = sql`(${crmCustomFieldValues.value} #>> '{}') = ${f.raw}`;
        break;
      case "CHECKBOX": {
        const wantTrue = ["true", "1", "yes"].includes(f.raw.toLowerCase());
        condition = sql`(${crmCustomFieldValues.value})::text = ${wantTrue ? "true" : "false"}`;
        break;
      }
      case "DATE":
        condition = sql`(${crmCustomFieldValues.value} #>> '{}') = ${f.raw}`;
        break;
      case "NUMBER":
      case "CURRENCY": {
        const n = Number(f.raw);
        if (!Number.isFinite(n)) continue;
        condition = sql`(${crmCustomFieldValues.value})::text = ${String(n)}`;
        break;
      }
      case "MULTI_SELECT": {
        const wanted = f.raw.split(",").map(s => s.trim()).filter(Boolean);
        if (wanted.length === 0) continue;
        condition = sql`${crmCustomFieldValues.value} @> ${JSON.stringify(wanted)}::jsonb`;
        break;
      }
      default:
        continue;
    }
    const rows = await db.select({ id: crmCustomFieldValues.entityId })
      .from(crmCustomFieldValues)
      .where(and(
        eq(crmCustomFieldValues.organizationId, orgId),
        eq(crmCustomFieldValues.entityType, entityType),
        eq(crmCustomFieldValues.definitionId, def.id),
        condition,
      ));
    const ids = new Set(rows.map(r => r.id));
    matchingIds = matchingIds === null ? ids : new Set(Array.from(matchingIds).filter(id => ids.has(id)));
    if (matchingIds.size === 0) return { applies: true, ids: [] };
  }
  if (matchingIds === null) return { applies: false };
  return { applies: true, ids: Array.from(matchingIds) };
}

export async function getCustomFieldsMapBatch(orgId: string, entityType: EntityType, entityIds: string[]): Promise<Record<string, Record<string, unknown>>> {
  if (entityIds.length === 0) return {};
  const rows = await db
    .select({ key: crmCustomFieldDefinitions.key, value: crmCustomFieldValues.value, entityId: crmCustomFieldValues.entityId })
    .from(crmCustomFieldValues)
    .innerJoin(crmCustomFieldDefinitions, eq(crmCustomFieldValues.definitionId, crmCustomFieldDefinitions.id))
    .where(and(
      eq(crmCustomFieldValues.organizationId, orgId),
      eq(crmCustomFieldValues.entityType, entityType),
      inArray(crmCustomFieldValues.entityId, entityIds),
    ));
  const out: Record<string, Record<string, unknown>> = {};
  for (const r of rows) {
    if (!out[r.entityId]) out[r.entityId] = {};
    out[r.entityId][r.key] = r.value;
  }
  return out;
}

/**
 * Validate and persist a custom-fields map for an entity. Returns
 * { ok: true } on success, or { ok: false, error } on validation failure.
 * Pass `customFields` as a key->value map. Unknown keys are ignored.
 * Keys explicitly set to null/undefined will clear the value.
 */
export async function upsertCustomFieldValues(opts: {
  orgId: string;
  entityType: EntityType;
  entityId: string;
  customFields: Record<string, unknown> | undefined | null;
  enforceRequired?: boolean;
  executor?: typeof db;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { orgId, entityType, entityId, customFields, enforceRequired = true } = opts;
  const ex = opts.executor ?? db;
  const defs = await getDefinitionsForEntity(orgId, entityType, ex);
  if (defs.length === 0) return { ok: true };
  const byKey = new Map(defs.map(d => [d.key, d]));
  const incomingRaw = (customFields ?? {}) as Record<string, unknown>;

  // Apply server-side defaults for fields omitted from the payload (active fields with a defaultValue).
  const incoming: Record<string, unknown> = { ...incomingRaw };
  for (const def of defs) {
    if (!def.isActive) continue;
    if (def.defaultValue === null || def.defaultValue === undefined) continue;
    if (Object.prototype.hasOwnProperty.call(incomingRaw, def.key)) continue;
    // Only fill when the entity does not already have a stored value.
    const exists = await ex.select({ id: crmCustomFieldValues.definitionId }).from(crmCustomFieldValues)
      .where(and(eq(crmCustomFieldValues.definitionId, def.id), eq(crmCustomFieldValues.entityId, entityId)))
      .limit(1);
    if (!exists.length) incoming[def.key] = def.defaultValue;
  }

  // Required check on active fields, only if enforced
  if (enforceRequired) {
    for (const def of defs) {
      if (!def.isActive || !def.isRequired) continue;
      const v = incoming[def.key];
      if (v === undefined || v === null || v === "") {
        // Allow if a value already exists in DB
        const existing = await ex.select().from(crmCustomFieldValues)
          .where(and(eq(crmCustomFieldValues.definitionId, def.id), eq(crmCustomFieldValues.entityId, entityId)))
          .limit(1);
        if (!existing.length) return { ok: false, error: `${def.label} is required` };
      }
    }
  }

  const ops: Array<Promise<unknown>> = [];
  for (const [key, raw] of Object.entries(incoming)) {
    const def = byKey.get(key);
    if (!def) continue;
    if (raw === undefined) continue;
    if (raw === null || raw === "") {
      ops.push(ex.delete(crmCustomFieldValues).where(and(
        eq(crmCustomFieldValues.definitionId, def.id),
        eq(crmCustomFieldValues.entityId, entityId),
      )));
      continue;
    }
    const validated = validateValueAgainstDefinition(def, raw);
    if (!validated.ok) return { ok: false, error: validated.error };
    const jsonValue: JsonValue = toJsonValue(validated.value);
    ops.push(ex.insert(crmCustomFieldValues)
      .values({
        organizationId: orgId,
        definitionId: def.id,
        entityType,
        entityId,
        value: jsonValue,
      })
      .onConflictDoUpdate({
        target: [crmCustomFieldValues.definitionId, crmCustomFieldValues.entityId],
        set: { value: jsonValue, updatedAt: new Date() },
      }));
  }
  await Promise.all(ops);
  return { ok: true };
}

// ===== Routes =====

router.get("/api/crm/custom-field-definitions", requireAuth, requireRole(...READ_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

    const conditions = [eq(crmCustomFieldDefinitions.organizationId, orgId)];
    const entityType = req.query.entityType as string | undefined;
    if (entityType && (ENTITY_TYPES as readonly string[]).includes(entityType)) {
      conditions.push(eq(crmCustomFieldDefinitions.entityType, entityType as EntityType));
    }

    const rows = await db.select().from(crmCustomFieldDefinitions)
      .where(and(...conditions))
      .orderBy(asc(crmCustomFieldDefinitions.entityType), asc(crmCustomFieldDefinitions.sortOrder), asc(crmCustomFieldDefinitions.label));
    res.json(rows);
  } catch (e) { next(e); }
});

router.post("/api/crm/custom-field-definitions", requireAuth, requireRole(...ADMIN_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const parsed = definitionBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });

    const data = parsed.data;
    if ((data.fieldType === "DROPDOWN" || data.fieldType === "MULTI_SELECT")) {
      if (!data.options || data.options.length === 0) {
        return res.status(400).json({ error: "Options are required for dropdown/multi-select" });
      }
    }

    try {
      const [created] = await db.insert(crmCustomFieldDefinitions).values({
        organizationId: orgId,
        entityType: data.entityType,
        key: data.key,
        label: data.label,
        fieldType: data.fieldType,
        options: data.options ?? null,
        isRequired: data.isRequired ?? false,
        defaultValue: data.defaultValue ?? null,
        helpText: data.helpText ?? null,
        sortOrder: data.sortOrder ?? 0,
        isActive: data.isActive ?? true,
        createdById: req.user!.id,
      }).returning();
      res.status(201).json(created);
    } catch (err: any) {
      if (err?.code === "23505") {
        return res.status(409).json({ error: "A field with this key already exists for this entity" });
      }
      throw err;
    }
  } catch (e) { next(e); }
});

router.patch("/api/crm/custom-field-definitions/:id", requireAuth, requireRole(...ADMIN_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const parsed = definitionPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });

    const data = parsed.data;

    // Block fieldType change if any stored values exist for this definition
    if (data.fieldType !== undefined) {
      const [existing] = await db.select().from(crmCustomFieldDefinitions)
        .where(and(eq(crmCustomFieldDefinitions.id, req.params.id), eq(crmCustomFieldDefinitions.organizationId, orgId)))
        .limit(1);
      if (!existing) return res.status(404).json({ error: "Not found" });
      if (existing.fieldType !== data.fieldType) {
        const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
          .from(crmCustomFieldValues)
          .where(eq(crmCustomFieldValues.definitionId, req.params.id));
        if (Number(count) > 0) {
          return res.status(409).json({ error: "Cannot change field type while values exist for this field. Archive and create a new field instead." });
        }
      }
    }

    const setData: Record<string, unknown> = { updatedAt: new Date() };
    if (data.label !== undefined) setData.label = data.label;
    if (data.fieldType !== undefined) setData.fieldType = data.fieldType;
    if (data.options !== undefined) setData.options = data.options;
    if (data.isRequired !== undefined) setData.isRequired = data.isRequired;
    if (data.defaultValue !== undefined) setData.defaultValue = data.defaultValue;
    if (data.helpText !== undefined) setData.helpText = data.helpText;
    if (data.sortOrder !== undefined) setData.sortOrder = data.sortOrder;
    if (data.isActive !== undefined) setData.isActive = data.isActive;

    const [updated] = await db.update(crmCustomFieldDefinitions).set(setData)
      .where(and(eq(crmCustomFieldDefinitions.id, req.params.id), eq(crmCustomFieldDefinitions.organizationId, orgId)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  } catch (e) { next(e); }
});

// "Delete" = archive (preserves stored values). Use ?hard=1 to permanently delete (will cascade values).
router.delete("/api/crm/custom-field-definitions/:id", requireAuth, requireRole(...ADMIN_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const hard = req.query.hard === "1";
    if (hard) {
      const r = await db.delete(crmCustomFieldDefinitions)
        .where(and(eq(crmCustomFieldDefinitions.id, req.params.id), eq(crmCustomFieldDefinitions.organizationId, orgId)))
        .returning();
      if (!r.length) return res.status(404).json({ error: "Not found" });
      return res.json({ ok: true, hard: true });
    }
    const [updated] = await db.update(crmCustomFieldDefinitions).set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(crmCustomFieldDefinitions.id, req.params.id), eq(crmCustomFieldDefinitions.organizationId, orgId)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true, archived: true });
  } catch (e) { next(e); }
});

// Reorder a batch of definitions: body { items: [{ id, sortOrder }] }
router.post("/api/crm/custom-field-definitions/reorder", requireAuth, requireRole(...ADMIN_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const schema = z.object({ items: z.array(z.object({ id: z.string(), sortOrder: z.number().int() })) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input" });
    await Promise.all(parsed.data.items.map(it =>
      db.update(crmCustomFieldDefinitions).set({ sortOrder: it.sortOrder, updatedAt: new Date() })
        .where(and(eq(crmCustomFieldDefinitions.id, it.id), eq(crmCustomFieldDefinitions.organizationId, orgId)))
    ));
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Generic value endpoint (also used for entity custom-field updates from detail pages):
// PUT /api/crm/custom-field-values/:entityType/:entityId  body { customFields: { key: value } }
router.put("/api/crm/custom-field-values/:entityType/:entityId", requireAuth, requireRole(...WRITE_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const entityType = req.params.entityType as EntityType;
    if (!(ENTITY_TYPES as readonly string[]).includes(entityType)) {
      return res.status(400).json({ error: "Invalid entityType" });
    }
    const result = await upsertCustomFieldValues({
      orgId,
      entityType,
      entityId: req.params.entityId,
      customFields: (req.body?.customFields ?? {}) as Record<string, unknown>,
      enforceRequired: false,
    });
    if (!result.ok) return res.status(400).json({ error: result.error });
    const map = await getCustomFieldsMap(orgId, entityType, req.params.entityId);
    res.json({ customFields: map });
  } catch (e) { next(e); }
});

// GET values for an entity
router.get("/api/crm/custom-field-values/:entityType/:entityId", requireAuth, requireRole(...READ_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const entityType = req.params.entityType as EntityType;
    if (!(ENTITY_TYPES as readonly string[]).includes(entityType)) {
      return res.status(400).json({ error: "Invalid entityType" });
    }
    const map = await getCustomFieldsMap(orgId, entityType, req.params.entityId);
    res.json({ customFields: map });
  } catch (e) { next(e); }
});

export default router;
