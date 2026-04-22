import { db } from "./db";
import { eq, and } from "drizzle-orm";
import { projectTemplates, projectTemplateVersions } from "@shared/schema";
import type { ProjectTemplateSnapshot, TemplateTaskSnapshot } from "./projectTemplateCapture";

interface SeedTaskDef {
  name: string;
  durationDays: number;
  isMilestone?: boolean;
  outlineLevel?: number;
  tradeType?: string;
  children?: SeedTaskDef[];
}

interface SeedTemplateDef {
  slug: string;
  name: string;
  category: string;
  description: string;
  tasks: SeedTaskDef[];
}

const SYSTEM_SEED_DEFS: SeedTemplateDef[] = [
  {
    slug: "system-residential-remodel",
    name: "Residential Remodel",
    category: "Residential",
    description: "Standard kitchen / bath / whole-home remodel WBS with permits, demo, rough-ins, finishes and punch list.",
    tasks: [
      { name: "Pre-construction", durationDays: 14, children: [
        { name: "Permits & approvals", durationDays: 14 },
        { name: "Material procurement", durationDays: 21 },
      ]},
      { name: "Demolition", durationDays: 5 },
      { name: "Rough-ins", durationDays: 14, children: [
        { name: "Plumbing rough-in", durationDays: 5, tradeType: "PLUMBING" },
        { name: "Electrical rough-in", durationDays: 5, tradeType: "ELECTRICAL" },
        { name: "HVAC rough-in", durationDays: 4, tradeType: "HVAC" },
      ]},
      { name: "Drywall & paint", durationDays: 10 },
      { name: "Cabinets & countertops", durationDays: 7 },
      { name: "Finishes & fixtures", durationDays: 10 },
      { name: "Final inspection", durationDays: 1, isMilestone: true },
      { name: "Punch list & closeout", durationDays: 5 },
    ],
  },
  {
    slug: "system-commercial-new-build",
    name: "Commercial New Build",
    category: "Commercial",
    description: "Ground-up commercial construction skeleton: sitework, foundations, structure, envelope, MEP, interiors and TCO.",
    tasks: [
      { name: "Mobilization", durationDays: 7 },
      { name: "Sitework", durationDays: 30, children: [
        { name: "Excavation", durationDays: 10 },
        { name: "Underground utilities", durationDays: 14 },
      ]},
      { name: "Foundations", durationDays: 21 },
      { name: "Structure", durationDays: 60, children: [
        { name: "Steel erection", durationDays: 30 },
        { name: "Decking", durationDays: 14 },
      ]},
      { name: "Envelope", durationDays: 45 },
      { name: "MEP rough-in", durationDays: 60 },
      { name: "Interior fit-out", durationDays: 60 },
      { name: "Commissioning", durationDays: 14 },
      { name: "TCO", durationDays: 1, isMilestone: true },
      { name: "Punch list", durationDays: 21 },
    ],
  },
  {
    slug: "system-tenant-improvement",
    name: "Tenant Improvement",
    category: "Commercial",
    description: "Interior tenant improvement / build-out template with demo, partitions, MEP and finishes.",
    tasks: [
      { name: "Pre-construction", durationDays: 7 },
      { name: "Demolition", durationDays: 5 },
      { name: "Framing & partitions", durationDays: 10 },
      { name: "MEP rough-in", durationDays: 14 },
      { name: "Drywall & paint", durationDays: 10 },
      { name: "Flooring", durationDays: 7 },
      { name: "Doors, frames & hardware", durationDays: 5 },
      { name: "Final fixtures & trim", durationDays: 5 },
      { name: "Final inspection", durationDays: 1, isMilestone: true },
      { name: "Punch list", durationDays: 5 },
    ],
  },
  {
    slug: "system-road-rehab",
    name: "DOT Road Rehab",
    category: "Heavy Civil",
    description: "Asphalt/concrete road rehabilitation template: MOT, milling, base repair, paving, striping and final acceptance.",
    tasks: [
      { name: "Mobilization & MOT setup", durationDays: 5 },
      { name: "Milling", durationDays: 7 },
      { name: "Base repair", durationDays: 10 },
      { name: "Paving", durationDays: 10, children: [
        { name: "Binder course", durationDays: 5 },
        { name: "Surface course", durationDays: 5 },
      ]},
      { name: "Striping & markings", durationDays: 3 },
      { name: "Punch list", durationDays: 5 },
      { name: "Final acceptance", durationDays: 1, isMilestone: true },
    ],
  },
  {
    slug: "system-bridge-rehab",
    name: "DOT Bridge Rehab",
    category: "Heavy Civil",
    description: "Bridge rehabilitation template: deck repair, joint replacement, painting, and load testing.",
    tasks: [
      { name: "Mobilization & traffic control", durationDays: 7 },
      { name: "Inspection & survey", durationDays: 5 },
      { name: "Deck demolition", durationDays: 14 },
      { name: "Structural repair", durationDays: 30, children: [
        { name: "Substructure repair", durationDays: 14 },
        { name: "Superstructure repair", durationDays: 16 },
      ]},
      { name: "Deck replacement", durationDays: 21 },
      { name: "Joint replacement", durationDays: 7 },
      { name: "Painting & coatings", durationDays: 14 },
      { name: "Load testing", durationDays: 3 },
      { name: "Final acceptance", durationDays: 1, isMilestone: true },
    ],
  },
  {
    slug: "system-generic-project",
    name: "Generic Project",
    category: "General",
    description: "Minimal blank-ish template with the standard phases: planning, execution, closeout.",
    tasks: [
      { name: "Planning", durationDays: 10 },
      { name: "Mobilization", durationDays: 5 },
      { name: "Execution", durationDays: 60 },
      { name: "Inspections", durationDays: 5 },
      { name: "Punch list", durationDays: 7 },
      { name: "Closeout", durationDays: 5, isMilestone: true },
    ],
  },
];

function flattenTasks(defs: SeedTaskDef[]): TemplateTaskSnapshot[] {
  const out: TemplateTaskSnapshot[] = [];
  let cursorOffset = 0;
  let counter = 0;

  function walk(list: SeedTaskDef[], parentRef: string | null, level: number, baseOffset: number): number {
    let localCursor = baseOffset;
    let maxEnd = baseOffset;
    for (const t of list) {
      counter++;
      const refId = `task_${counter}`;
      const start = localCursor;
      const end = start + t.durationDays;
      out.push({
        refId,
        parentRefId: parentRef,
        name: t.name,
        description: null,
        wbsCode: null,
        outlineLevel: level,
        durationDays: t.durationDays,
        isMilestone: !!t.isMilestone,
        sortOrder: out.length,
        tradeType: t.tradeType ?? null,
        startOffsetDays: start,
        endOffsetDays: end,
        costCodeId: null,
      });
      let childEnd = end;
      if (t.children && t.children.length > 0) {
        childEnd = walk(t.children, refId, level + 1, start);
      }
      localCursor = Math.max(end, childEnd);
      maxEnd = Math.max(maxEnd, localCursor);
    }
    return maxEnd;
  }

  cursorOffset = walk(defs, null, 0, 0);
  void cursorOffset;
  return out;
}

function buildSnapshot(def: SeedTemplateDef): ProjectTemplateSnapshot {
  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    source: { projectId: null, projectCode: null },
    defaults: {
      payrollFormVariant: null,
      autoChangeOrderEnabled: null,
      geofenceEnforcement: null,
    },
    tasks: flattenTasks(def.tasks),
    dependencies: [],
    documentFolders: [
      { name: "Contracts" },
      { name: "Drawings" },
      { name: "Permits" },
      { name: "Submittals" },
      { name: "RFIs" },
      { name: "Daily Reports" },
      { name: "Photos" },
      { name: "Closeout" },
    ],
    distributionLists: [],
    customFieldDefaults: {},
    costCodes: [],
    scheduleOfValues: null,
    rfiCategories: ["Architectural", "Structural", "MEP", "Civil", "Specifications", "Schedule"],
    submittalCategories: ["Product Data", "Shop Drawings", "Samples", "Mock-ups", "Test Reports", "Closeout"],
  };
}

export async function seedSystemProjectTemplates(): Promise<void> {
  for (const def of SYSTEM_SEED_DEFS) {
    const existing = await db
      .select()
      .from(projectTemplates)
      .where(and(eq(projectTemplates.isSystemSeed, true), eq(projectTemplates.name, def.name)))
      .limit(1);

    if (existing.length > 0) continue;

    const snapshot = buildSnapshot(def);

    const [tpl] = await db
      .insert(projectTemplates)
      .values({
        organizationId: null,
        name: def.name,
        description: def.description,
        category: def.category,
        isSystemSeed: true,
        isActive: true,
      })
      .returning();

    await db.insert(projectTemplateVersions).values({
      templateId: tpl.id,
      version: 1,
      snapshot: snapshot as unknown as Record<string, unknown>,
      notes: "Initial system seed",
    });
  }
}
