// prompt-injection-guard: skill suggestions use only org-owned lesson summaries from the knowledge index — no untrusted third-party document content reaches the prompt
/**
 * Task #2703 — AI Estimator Skills System.
 *
 * CRUD, retrieval, prompt formatting, skill suggestions, and seed logic
 * for the ai_estimator_skills table.
 */

import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { aiEstimatorSkills, aiEstimatorKnowledgeIndex, type AiEstimatorSkill } from "@shared/schema";
import { logError, logInfo } from "../../utils/logger";
import { routedChatCompletion } from "../../ai/providers";
import { governedAiCall } from "../aiGovernance";

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

export interface SkillRetrievalOpts {
  organizationId: string;
  tradeType?: string | null;
  csiDivision?: string | null;
  projectType?: string | null;
}

/**
 * Pull active skills for an org, ordered by priority ascending (1 fires
 * first). Returns:
 *   1. Global system-seeded skills (org_id IS NULL, is_active = true)
 *   2. Global org-level skills for this org
 *   3. Scoped skills that match the current trade / CSI division / project type
 *
 * Each category is sorted priority ASC. Duplicates (same name across seeded
 * + org) are NOT deduplicated here — the caller sees all of them.
 */
export async function retrieveSkillsForEstimate(
  opts: SkillRetrievalOpts,
): Promise<AiEstimatorSkill[]> {
  type ScopeSQL = ReturnType<typeof eq>;
  const scopeConds: ScopeSQL[] = [eq(aiEstimatorSkills.scope, "global")];
  if (opts.tradeType) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    scopeConds.push(and(
      eq(aiEstimatorSkills.scope, "trade"),
      eq(aiEstimatorSkills.scopeValue, opts.tradeType),
    )! as unknown as ScopeSQL);
  }
  if (opts.csiDivision) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    scopeConds.push(and(
      eq(aiEstimatorSkills.scope, "csi_division"),
      eq(aiEstimatorSkills.scopeValue, opts.csiDivision),
    )! as unknown as ScopeSQL);
  }
  if (opts.projectType) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    scopeConds.push(and(
      eq(aiEstimatorSkills.scope, "project_type"),
      eq(aiEstimatorSkills.scopeValue, opts.projectType),
    )! as unknown as ScopeSQL);
  }

  const matchScope = scopeConds.length === 1 ? scopeConds[0] : or(...scopeConds);

  const rows = await db
    .select()
    .from(aiEstimatorSkills)
    .where(
      and(
        eq(aiEstimatorSkills.isActive, true),
        isNull(aiEstimatorSkills.deletedAt),
        or(
          isNull(aiEstimatorSkills.organizationId),
          eq(aiEstimatorSkills.organizationId, opts.organizationId),
        ),
        matchScope,
      ),
    )
    .orderBy(asc(aiEstimatorSkills.priority), asc(aiEstimatorSkills.createdAt));

  return rows;
}

/**
 * Format a list of skills into a prompt block injected between the
 * lessons block and the user message. Skills are presented as
 * "firm-wide methodology" so the model gives them higher weight than
 * the softer auto-lessons.
 */
export function formatSkillsForPrompt(skills: AiEstimatorSkill[]): string {
  if (skills.length === 0) return "";
  const lines = skills.map((s) => {
    const scopeTag =
      s.scope === "global"
        ? "[firm-wide]"
        : s.scope === "trade"
          ? `[trade: ${s.scopeValue ?? "?"}]`
          : s.scope === "csi_division"
            ? `[CSI: ${s.scopeValue ?? "?"}]`
            : `[project-type: ${s.scopeValue ?? "?"}]`;
    return `- ${scopeTag} **${s.name}**: ${s.ruleBody}`;
  });
  return `## Firm Methodology & Skills\nThese are firm-wide estimating rules. Apply them as hard requirements — they take precedence over the softer lessons below.\n${lines.join("\n")}`;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function listSkillsForOrg(organizationId: string): Promise<AiEstimatorSkill[]> {
  return db
    .select()
    .from(aiEstimatorSkills)
    .where(
      and(
        isNull(aiEstimatorSkills.deletedAt),
        or(
          isNull(aiEstimatorSkills.organizationId),
          eq(aiEstimatorSkills.organizationId, organizationId),
        ),
      ),
    )
    .orderBy(asc(aiEstimatorSkills.priority), asc(aiEstimatorSkills.createdAt));
}

export async function getSkillById(
  skillId: string,
  organizationId: string,
): Promise<AiEstimatorSkill | null> {
  const [row] = await db
    .select()
    .from(aiEstimatorSkills)
    .where(
      and(
        eq(aiEstimatorSkills.id, skillId),
        or(
          isNull(aiEstimatorSkills.organizationId),
          eq(aiEstimatorSkills.organizationId, organizationId),
        ),
      ),
    )
    .limit(1);
  return row ?? null;
}

export interface CreateSkillInput {
  name: string;
  description?: string | null;
  ruleBody: string;
  scope: "global" | "trade" | "csi_division" | "project_type";
  scopeValue?: string | null;
  priority?: number;
  isActive?: boolean;
  createdById?: string | null;
}

export async function createSkill(
  organizationId: string,
  input: CreateSkillInput,
): Promise<AiEstimatorSkill> {
  const [row] = await db
    .insert(aiEstimatorSkills)
    .values({
      organizationId,
      name: input.name.trim(),
      description: input.description ?? null,
      ruleBody: input.ruleBody.trim(),
      scope: input.scope,
      scopeValue: input.scopeValue ?? null,
      priority: input.priority ?? 100,
      isActive: input.isActive !== undefined ? input.isActive : true,
      isReadOnly: false,
      sourceType: "user_authored",
      createdById: input.createdById ?? null,
    })
    .returning();
  return row;
}

export interface UpdateSkillInput {
  name?: string;
  description?: string | null;
  ruleBody?: string;
  scope?: "global" | "trade" | "csi_division" | "project_type";
  scopeValue?: string | null;
  priority?: number;
  isActive?: boolean;
}

export async function updateSkill(
  skillId: string,
  organizationId: string,
  input: UpdateSkillInput,
): Promise<AiEstimatorSkill | null> {
  const existing = await getSkillById(skillId, organizationId);
  if (!existing) return null;

  // Read-only (seeded) skills: allow ONLY isActive toggle, block all other edits.
  if (existing.isReadOnly) {
    if (input.isActive === undefined) return null;
    // Seeded skills have organizationId = NULL; update using just the id.
    const [row] = await db
      .update(aiEstimatorSkills)
      .set({ isActive: input.isActive, updatedAt: new Date() })
      .where(eq(aiEstimatorSkills.id, skillId))
      .returning();
    return row ?? null;
  }

  if (existing.organizationId !== organizationId) return null;

  const [row] = await db
    .update(aiEstimatorSkills)
    .set({
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.ruleBody !== undefined ? { ruleBody: input.ruleBody.trim() } : {}),
      ...(input.scope !== undefined ? { scope: input.scope } : {}),
      ...(input.scopeValue !== undefined ? { scopeValue: input.scopeValue } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(aiEstimatorSkills.id, skillId),
        eq(aiEstimatorSkills.organizationId, organizationId),
      ),
    )
    .returning();
  return row ?? null;
}

export async function deleteSkill(
  skillId: string,
  organizationId: string,
): Promise<{ deleted: boolean; reason?: string }> {
  const existing = await getSkillById(skillId, organizationId);
  if (!existing) return { deleted: false, reason: "Not found" };
  if (existing.isReadOnly) return { deleted: false, reason: "Read-only skill cannot be deleted. Use the active toggle to disable it instead." };
  if (existing.organizationId !== organizationId) return { deleted: false, reason: "Not found" };

  // Soft-delete: stamp deletedAt rather than hard-removing the row.
  await db
    .update(aiEstimatorSkills)
    .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
    .where(
      and(
        eq(aiEstimatorSkills.id, skillId),
        eq(aiEstimatorSkills.organizationId, organizationId),
      ),
    );
  return { deleted: true };
}

/**
 * Bulk priority update. Each item is { id, priority }. Only skills
 * belonging to the org (not seeded) can be reordered.
 */
export async function reorderSkills(
  organizationId: string,
  items: Array<{ id: string; priority: number }>,
): Promise<void> {
  await Promise.all(
    items.map(({ id, priority }) =>
      db
        .update(aiEstimatorSkills)
        .set({ priority, updatedAt: new Date() })
        .where(
          and(
            eq(aiEstimatorSkills.id, id),
            eq(aiEstimatorSkills.organizationId, organizationId),
          ),
        ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Promote a lesson into a permanent skill
// ---------------------------------------------------------------------------

export async function promoteLessonToSkill(
  organizationId: string,
  lessonId: string,
  userId: string,
): Promise<AiEstimatorSkill | null> {
  const [lesson] = await db
    .select()
    .from(aiEstimatorKnowledgeIndex)
    .where(
      and(
        eq(aiEstimatorKnowledgeIndex.id, lessonId),
        eq(aiEstimatorKnowledgeIndex.organizationId, organizationId),
        eq(aiEstimatorKnowledgeIndex.sourceType, "qualitative_lesson"),
      ),
    )
    .limit(1);
  if (!lesson) return null;

  const rawScope = lesson.lessonScope ?? "global";
  const scope = (["global", "trade", "csi_division", "project_type"].includes(rawScope)
    ? rawScope
    : "global") as "global" | "trade" | "csi_division" | "project_type";
  const scopeValue =
    scope === "trade"
      ? lesson.tradeType ?? null
      : null;

  const [row] = await db
    .insert(aiEstimatorSkills)
    .values({
      organizationId,
      name: lesson.title.replace(/^Lesson:\s*/i, "").trim().slice(0, 120),
      description: `Promoted from lesson (${lesson.id.slice(0, 8)})`,
      ruleBody: lesson.contentSnippet,
      scope,
      scopeValue,
      priority: 100,
      isActive: true,
      isReadOnly: false,
      sourceType: "promoted_lesson",
      sourceLessonId: lessonId,
      createdById: userId,
    })
    .returning();

  await db
    .update(aiEstimatorKnowledgeIndex)
    .set({ lessonStatus: "stale" })
    .where(eq(aiEstimatorKnowledgeIndex.id, lessonId));

  return row;
}

// ---------------------------------------------------------------------------
// AI-generated skill suggestions from recent lessons
// ---------------------------------------------------------------------------

export interface SkillSuggestion {
  name: string;
  ruleBody: string;
  scope: "global" | "trade" | "csi_division" | "project_type";
  scopeValue?: string | null;
  lessonIds: string[];
}

function safeJson<T>(text: string | null | undefined): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function generateSkillSuggestions(opts: {
  organizationId: string;
  userId: string | null;
}): Promise<SkillSuggestion[]> {
  try {
    const lessons = await db
      .select()
      .from(aiEstimatorKnowledgeIndex)
      .where(
        and(
          eq(aiEstimatorKnowledgeIndex.organizationId, opts.organizationId),
          eq(aiEstimatorKnowledgeIndex.sourceType, "qualitative_lesson"),
          eq(aiEstimatorKnowledgeIndex.lessonStatus, "active"),
        ),
      )
      .orderBy(desc(aiEstimatorKnowledgeIndex.indexedAt))
      .limit(30);

    if (lessons.length === 0) return [];

    const lessonSummaries = lessons.map((l) => ({
      id: l.id,
      scope: l.lessonScope,
      tradeType: l.tradeType,
      costCode: l.costCode,
      lesson: l.contentSnippet,
    }));

    const sysPrompt = `You are an expert construction estimating methodology consultant.
Given a list of estimating lessons learned from user corrections, group similar lessons and propose consolidated, reusable skill rules.
Return up to 10 suggestions. Each suggestion should be a clear, actionable rule statement (1–3 sentences).
Return strict JSON: { "suggestions": [{ "name": string, "ruleBody": string, "scope": "global"|"trade"|"csi_division"|"project_type", "scopeValue": string|null, "lessonIds": string[] }] }
Group only lessons with common themes. Leave unrelated lessons alone rather than grouping them artificially.`;

    const gov = await governedAiCall<string | null>({
      orgId: opts.organizationId,
      userId: opts.userId,
      actionType: "ai_estimator.skill_suggestions",
      inputRefs: { lessonCount: lessons.length },
      fn: async () => {
        const completion = await routedChatCompletion({
          orgId: opts.organizationId,
          featureKey: "ai_estimator.skill_suggestions",
          request: {
            messages: [
              { role: "system", content: sysPrompt },
              { role: "user", content: JSON.stringify({ lessons: lessonSummaries }) },
            ],
            max_completion_tokens: 2000,
            response_format: { type: "json_object" },
          },
        });
        return { result: completion.choices[0]?.message?.content ?? null, completion };
      },
    });

    if (gov.blocked || !gov.result) return [];
    const parsed = safeJson<{ suggestions: SkillSuggestion[] }>(gov.result);
    return Array.isArray(parsed?.suggestions) ? parsed.suggestions.slice(0, 10) : [];
  } catch (err) {
    logError("Skill suggestion generation failed", { organizationId: opts.organizationId }, err instanceof Error ? err : new Error(String(err)));
    return [];
  }
}

// ---------------------------------------------------------------------------
// Idempotent seeder for read-only trade packs
// ---------------------------------------------------------------------------

interface SeedSkill {
  name: string;
  description: string;
  ruleBody: string;
  scope: "global" | "trade";
  scopeValue?: string;
  priority: number;
}

// Mapping from old human-readable scopeValues (pre-v2703 seed) to the
// current enum-compatible uppercase values. Used by seedTradePackSkills
// to migrate existing DB rows on first boot after this change.
const SCOPE_VALUE_MIGRATIONS: Record<string, string> = {
  Concrete: "CONCRETE",
  Masonry: "MASONRY",
  Framing: "CARPENTRY",
  Electrical: "ELECTRICAL",
  Plumbing: "PLUMBING",
  Mechanical: "HVAC",
  Sitework: "EARTHWORK",
};

const TRADE_PACK_SKILLS: SeedSkill[] = [
  // ── CONCRETE (5 skills) ──────────────────────────────────────────────
  {
    name: "Concrete waste allowance",
    description: "CONCRETE — standard waste factor",
    ruleBody: "Always include a minimum 5% concrete waste allowance on all cast-in-place concrete line items. For pumped placements, add a separate pump mobilization line item as LS.",
    scope: "trade",
    scopeValue: "CONCRETE",
    priority: 10,
  },
  {
    name: "Rebar tonnage rounding",
    description: "CONCRETE — rebar takeoff convention",
    ruleBody: "Round rebar tonnage up to the nearest 0.25-ton increment. Include a 3% lap-splice waste factor on top of the net computed weight.",
    scope: "trade",
    scopeValue: "CONCRETE",
    priority: 11,
  },
  {
    name: "Formwork per SFCA",
    description: "CONCRETE — formwork measurement convention",
    ruleBody: "Measure formwork in SFCA (square feet of contact area). Include stripping and re-use credit when the same form is used more than twice on the same job.",
    scope: "trade",
    scopeValue: "CONCRETE",
    priority: 12,
  },
  {
    name: "Concrete testing exclusion",
    description: "CONCRETE — testing exclusion clause",
    ruleBody: "Concrete testing and inspection (cylinders, slump, air content) is explicitly excluded unless Owner-furnished testing is specified. Note the exclusion in the estimate notes.",
    scope: "trade",
    scopeValue: "CONCRETE",
    priority: 13,
  },
  {
    name: "Concrete finish specification",
    description: "CONCRETE — slab finish allowance",
    ruleBody: "Identify the specified slab finish (broom, trowel, exposed aggregate) for every concrete slab and add it as a separate line item. Diamond-grind or seal-coat finishes are priced per SF and must not be buried in the slab pour cost.",
    scope: "trade",
    scopeValue: "CONCRETE",
    priority: 14,
  },
  // ── MASONRY (5 skills) ───────────────────────────────────────────────
  {
    name: "Masonry mortar waste",
    description: "MASONRY — mortar waste factor",
    ruleBody: "Add 15% mortar waste to all CMU and brick masonry. Account for grout fill separately at 1.1 times the theoretical void volume.",
    scope: "trade",
    scopeValue: "MASONRY",
    priority: 20,
  },
  {
    name: "CMU unit count rounding",
    description: "MASONRY — CMU quantity takeoff convention",
    ruleBody: "Round CMU quantities up to the nearest full pallet (typically 90 units). Add 5% brick waste and 3% CMU waste for cuts, broken units, and course adjustments.",
    scope: "trade",
    scopeValue: "MASONRY",
    priority: 21,
  },
  {
    name: "Masonry reinforcing schedule",
    description: "MASONRY — steel reinforcing in CMU",
    ruleBody: "Always verify vertical and horizontal reinforcing spacing from the structural drawings before takeoff. Grout cores must be sized to the bar diameter — confirm d/bar spacing and include dowels at footings as a separate item.",
    scope: "trade",
    scopeValue: "MASONRY",
    priority: 22,
  },
  {
    name: "Masonry scaffold and staging",
    description: "MASONRY — scaffold cost inclusion",
    ruleBody: "Include scaffold erect/strike as a separate LS line item for any masonry wall over 6 feet. For multi-story work, assume one scaffold move-up per story and price it separately.",
    scope: "trade",
    scopeValue: "MASONRY",
    priority: 23,
  },
  {
    name: "Masonry control joints and flashing",
    description: "MASONRY — waterproofing accessories",
    ruleBody: "Control joints, expansion joints, weep holes, and through-wall flashing are often omitted from drawings but are required by code. Verify and include as allowances if not shown; note the assumption in estimate notes.",
    scope: "trade",
    scopeValue: "MASONRY",
    priority: 24,
  },
  // ── CARPENTRY / Framing (5 skills) ───────────────────────────────────
  {
    name: "Lumber board-foot waste",
    description: "CARPENTRY — standard lumber waste factor",
    ruleBody: "Apply a 10% board-foot waste factor on all dimensional framing lumber. Increase to 15% for complex hip/valley roofs or curved walls.",
    scope: "trade",
    scopeValue: "CARPENTRY",
    priority: 30,
  },
  {
    name: "Engineered lumber lead time note",
    description: "CARPENTRY — engineered lumber procurement flag",
    ruleBody: "Flag all LVL, PSL, and engineered lumber items with a lead-time risk note. These items commonly have 4–10 week lead times; include a procurement allowance if the schedule is tight.",
    scope: "trade",
    scopeValue: "CARPENTRY",
    priority: 31,
  },
  {
    name: "Sheathing coverage factor",
    description: "CARPENTRY — sheathing waste allowance",
    ruleBody: "Add 8% to computed sheathing area for cuts, waste, and perimeter offcuts. Always include nails/screws as a separate line item rather than burying them in material cost.",
    scope: "trade",
    scopeValue: "CARPENTRY",
    priority: 32,
  },
  {
    name: "Framing hardware allowance",
    description: "CARPENTRY — hardware lump-sum allowance",
    ruleBody: "Include a hardware allowance of $0.15–$0.25 per BF of framing lumber to cover joist hangers, hurricane ties, hold-downs, and miscellaneous connectors unless hardware is called out separately.",
    scope: "trade",
    scopeValue: "CARPENTRY",
    priority: 33,
  },
  {
    name: "Blocking and backing inclusion",
    description: "CARPENTRY — blocking allowance",
    ruleBody: "Include blocking and backing for all cabinets, grab bars, fixtures, and wall-hung equipment. Blocking is rarely shown on drawings — add a minimum 2% of lumber BF as a blocking allowance for residential and 3% for commercial.",
    scope: "trade",
    scopeValue: "CARPENTRY",
    priority: 34,
  },
  // ── ELECTRICAL (5 skills) ─────────────────────────────────────────────
  {
    name: "Electrical conduit fill factor",
    description: "ELECTRICAL — conduit waste and fitting allowance",
    ruleBody: "Add 10% to computed conduit runs for fittings, offsets, and waste. EMT elbows, couplings, and connectors are typically not shown on drawings — estimate them from the conduit lineal footage.",
    scope: "trade",
    scopeValue: "ELECTRICAL",
    priority: 40,
  },
  {
    name: "Electrical panel schedule verification",
    description: "ELECTRICAL — panel load schedule check",
    ruleBody: "Verify that the electrical panel schedule matches the one-line diagram before pricing. Discrepancies between the schedule and the plans must be flagged to the EOR; assume the more expensive option when in doubt.",
    scope: "trade",
    scopeValue: "ELECTRICAL",
    priority: 41,
  },
  {
    name: "Electrical permit fee allowance",
    description: "ELECTRICAL — permit cost inclusion",
    ruleBody: "Include a permit fee allowance of 0.5–1% of the total electrical cost unless the Owner is pulling permits. Note the assumption explicitly in estimate notes.",
    scope: "trade",
    scopeValue: "ELECTRICAL",
    priority: 42,
  },
  {
    name: "Temporary power inclusion",
    description: "ELECTRICAL — temporary construction power",
    ruleBody: "Include temporary power service (meter socket, panel, GFCI distribution) as a separate LS line item for all construction projects unless temporary power is Owner-furnished. Size the temporary panel for 200A minimum on projects over 10,000 SF.",
    scope: "trade",
    scopeValue: "ELECTRICAL",
    priority: 43,
  },
  {
    name: "Wire pull and termination labor",
    description: "ELECTRICAL — wire installation labor separation",
    ruleBody: "Price wire (copper/aluminum) and conduit as separate material line items. Wire pull labor is priced separately from conduit installation — do not combine. Termination labor at devices and panels is also a separate line item.",
    scope: "trade",
    scopeValue: "ELECTRICAL",
    priority: 44,
  },
  // ── PLUMBING (5 skills) ───────────────────────────────────────────────
  {
    name: "Plumbing rough-in clearances",
    description: "PLUMBING — overhead factor",
    ruleBody: "Add 15% overhead to all plumbing rough-in labor for coordination, access, and rework. Underground plumbing should include compaction backfill labor as a separate line item.",
    scope: "trade",
    scopeValue: "PLUMBING",
    priority: 50,
  },
  {
    name: "Plumbing fixture allowance separation",
    description: "PLUMBING — owner-furnished vs contractor-furnished fixtures",
    ruleBody: "Clearly distinguish between Owner-furnished / Contractor-installed (OFCI) and Contractor-furnished / Contractor-installed (CFCI) plumbing fixtures. Price rough-in for OFCI items but carry the fixture cost only for CFCI items.",
    scope: "trade",
    scopeValue: "PLUMBING",
    priority: 51,
  },
  {
    name: "Plumbing pressure test allowance",
    description: "PLUMBING — system test cost inclusion",
    ruleBody: "Include hydrostatic pressure testing for all domestic water and gas piping as a separate line item. Assume one test per system segment (domestic cold, domestic hot, gas). Do not lump testing into rough-in labor.",
    scope: "trade",
    scopeValue: "PLUMBING",
    priority: 52,
  },
  {
    name: "Underground plumbing sleeving",
    description: "PLUMBING — underground sleeve and protection",
    ruleBody: "All below-slab plumbing lines must include sleeve/core-drill through footings as a separate line item. Add concrete cutting and patching allowance when routing through existing slabs.",
    scope: "trade",
    scopeValue: "PLUMBING",
    priority: 53,
  },
  {
    name: "Plumbing inspection fees",
    description: "PLUMBING — inspection and permit cost",
    ruleBody: "Include permit and inspection fee allowance of 0.5–1% of total plumbing cost unless Owner is pulling permits. Note the assumption in estimate notes.",
    scope: "trade",
    scopeValue: "PLUMBING",
    priority: 54,
  },
  // ── HVAC / Mechanical (5 skills) ─────────────────────────────────────
  {
    name: "HVAC ductwork insulation",
    description: "HVAC — ductwork insulation inclusion reminder",
    ruleBody: "Verify whether ductwork insulation is included in the sheet-metal scope or carried separately by the insulation subcontractor. Flag the assumption explicitly in estimate notes.",
    scope: "trade",
    scopeValue: "HVAC",
    priority: 60,
  },
  {
    name: "HVAC equipment lead time",
    description: "HVAC — equipment procurement flag",
    ruleBody: "Flag all HVAC equipment items (AHUs, chillers, cooling towers, VRF systems) with a procurement lead-time note. Equipment lead times of 12–52 weeks are common — identify procurement-critical items at bid time.",
    scope: "trade",
    scopeValue: "HVAC",
    priority: 61,
  },
  {
    name: "Mechanical balance and commissioning",
    description: "HVAC — TAB and commissioning cost",
    ruleBody: "Include a Testing, Adjusting, and Balancing (TAB) allowance as a separate LS line item for all HVAC systems. Also include commissioning labor for controls, BAS points, and VFD startup. Do not bury these in installation labor.",
    scope: "trade",
    scopeValue: "HVAC",
    priority: 62,
  },
  {
    name: "HVAC refrigerant startup",
    description: "HVAC — refrigerant charge and startup",
    ruleBody: "Include refrigerant charge (lbs) as a separate material line item for all DX split systems and VRF. Startup and charge verification labor is separate from installation. Add leak-check labor as a standalone item.",
    scope: "trade",
    scopeValue: "HVAC",
    priority: 63,
  },
  {
    name: "HVAC permit fee allowance",
    description: "HVAC — permit cost inclusion",
    ruleBody: "Include a mechanical permit fee allowance of 0.3–0.8% of total HVAC cost unless Owner is pulling permits. Note the assumption in estimate notes.",
    scope: "trade",
    scopeValue: "HVAC",
    priority: 64,
  },
  // ── EARTHWORK / Sitework (5 skills) ─────────────────────────────────
  {
    name: "Earthwork swell factor",
    description: "EARTHWORK — soil swell conversion",
    ruleBody: "Apply a swell factor when converting bank measure (BCY) to loose measure (LCY) for trucking. Use 1.15 for sandy/granular soils, 1.25 for clay/silt, 1.35 for rock. State the assumed swell factor in the estimate.",
    scope: "trade",
    scopeValue: "EARTHWORK",
    priority: 70,
  },
  {
    name: "Erosion control exclusion",
    description: "EARTHWORK — SWPPP exclusion clause",
    ruleBody: "SWPPP preparation and ongoing erosion control monitoring are excluded from the earthwork scope unless listed. Include one-time installation of silt fence and inlet protection as a standard allowance.",
    scope: "trade",
    scopeValue: "EARTHWORK",
    priority: 71,
  },
  {
    name: "Subgrade compaction testing",
    description: "EARTHWORK — compaction testing exclusion",
    ruleBody: "Compaction testing and special inspections are Owner-furnished unless noted otherwise. Flag this assumption and include an allowance for re-rolling if tests fail.",
    scope: "trade",
    scopeValue: "EARTHWORK",
    priority: 72,
  },
  {
    name: "Import/export haul rate",
    description: "EARTHWORK — haul distance assumption",
    ruleBody: "State the assumed haul distance for import/export material. For borrow, assume a 10-mile round trip unless the drawings specify a source. For export, use a 15-mile round trip to a licensed disposal site.",
    scope: "trade",
    scopeValue: "EARTHWORK",
    priority: 73,
  },
  {
    name: "Underground utility locating",
    description: "EARTHWORK — utility conflict allowance",
    ruleBody: "Include an allowance for hand-digging / vacuum excavation around existing underground utilities. Minimum 4 hours of potholing per 500 LF of new utility run in urban areas.",
    scope: "trade",
    scopeValue: "EARTHWORK",
    priority: 74,
  },
  // ── DRYWALL (5 skills) ───────────────────────────────────────────────
  {
    name: "Drywall waste factor",
    description: "DRYWALL — takeoff waste",
    ruleBody: "Add 10% waste to all drywall (gypsum board) quantities. For complex ceiling or curved-wall areas, increase waste to 15%.",
    scope: "trade",
    scopeValue: "DRYWALL",
    priority: 80,
  },
  {
    name: "Drywall tape and finish labor",
    description: "DRYWALL — finishing coat separation",
    ruleBody: "Price hanging, taping, and finish coats as separate line items. Level of finish (1–5 per GA-214) drives material and labor cost significantly — confirm the specified level with the architect before bidding.",
    scope: "trade",
    scopeValue: "DRYWALL",
    priority: 81,
  },
  {
    name: "Drywall bead and accessory allowance",
    description: "DRYWALL — metal bead cost inclusion",
    ruleBody: "Include corner bead, control joint, expansion bead, and casing bead as a separate material allowance. Assume 1 LF of bead per 8 LF of wall perimeter as a minimum when not detailed on drawings.",
    scope: "trade",
    scopeValue: "DRYWALL",
    priority: 82,
  },
  {
    name: "Drywall fire-rating verification",
    description: "DRYWALL — fire assembly check",
    ruleBody: "Verify UL assembly numbers for all fire-rated walls and ceilings before pricing. Type X vs Type C board, number of layers, and stud spacing all affect cost. Flag any assembly where the specified UL number cannot be matched.",
    scope: "trade",
    scopeValue: "DRYWALL",
    priority: 83,
  },
  {
    name: "Drywall acoustical detail",
    description: "DRYWALL — acoustical isolation cost",
    ruleBody: "Acoustically rated wall assemblies require resilient channels, hat channels, or clips, sound-attenuating insulation batt, and sealant at perimeter. Price each component separately; do not bundle into a single drywall line item.",
    scope: "trade",
    scopeValue: "DRYWALL",
    priority: 84,
  },
  // ── PAINTING (5 skills) ───────────────────────────────────────────────
  {
    name: "Paint coverage assumption",
    description: "PAINTING — coverage rate",
    ruleBody: "Use 350 SF/gallon for primer and 400 SF/gallon for finish coat on smooth surfaces. Textured surfaces reduce coverage by 20%. Include a two-coat system unless single coat is specified.",
    scope: "trade",
    scopeValue: "PAINTING",
    priority: 90,
  },
  {
    name: "Painting protection allowance",
    description: "PAINTING — surface protection",
    ruleBody: "Include masking, drop cloths, and plastic sheeting protection as a lump-sum allowance for every painting scope. Minimum $0.05/SF of painted area for protection materials and labor.",
    scope: "trade",
    scopeValue: "PAINTING",
    priority: 91,
  },
  {
    name: "Painting surface preparation",
    description: "PAINTING — prep cost separation",
    ruleBody: "Surface preparation (sanding, patching, skim coat, prime spot) is a separate line item from painting. Existing surfaces require more prep than new — verify surface condition and add a contingency if the existing surface is unknown.",
    scope: "trade",
    scopeValue: "PAINTING",
    priority: 92,
  },
  {
    name: "Painting color count premium",
    description: "PAINTING — accent color cost",
    ruleBody: "Each additional color beyond the base color requires a separate setup, equipment clean, and material change. Add a per-color-change premium (minimum $150 per color change, per day) when more than two colors are specified in a space.",
    scope: "trade",
    scopeValue: "PAINTING",
    priority: 93,
  },
  {
    name: "Exterior painting warranty note",
    description: "PAINTING — warranty clause",
    ruleBody: "Exterior painting warranties depend on surface prep and primer compatibility. Note the assumed warranty period (typically 2–5 years on exterior) and flag any substrate condition that may void the warranty.",
    scope: "trade",
    scopeValue: "PAINTING",
    priority: 94,
  },
  // ── FLOORING (5 skills) ───────────────────────────────────────────────
  {
    name: "Flooring substrate preparation",
    description: "FLOORING — floor prep inclusion",
    ruleBody: "Include floor substrate preparation (grinding, patching, skim coat) as a separate line item for all hard-surface flooring. Assume 200 SF/day production rate for skim coat unless surveyed conditions dictate otherwise.",
    scope: "trade",
    scopeValue: "FLOORING",
    priority: 100,
  },
  {
    name: "Tile grout and setting material",
    description: "FLOORING — tile accessory inclusion",
    ruleBody: "Always include grout, thin-set, and backer board as separate line items for tile work. Do not bury these in the tile supply cost. Add 5% waste to all tile quantities.",
    scope: "trade",
    scopeValue: "FLOORING",
    priority: 101,
  },
  {
    name: "Flooring expansion gap allowance",
    description: "FLOORING — perimeter gap requirement",
    ruleBody: "All floating floor systems (LVP, laminate, engineered hardwood) require a minimum 3/8\" expansion gap at all walls and vertical obstructions. Include transition strips as a separate line item at all doorways and changes of flooring material.",
    scope: "trade",
    scopeValue: "FLOORING",
    priority: 102,
  },
  {
    name: "Flooring adhesive and underlayment",
    description: "FLOORING — adhesive and underlayment separation",
    ruleBody: "Adhesive, underlayment, and moisture barrier are priced as separate material line items from the flooring material itself. Do not bundle these into a single floor-installed price.",
    scope: "trade",
    scopeValue: "FLOORING",
    priority: 103,
  },
];

/**
 * Idempotent seed of the read-only trade pack skills. Skips any row
 * where a seeded skill with the same name already exists at org=NULL.
 * Also migrates old human-readable scopeValues ("Concrete", "Masonry" …)
 * to enum-compatible uppercase values ("CONCRETE", "MASONRY" …).
 * Safe to call on every boot.
 */
export async function seedTradePackSkills(): Promise<{ seeded: number; skipped: number }> {
  let seeded = 0;
  let skipped = 0;

  // One-time migration: rename old scopeValues to enum-compatible uppercase.
  for (const [oldVal, newVal] of Object.entries(SCOPE_VALUE_MIGRATIONS)) {
    try {
      await db
        .update(aiEstimatorSkills)
        .set({ scopeValue: newVal, updatedAt: new Date() })
        .where(
          and(
            isNull(aiEstimatorSkills.organizationId),
            eq(aiEstimatorSkills.isReadOnly, true),
            eq(aiEstimatorSkills.scopeValue, oldVal),
          ),
        );
    } catch {
      // Best-effort; never blocks seeding.
    }
  }

  for (const skill of TRADE_PACK_SKILLS) {
    try {
      const existing = await db
        .select({ id: aiEstimatorSkills.id })
        .from(aiEstimatorSkills)
        .where(
          and(
            isNull(aiEstimatorSkills.organizationId),
            eq(aiEstimatorSkills.name, skill.name),
            eq(aiEstimatorSkills.isReadOnly, true),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        skipped++;
        continue;
      }

      await db.insert(aiEstimatorSkills).values({
        organizationId: null,
        name: skill.name,
        description: skill.description,
        ruleBody: skill.ruleBody,
        scope: skill.scope,
        scopeValue: skill.scopeValue ?? null,
        priority: skill.priority,
        isActive: true,
        isReadOnly: true,
        sourceType: "seeded",
        createdById: null,
      });
      seeded++;
    } catch (err) {
      logError(
        "Skill seed failed for row",
        { name: skill.name },
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }

  if (seeded > 0) {
    logInfo("AI Estimator trade-pack skills seeded", { seeded, skipped });
  }
  return { seeded, skipped };
}
