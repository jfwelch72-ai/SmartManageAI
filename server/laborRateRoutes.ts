import { logError } from "./utils/logger";
import { Router, Response, NextFunction } from "express";
import multer from "multer";
import { z } from "zod";
import { db } from "./db";
import { 
  jobClassifications, 
  employeeClassifications, 
  prevailingWageRates,
  projectEmployeeRates,
  users,
  projects,
  annualSalaryCategories,
  burdenRates,
  employeeCostAssignments,
  insertJobClassificationSchema,
  insertEmployeeClassificationSchema,
  insertPrevailingWageRateSchema,
  insertAnnualSalaryCategorySchema,
  insertBurdenRateSchema,
  insertEmployeeCostAssignmentSchema
} from "@shared/schema";
import { eq, and, desc, asc } from "drizzle-orm";
import { logAudit } from "./auditLogger";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { queueWageDecisionSync } from "./integrations/providers/dol_davis_bacon/sync";
import { logWarn } from "./utils/logger";

// Task #1331: when a prevailing wage rate row references a Davis-Bacon
// decision number that hasn't been imported yet, kick off a background sync
// using the same helper as the project create/update path so the certified
// payroll generator can resolve the rate without the user clicking
// "Import now". Fire-and-forget; failures are logged but do not block the
// API response.
function triggerWageDecisionSync(organizationId: string, decision: string | null | undefined, context: Record<string, unknown>): void {
  const trimmed = (decision ?? "").trim();
  if (!trimmed) return;
  queueWageDecisionSync(organizationId, trimmed).catch((err) => {
    logWarn("queueWageDecisionSync failed (prevailing wage rate)", {
      ...context,
      decision: trimmed,
      error: String(err),
    });
  });
}

const router = Router();

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// ==================== JOB CLASSIFICATIONS ====================

router.get("/classifications", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user!.organizationId;
    if (!organizationId) {
      return res.status(400).json({ error: "Organization required" });
    }

    const classifications = await db
      .select()
      .from(jobClassifications)
      .where(eq(jobClassifications.organizationId, organizationId))
      .orderBy(asc(jobClassifications.sortOrder), asc(jobClassifications.name));

    res.json(classifications);
  } catch (error) {
    next(error);
  }
});

router.post("/classifications", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user!.organizationId;
    if (!organizationId) {
      return res.status(400).json({ error: "Organization required" });
    }

    const data = insertJobClassificationSchema.parse({
      ...req.body,
      organizationId
    });

    const [classification] = await db
      .insert(jobClassifications)
      .values(data)
      .returning();

    await logAudit({
      userId: req.user!.id,
      entityType: "job_classification",
      entityId: classification.id,
      action: "CREATE",
      newValue: typeof classification === 'string' ? classification : JSON.stringify(classification)
    }, req);

    res.status(201).json(classification);
  } catch (error) {
    next(error);
  }
});

router.patch("/classifications/:id", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user!.organizationId;
    if (!organizationId) {
      return res.status(400).json({ error: "Organization required" });
    }

    const { id } = req.params;
    const { name, code, description, defaultRegularRate, defaultOvertimeRate, isActive, sortOrder } = req.body;

    const [existing] = await db
      .select()
      .from(jobClassifications)
      .where(and(
        eq(jobClassifications.id, id),
        eq(jobClassifications.organizationId, organizationId)
      ));

    if (!existing) {
      return res.status(404).json({ error: "Classification not found" });
    }

    const [updated] = await db
      .update(jobClassifications)
      .set({
        name: name !== undefined ? name : existing.name,
        code: code !== undefined ? code : existing.code,
        description: description !== undefined ? description : existing.description,
        defaultRegularRate: defaultRegularRate !== undefined ? defaultRegularRate : existing.defaultRegularRate,
        defaultOvertimeRate: defaultOvertimeRate !== undefined ? defaultOvertimeRate : existing.defaultOvertimeRate,
        isActive: isActive !== undefined ? isActive : existing.isActive,
        sortOrder: sortOrder !== undefined ? sortOrder : existing.sortOrder,
        updatedAt: new Date()
      })
      .where(and(
        eq(jobClassifications.id, id),
        eq(jobClassifications.organizationId, organizationId)
      ))
      .returning();

    await logAudit({
      userId: req.user!.id,
      entityType: "job_classification",
      entityId: id,
      action: "UPDATE",
      oldValue: typeof existing === 'string' ? existing : JSON.stringify(existing),
      newValue: typeof updated === 'string' ? updated : JSON.stringify(updated)
    }, req);

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.delete("/classifications/:id", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user!.organizationId;
    if (!organizationId) {
      return res.status(400).json({ error: "Organization required" });
    }

    const { id } = req.params;

    const [existing] = await db
      .select()
      .from(jobClassifications)
      .where(and(
        eq(jobClassifications.id, id),
        eq(jobClassifications.organizationId, organizationId)
      ));

    if (!existing) {
      return res.status(404).json({ error: "Classification not found" });
    }

    await db
      .delete(jobClassifications)
      .where(and(
        eq(jobClassifications.id, id),
        eq(jobClassifications.organizationId, organizationId)
      ));

    await logAudit({
      userId: req.user!.id,
      entityType: "job_classification",
      entityId: id,
      action: "DELETE",
      oldValue: typeof existing === 'string' ? existing : JSON.stringify(existing)
    }, req);

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ==================== EMPLOYEE CLASSIFICATIONS ====================

router.get("/employee-classifications", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user!.organizationId;
    if (!organizationId) {
      return res.status(400).json({ error: "Organization required" });
    }

    const { userId } = req.query;

    let query = db
      .select({
        id: employeeClassifications.id,
        userId: employeeClassifications.userId,
        classificationId: employeeClassifications.classificationId,
        regularRate: employeeClassifications.regularRate,
        overtimeRate: employeeClassifications.overtimeRate,
        isPrimary: employeeClassifications.isPrimary,
        effectiveDate: employeeClassifications.effectiveDate,
        endDate: employeeClassifications.endDate,
        notes: employeeClassifications.notes,
        createdAt: employeeClassifications.createdAt,
        user: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email
        },
        classification: {
          id: jobClassifications.id,
          name: jobClassifications.name,
          code: jobClassifications.code
        }
      })
      .from(employeeClassifications)
      .leftJoin(users, eq(employeeClassifications.userId, users.id))
      .leftJoin(jobClassifications, eq(employeeClassifications.classificationId, jobClassifications.id))
      .where(eq(employeeClassifications.organizationId, organizationId));

    if (userId && typeof userId === 'string') {
      const results = await db
        .select({
          id: employeeClassifications.id,
          userId: employeeClassifications.userId,
          classificationId: employeeClassifications.classificationId,
          regularRate: employeeClassifications.regularRate,
          overtimeRate: employeeClassifications.overtimeRate,
          isPrimary: employeeClassifications.isPrimary,
          effectiveDate: employeeClassifications.effectiveDate,
          endDate: employeeClassifications.endDate,
          notes: employeeClassifications.notes,
          createdAt: employeeClassifications.createdAt,
          user: {
            id: users.id,
            firstName: users.firstName,
            lastName: users.lastName,
            email: users.email
          },
          classification: {
            id: jobClassifications.id,
            name: jobClassifications.name,
            code: jobClassifications.code
          }
        })
        .from(employeeClassifications)
        .leftJoin(users, eq(employeeClassifications.userId, users.id))
        .leftJoin(jobClassifications, eq(employeeClassifications.classificationId, jobClassifications.id))
        .where(and(
          eq(employeeClassifications.organizationId, organizationId),
          eq(employeeClassifications.userId, userId)
        ));
      return res.json(results);
    }

    const results = await query;
    res.json(results);
  } catch (error) {
    next(error);
  }
});

router.get("/employee-classifications/my-rates", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const organizationId = req.user!.organizationId;
    if (!organizationId) {
      return res.status(400).json({ error: "Organization required" });
    }

    const results = await db
      .select({
        id: employeeClassifications.id,
        classificationId: employeeClassifications.classificationId,
        regularRate: employeeClassifications.regularRate,
        overtimeRate: employeeClassifications.overtimeRate,
        isPrimary: employeeClassifications.isPrimary,
        effectiveDate: employeeClassifications.effectiveDate,
        endDate: employeeClassifications.endDate,
        classification: {
          id: jobClassifications.id,
          name: jobClassifications.name,
          code: jobClassifications.code
        }
      })
      .from(employeeClassifications)
      .leftJoin(jobClassifications, eq(employeeClassifications.classificationId, jobClassifications.id))
      .where(and(
        eq(employeeClassifications.userId, userId),
        eq(employeeClassifications.organizationId, organizationId)
      ));

    res.json(results);
  } catch (error) {
    next(error);
  }
});

router.post("/employee-classifications", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user!.organizationId;
    if (!organizationId) {
      return res.status(400).json({ error: "Organization required" });
    }

    const data = insertEmployeeClassificationSchema.parse({
      ...req.body,
      organizationId
    });

    if (data.isPrimary) {
      await db
        .update(employeeClassifications)
        .set({ isPrimary: false, updatedAt: new Date() })
        .where(and(
          eq(employeeClassifications.userId, data.userId),
          eq(employeeClassifications.organizationId, organizationId)
        ));
    }

    const [assignment] = await db
      .insert(employeeClassifications)
      .values(data)
      .returning();

    await logAudit({
      userId: req.user!.id,
      entityType: "employee_classification",
      entityId: assignment.id,
      action: "CREATE",
      newValue: typeof assignment === 'string' ? assignment : JSON.stringify(assignment)
    }, req);

    res.status(201).json(assignment);
  } catch (error) {
    next(error);
  }
});

router.patch("/employee-classifications/:id", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user!.organizationId;
    if (!organizationId) {
      return res.status(400).json({ error: "Organization required" });
    }

    const { id } = req.params;
    const { regularRate, overtimeRate, isPrimary, effectiveDate, endDate, notes } = req.body;

    const [existing] = await db
      .select()
      .from(employeeClassifications)
      .where(and(
        eq(employeeClassifications.id, id),
        eq(employeeClassifications.organizationId, organizationId)
      ));

    if (!existing) {
      return res.status(404).json({ error: "Employee classification not found" });
    }

    if (isPrimary && !existing.isPrimary) {
      await db
        .update(employeeClassifications)
        .set({ isPrimary: false, updatedAt: new Date() })
        .where(and(
          eq(employeeClassifications.userId, existing.userId),
          eq(employeeClassifications.organizationId, organizationId)
        ));
    }

    const [updated] = await db
      .update(employeeClassifications)
      .set({
        regularRate: regularRate !== undefined ? regularRate : existing.regularRate,
        overtimeRate: overtimeRate !== undefined ? overtimeRate : existing.overtimeRate,
        isPrimary: isPrimary !== undefined ? isPrimary : existing.isPrimary,
        effectiveDate: effectiveDate !== undefined ? effectiveDate : existing.effectiveDate,
        endDate: endDate !== undefined ? endDate : existing.endDate,
        notes: notes !== undefined ? notes : existing.notes,
        updatedAt: new Date()
      })
      .where(eq(employeeClassifications.id, id))
      .returning();

    await logAudit({
      userId: req.user!.id,
      entityType: "employee_classification",
      entityId: id,
      action: "UPDATE",
      oldValue: typeof existing === 'string' ? existing : JSON.stringify(existing),
      newValue: typeof updated === 'string' ? updated : JSON.stringify(updated)
    }, req);

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.delete("/employee-classifications/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user!.organizationId;
    if (!organizationId) {
      return res.status(400).json({ error: "Organization required" });
    }

    const { id } = req.params;

    const [existing] = await db
      .select()
      .from(employeeClassifications)
      .where(and(
        eq(employeeClassifications.id, id),
        eq(employeeClassifications.organizationId, organizationId)
      ));

    if (!existing) {
      return res.status(404).json({ error: "Employee classification not found" });
    }

    await db
      .delete(employeeClassifications)
      .where(eq(employeeClassifications.id, id));

    await logAudit({
      userId: req.user!.id,
      entityType: "employee_classification",
      entityId: id,
      action: "DELETE",
      oldValue: typeof existing === 'string' ? existing : JSON.stringify(existing)
    }, req);

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ==================== PREVAILING WAGE RATES ====================

router.get("/prevailing-wage-rates", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user!.organizationId;
    if (!organizationId) {
      return res.status(400).json({ error: "Organization required" });
    }

    const { projectId } = req.query;

    let whereClause = eq(prevailingWageRates.organizationId, organizationId);
    
    if (projectId && typeof projectId === 'string') {
      const results = await db
        .select({
          id: prevailingWageRates.id,
          projectId: prevailingWageRates.projectId,
          classificationId: prevailingWageRates.classificationId,
          wageRate: prevailingWageRates.wageRate,
          fringeRate: prevailingWageRates.fringeRate,
          totalRate: prevailingWageRates.totalRate,
          overtimeMultiplier: prevailingWageRates.overtimeMultiplier,
          effectiveDate: prevailingWageRates.effectiveDate,
          expirationDate: prevailingWageRates.expirationDate,
          wageDecision: prevailingWageRates.wageDecision,
          notes: prevailingWageRates.notes,
          createdAt: prevailingWageRates.createdAt,
          project: {
            id: projects.id,
            name: projects.name,
            code: projects.code
          },
          classification: {
            id: jobClassifications.id,
            name: jobClassifications.name,
            code: jobClassifications.code
          }
        })
        .from(prevailingWageRates)
        .leftJoin(projects, eq(prevailingWageRates.projectId, projects.id))
        .leftJoin(jobClassifications, eq(prevailingWageRates.classificationId, jobClassifications.id))
        .where(and(
          eq(prevailingWageRates.organizationId, organizationId),
          eq(prevailingWageRates.projectId, projectId)
        ));
      return res.json(results);
    }

    const results = await db
      .select({
        id: prevailingWageRates.id,
        projectId: prevailingWageRates.projectId,
        classificationId: prevailingWageRates.classificationId,
        wageRate: prevailingWageRates.wageRate,
        fringeRate: prevailingWageRates.fringeRate,
        totalRate: prevailingWageRates.totalRate,
        overtimeMultiplier: prevailingWageRates.overtimeMultiplier,
        effectiveDate: prevailingWageRates.effectiveDate,
        expirationDate: prevailingWageRates.expirationDate,
        wageDecision: prevailingWageRates.wageDecision,
        notes: prevailingWageRates.notes,
        createdAt: prevailingWageRates.createdAt,
        project: {
          id: projects.id,
          name: projects.name,
          code: projects.code
        },
        classification: {
          id: jobClassifications.id,
          name: jobClassifications.name,
          code: jobClassifications.code
        }
      })
      .from(prevailingWageRates)
      .leftJoin(projects, eq(prevailingWageRates.projectId, projects.id))
      .leftJoin(jobClassifications, eq(prevailingWageRates.classificationId, jobClassifications.id))
      .where(eq(prevailingWageRates.organizationId, organizationId));

    res.json(results);
  } catch (error) {
    next(error);
  }
});

router.post("/prevailing-wage-rates", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user!.organizationId;
    if (!organizationId) {
      return res.status(400).json({ error: "Organization required" });
    }

    const { wageRate, fringeRate, fringeHealthRate, fringePensionRate, fringeVacationRate, fringeTrainingRate, ...rest } = req.body;

    // Task #1350: the project prevailing-wage panel surfaces classifications
    // straight from the cached DOL wage determination even when the
    // organization has no matching `job_classifications` row yet. Those rows
    // ship a synthetic `dol-feed:<lowercased name>` id so the panel can
    // render. When the user clicks "Override" on one of those rows we have
    // to find-or-create the underlying classification before we can persist
    // a `prevailing_wage_rates` row (the FK requires a real id), otherwise
    // the insert fails with a foreign-key violation. Real-id rows fall
    // straight through unchanged.
    const incomingClassificationId: unknown = (rest as Record<string, unknown>).classificationId;
    if (typeof incomingClassificationId === "string" && incomingClassificationId.startsWith("dol-feed:")) {
      const rawName = typeof (rest as Record<string, unknown>).classificationName === "string"
        ? ((rest as Record<string, unknown>).classificationName as string).trim()
        : incomingClassificationId.slice("dol-feed:".length).trim();
      if (!rawName) {
        return res.status(400).json({
          error: "classificationName is required when promoting a DOL feed classification without an existing job classification",
        });
      }
      const normalized = rawName.toLowerCase();
      const existing = await db
        .select({ id: jobClassifications.id, name: jobClassifications.name })
        .from(jobClassifications)
        .where(eq(jobClassifications.organizationId, organizationId));
      let resolvedId = existing.find((c) => c.name.trim().toLowerCase() === normalized)?.id ?? null;
      if (!resolvedId) {
        const wageNum = parseFloat(String(wageRate ?? ""));
        const otNum = parseFloat(String((rest as Record<string, unknown>).overtimeMultiplier ?? "1.5"));
        const defaultRegularRate = Number.isFinite(wageNum) && wageNum > 0 ? wageNum.toFixed(2) : null;
        const defaultOvertimeRate = Number.isFinite(wageNum) && Number.isFinite(otNum) && wageNum > 0 && otNum > 0
          ? (wageNum * otNum).toFixed(2)
          : null;
        try {
          const insertData = insertJobClassificationSchema.parse({
            organizationId,
            name: rawName,
            defaultRegularRate,
            defaultOvertimeRate,
          });
          const [created] = await db.insert(jobClassifications).values(insertData).returning();
          if (created) {
            resolvedId = created.id;
            await logAudit({
              userId: req.user!.id,
              entityType: "job_classification",
              entityId: created.id,
              action: "CREATE",
              newValue: JSON.stringify(created),
            }, req);
          }
        } catch (createErr) {
          // Race: another request may have just created the same name.
          const refetch = await db
            .select({ id: jobClassifications.id })
            .from(jobClassifications)
            .where(and(eq(jobClassifications.organizationId, organizationId), eq(jobClassifications.name, rawName)));
          if (refetch[0]) {
            resolvedId = refetch[0].id;
          } else {
            throw createErr;
          }
        }
      }
      if (!resolvedId) {
        return res.status(500).json({ error: "Failed to resolve classification for DOL feed override" });
      }
      (rest as Record<string, unknown>).classificationId = resolvedId;
    }
    if ("classificationName" in (rest as Record<string, unknown>)) {
      delete (rest as Record<string, unknown>).classificationName;
    }
    const breakdown = [fringeHealthRate, fringePensionRate, fringeVacationRate, fringeTrainingRate]
      .map(v => parseFloat(v || "0"));
    const breakdownSum = breakdown.reduce((a, b) => a + b, 0);
    const effectiveFringe = fringeRate !== undefined && fringeRate !== null && fringeRate !== ""
      ? fringeRate
      : (breakdownSum > 0 ? breakdownSum.toFixed(2) : "0");
    const totalRate = (parseFloat(wageRate) + parseFloat(effectiveFringe)).toFixed(2);

    const data = insertPrevailingWageRateSchema.parse({
      ...rest,
      wageRate,
      fringeRate: effectiveFringe,
      fringeHealthRate: fringeHealthRate || "0",
      fringePensionRate: fringePensionRate || "0",
      fringeVacationRate: fringeVacationRate || "0",
      fringeTrainingRate: fringeTrainingRate || "0",
      totalRate,
      organizationId
    });

    const [rate] = await db
      .insert(prevailingWageRates)
      .values(data)
      .returning();

    await logAudit({
      userId: req.user!.id,
      entityType: "prevailing_wage_rate",
      entityId: rate.id,
      action: "CREATE",
      newValue: typeof rate === 'string' ? rate : JSON.stringify(rate)
    }, req);

    triggerWageDecisionSync(organizationId, rate.wageDecision, {
      route: "POST /prevailing-wage-rates",
      rateId: rate.id,
    });

    res.status(201).json(rate);
  } catch (error) {
    next(error);
  }
});

// ----- Bulk import (CSV/XLSX) -----

type ImportAction = "CREATE" | "UPDATE" | "ERROR";

interface ImportPreviewRow {
  rowNumber: number;
  rawClassification: string;
  classificationId: string | null;
  classificationName: string | null;
  wageRate: string;
  fringeHealthRate: string;
  fringePensionRate: string;
  fringeVacationRate: string;
  fringeTrainingRate: string;
  fringeRate: string;
  totalRate: string;
  overtimeMultiplier: string;
  effectiveDate: string;
  expirationDate: string | null;
  wageDecision: string | null;
  notes: string | null;
  action: ImportAction;
  existingId: string | null;
  errors: string[];
  createClassification: boolean;
  newClassificationName: string | null;
}

type CellValue = string | number | boolean | Date | null | undefined;
type SheetGrid = CellValue[][];

const importRowSchema = z.object({
  rowNumber: z.number().int().nonnegative().optional(),
  classificationId: z.string().nullable().optional(),
  createClassification: z.boolean().optional(),
  newClassificationName: z.string().optional(),
  wageRate: z.union([z.string(), z.number()]).transform(v => String(v)),
  fringeHealthRate: z.union([z.string(), z.number()]).optional().transform(v => v === undefined ? "0" : String(v)),
  fringePensionRate: z.union([z.string(), z.number()]).optional().transform(v => v === undefined ? "0" : String(v)),
  fringeVacationRate: z.union([z.string(), z.number()]).optional().transform(v => v === undefined ? "0" : String(v)),
  fringeTrainingRate: z.union([z.string(), z.number()]).optional().transform(v => v === undefined ? "0" : String(v)),
  fringeRate: z.union([z.string(), z.number()]).optional().transform(v => v === undefined ? "" : String(v)),
  overtimeMultiplier: z.union([z.string(), z.number()]).optional().transform(v => v === undefined ? "1.5" : String(v)),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "effectiveDate must be YYYY-MM-DD"),
  expirationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  wageDecision: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  action: z.enum(["CREATE", "UPDATE", "ERROR"]).optional(),
  errors: z.array(z.string()).optional(),
});

const newClassificationDefaultsSchema = z.object({
  codePrefix: z.string().trim().max(20).optional(),
  description: z.string().trim().max(500).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
}).optional();

const importPayloadSchema = z.object({
  projectId: z.string().min(1),
  rows: z.array(z.unknown()),
  createMissing: z.boolean().optional(),
  newClassificationDefaults: newClassificationDefaultsSchema,
});

function slugForCode(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 12);
}

const HEADER_ALIASES: Record<string, RegExp> = {
  classification: /^(classification|class|trade|craft|job\s*class|job\s*classification|title)$/i,
  wage: /^(wage|wage\s*rate|base\s*wage|hourly\s*rate|rate|basic\s*hourly|bhr)$/i,
  health: /^(health|health\/welfare|h\s*&\s*w|hw|welfare|medical|health\s*rate)$/i,
  pension: /^(pension|retirement|pension\s*rate)$/i,
  vacation: /^(vacation|holiday|vacation\/holiday|vac|paid\s*leave)$/i,
  training: /^(training|apprentice(ship)?|education|training\s*rate)$/i,
  fringe: /^(fringe|total\s*fringe|fringes|fringe\s*total|fringe\s*benefits)$/i,
  ot: /^(ot|ot\s*mult(iplier)?|overtime|overtime\s*multiplier)$/i,
  effective: /^(effective|effective\s*date|start|start\s*date)$/i,
  expiration: /^(expiration|expiration\s*date|end|end\s*date|expires)$/i,
  decision: /^(wage\s*decision|decision|wd|determination|wd\s*number)$/i,
  notes: /^(notes?|comments?|remarks?)$/i,
};

function findHeaderIndex(headers: string[], key: keyof typeof HEADER_ALIASES): number {
  const re = HEADER_ALIASES[key];
  return headers.findIndex(h => re.test(String(h || "").trim()));
}

function parseNumber(val: CellValue): number {
  if (val === null || val === undefined || val === "") return 0;
  const cleaned = String(val).replace(/[$,\s]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

function parseDateCell(val: CellValue): string | null {
  if (val === null || val === undefined || val === "") return null;
  if (val instanceof Date) {
    return val.toISOString().split("T")[0];
  }
  if (typeof val === "number") {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(epoch.getTime() + val * 86400000);
    return d.toISOString().split("T")[0];
  }
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  return null;
}

function cellAt(row: CellValue[] | undefined, idx: number): CellValue {
  if (!row || idx < 0 || idx >= row.length) return "";
  return row[idx];
}

router.post("/prevailing-wage-rates/import-preview", requireAuth, requireRole("ADMIN", "MANAGER"), importUpload.single("file"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user!.organizationId;
    if (!organizationId) return res.status(400).json({ error: "Organization required" });

    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file uploaded" });

    const projectId = String(req.body.projectId || "");
    if (!projectId) return res.status(400).json({ error: "projectId is required" });
    const defaultEffectiveDate = req.body.defaultEffectiveDate ? String(req.body.defaultEffectiveDate) : null;
    const createMissing = String(req.body.createMissing || "") === "true" || req.body.createMissing === true;

    // Verify project belongs to org
    const [project] = await db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.gcOrganizationId, organizationId)));
    if (!project) return res.status(404).json({ error: "Project not found" });

    // Parse file
    const xlsx = await import("xlsx");
    let workbook;
    try {
      workbook = xlsx.read(file.buffer, { type: "buffer", cellDates: true });
    } catch (e) {
      return res.status(400).json({ error: "Could not parse file. Use CSV or XLSX." });
    }
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) return res.status(400).json({ error: "File is empty" });
    const grid = xlsx.utils.sheet_to_json<CellValue[]>(sheet, { header: 1, raw: true, defval: "" });
    if (grid.length < 2) return res.status(400).json({ error: "File must include a header row and at least one data row" });

    const headers = (grid[0] || []).map(h => String(h ?? "").trim());
    const idx = {
      classification: findHeaderIndex(headers, "classification"),
      wage: findHeaderIndex(headers, "wage"),
      health: findHeaderIndex(headers, "health"),
      pension: findHeaderIndex(headers, "pension"),
      vacation: findHeaderIndex(headers, "vacation"),
      training: findHeaderIndex(headers, "training"),
      fringe: findHeaderIndex(headers, "fringe"),
      ot: findHeaderIndex(headers, "ot"),
      effective: findHeaderIndex(headers, "effective"),
      expiration: findHeaderIndex(headers, "expiration"),
      decision: findHeaderIndex(headers, "decision"),
      notes: findHeaderIndex(headers, "notes"),
    };

    if (idx.classification < 0) {
      return res.status(400).json({ error: "Required column 'Classification' not found", headersDetected: headers });
    }
    if (idx.wage < 0) {
      return res.status(400).json({ error: "Required column 'Wage Rate' not found", headersDetected: headers });
    }

    // Load classifications & existing rates for this project
    const orgClassifications = await db
      .select()
      .from(jobClassifications)
      .where(eq(jobClassifications.organizationId, organizationId));
    const classByName = new Map<string, typeof orgClassifications[number]>();
    const classByCode = new Map<string, typeof orgClassifications[number]>();
    for (const c of orgClassifications) {
      classByName.set(c.name.trim().toLowerCase(), c);
      if (c.code) classByCode.set(c.code.trim().toLowerCase(), c);
    }
    const existingRates = await db
      .select()
      .from(prevailingWageRates)
      .where(and(
        eq(prevailingWageRates.organizationId, organizationId),
        eq(prevailingWageRates.projectId, projectId)
      ));
    const existingByClass = new Map(existingRates.map(r => [r.classificationId, r]));

    const previewRows: ImportPreviewRow[] = [];
    for (let i = 1; i < grid.length; i++) {
      const row: CellValue[] = grid[i] || [];
      const isBlank = row.every(c => c === "" || c === null || c === undefined);
      if (isBlank) continue;

      const errors: string[] = [];
      const rawClass = String(cellAt(row, idx.classification) ?? "").trim();
      const lookupKey = rawClass.toLowerCase();
      const matched = classByName.get(lookupKey) || classByCode.get(lookupKey) || null;
      if (!rawClass) errors.push("Missing classification");
      else if (!matched && !createMissing) errors.push(`Unknown classification "${rawClass}"`);

      const wageNum = parseNumber(cellAt(row, idx.wage));
      if (isNaN(wageNum) || wageNum <= 0) errors.push("Invalid or missing wage rate");

      const healthNum = idx.health >= 0 ? parseNumber(cellAt(row, idx.health)) : 0;
      const pensionNum = idx.pension >= 0 ? parseNumber(cellAt(row, idx.pension)) : 0;
      const vacationNum = idx.vacation >= 0 ? parseNumber(cellAt(row, idx.vacation)) : 0;
      const trainingNum = idx.training >= 0 ? parseNumber(cellAt(row, idx.training)) : 0;
      const fringeChecks: Array<[string, number]> = [
        ["health", healthNum],
        ["pension", pensionNum],
        ["vacation", vacationNum],
        ["training", trainingNum],
      ];
      for (const [name, n] of fringeChecks) {
        if (isNaN(n) || n < 0) errors.push(`Invalid ${name} fringe`);
      }

      const breakdownSum = (isNaN(healthNum) ? 0 : healthNum) + (isNaN(pensionNum) ? 0 : pensionNum) + (isNaN(vacationNum) ? 0 : vacationNum) + (isNaN(trainingNum) ? 0 : trainingNum);
      const fringeRawCell = idx.fringe >= 0 ? cellAt(row, idx.fringe) : "";
      let fringeNum = idx.fringe >= 0 ? parseNumber(fringeRawCell) : NaN;
      if (idx.fringe < 0 || isNaN(fringeNum) || fringeRawCell === "" || fringeRawCell === null || fringeRawCell === undefined) {
        fringeNum = breakdownSum;
      } else if (fringeNum < 0) {
        errors.push("Invalid total fringe");
      }

      const otRaw = idx.ot >= 0 ? cellAt(row, idx.ot) : "";
      let otStr = "1.5";
      if (otRaw !== "" && otRaw !== null && otRaw !== undefined) {
        const otNum = parseNumber(otRaw);
        if (isNaN(otNum) || otNum <= 0) errors.push("Invalid overtime multiplier");
        else otStr = otNum.toFixed(2);
      }

      let effDate = idx.effective >= 0 ? parseDateCell(cellAt(row, idx.effective)) : null;
      if (!effDate) effDate = defaultEffectiveDate;
      if (!effDate) errors.push("Missing effective date");

      const expRawCell = idx.expiration >= 0 ? cellAt(row, idx.expiration) : "";
      const expDate = idx.expiration >= 0 ? parseDateCell(expRawCell) : null;
      if (idx.expiration >= 0 && expRawCell && !expDate) errors.push("Invalid expiration date");

      const decision = idx.decision >= 0 ? String(cellAt(row, idx.decision) ?? "").trim() : "";
      const notes = idx.notes >= 0 ? String(cellAt(row, idx.notes) ?? "").trim() : "";

      const wage = isNaN(wageNum) ? 0 : wageNum;
      const fringe = isNaN(fringeNum) ? 0 : fringeNum;
      const total = wage + fringe;

      const existing = matched ? existingByClass.get(matched.id) || null : null;
      const willCreateClassification = !matched && !!rawClass && createMissing;
      const action: ImportPreviewRow["action"] = errors.length > 0 ? "ERROR" : (existing ? "UPDATE" : "CREATE");

      previewRows.push({
        rowNumber: i + 1,
        rawClassification: rawClass,
        classificationId: matched?.id ?? null,
        classificationName: matched?.name ?? (willCreateClassification ? rawClass : null),
        wageRate: wage.toFixed(2),
        fringeHealthRate: (isNaN(healthNum) ? 0 : healthNum).toFixed(2),
        fringePensionRate: (isNaN(pensionNum) ? 0 : pensionNum).toFixed(2),
        fringeVacationRate: (isNaN(vacationNum) ? 0 : vacationNum).toFixed(2),
        fringeTrainingRate: (isNaN(trainingNum) ? 0 : trainingNum).toFixed(2),
        fringeRate: fringe.toFixed(2),
        totalRate: total.toFixed(2),
        overtimeMultiplier: otStr,
        effectiveDate: effDate || "",
        expirationDate: expDate,
        wageDecision: decision || null,
        notes: notes || null,
        action,
        existingId: existing?.id ?? null,
        errors,
        createClassification: willCreateClassification,
        newClassificationName: willCreateClassification ? rawClass : null,
      });
    }

    // Count distinct new classifications (case-insensitive) that would be created
    const newClassNames = new Set<string>();
    for (const r of previewRows) {
      if (r.action !== "ERROR" && r.createClassification && r.newClassificationName) {
        newClassNames.add(r.newClassificationName.trim().toLowerCase());
      }
    }

    const summary = {
      totalRows: previewRows.length,
      toCreate: previewRows.filter(r => r.action === "CREATE").length,
      toUpdate: previewRows.filter(r => r.action === "UPDATE").length,
      withErrors: previewRows.filter(r => r.action === "ERROR").length,
      classificationsToCreate: newClassNames.size,
    };

    res.json({
      projectId,
      projectName: project.name,
      headersDetected: headers,
      summary,
      rows: previewRows,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/prevailing-wage-rates/import", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user!.organizationId;
    if (!organizationId) return res.status(400).json({ error: "Organization required" });

    const payloadParsed = importPayloadSchema.safeParse(req.body);
    if (!payloadParsed.success) {
      return res.status(400).json({ error: "Invalid payload", details: payloadParsed.error.flatten() });
    }
    const { projectId, rows, createMissing, newClassificationDefaults } = payloadParsed.data;
    const classDefaults = newClassificationDefaults || {};
    const codePrefix = classDefaults.codePrefix?.toUpperCase() || "";
    const defaultDescription = classDefaults.description || "Auto-created during prevailing wage import";
    const defaultIsActive = classDefaults.isActive ?? true;
    const defaultSortOrder = classDefaults.sortOrder ?? 0;

    const [project] = await db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.gcOrganizationId, organizationId)));
    if (!project) return res.status(404).json({ error: "Project not found" });

    const orgClassifications = await db
      .select()
      .from(jobClassifications)
      .where(eq(jobClassifications.organizationId, organizationId));
    const validClassIds = new Set(orgClassifications.map(c => c.id));
    const classByNameLower = new Map<string, typeof orgClassifications[number]>();
    for (const c of orgClassifications) {
      classByNameLower.set(c.name.trim().toLowerCase(), c);
    }
    let classificationsCreated = 0;

    const existingRates = await db
      .select()
      .from(prevailingWageRates)
      .where(and(
        eq(prevailingWageRates.organizationId, organizationId),
        eq(prevailingWageRates.projectId, projectId)
      ));
    const existingByClass = new Map(existingRates.map(r => [r.classificationId, r]));

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors: { rowNumber?: number; message: string }[] = [];
    // Task #1331: collect every distinct wage decision actually persisted by
    // this import so we can queue a Davis-Bacon sync per decision after the
    // loop completes (deduped via a Set).
    const decisionsToSync = new Set<string>();

    // First pass: validate + de-duplicate by classificationId (last-row-wins).
    type ValidatedRow = z.infer<typeof importRowSchema>;
    const validatedByClass = new Map<string, { row: ValidatedRow; rowNumber: number }>();
    for (let idx = 0; idx < rows.length; idx++) {
      const rawRow = rows[idx];
      const rowNumberFallback = idx + 1;
      const parsed = importRowSchema.safeParse(rawRow);
      if (!parsed.success) {
        skipped++;
        const fallbackNum = (rawRow && typeof rawRow === "object" && "rowNumber" in rawRow && typeof (rawRow as { rowNumber: unknown }).rowNumber === "number")
          ? (rawRow as { rowNumber: number }).rowNumber
          : rowNumberFallback;
        errors.push({ rowNumber: fallbackNum, message: parsed.error.issues.map(i => i.message).join("; ") });
        continue;
      }
      const row = parsed.data;
      const rowNumber = row.rowNumber ?? rowNumberFallback;

      if (row.action === "ERROR") {
        skipped++;
        const reason = row.errors && row.errors.length > 0
          ? row.errors.join("; ")
          : "Row was flagged as ERROR during preview and cannot be imported";
        errors.push({ rowNumber, message: reason });
        continue;
      }

      const hasValidExisting = !!row.classificationId && validClassIds.has(row.classificationId);
      const wantsNew = !!createMissing && !!row.createClassification && !!row.newClassificationName && row.newClassificationName.trim().length > 0;
      if (!hasValidExisting && !wantsNew) {
        skipped++;
        if (!row.classificationId) {
          errors.push({ rowNumber, message: "Missing classification (enable 'Create missing classifications' to auto-create)" });
        } else {
          errors.push({ rowNumber, message: "Classification belongs to another organization" });
        }
        continue;
      }

      // Server-side semantic validation (mirrors preview).
      const wageNum = parseFloat(row.wageRate);
      if (!Number.isFinite(wageNum) || wageNum <= 0) {
        skipped++;
        errors.push({ rowNumber, message: "Wage rate must be a positive number" });
        continue;
      }
      const fringeParts = [row.fringeHealthRate, row.fringePensionRate, row.fringeVacationRate, row.fringeTrainingRate]
        .map(v => parseFloat(v ?? "0"));
      if (fringeParts.some(n => !Number.isFinite(n) || n < 0)) {
        skipped++;
        errors.push({ rowNumber, message: "Fringe components must be non-negative numbers" });
        continue;
      }
      const fringeTotalNum = row.fringeRate ? parseFloat(row.fringeRate) : NaN;
      if (row.fringeRate && (!Number.isFinite(fringeTotalNum) || fringeTotalNum < 0)) {
        skipped++;
        errors.push({ rowNumber, message: "Total fringe must be a non-negative number" });
        continue;
      }
      const otNum = parseFloat(row.overtimeMultiplier ?? "1.5");
      if (!Number.isFinite(otNum) || otNum <= 0) {
        skipped++;
        errors.push({ rowNumber, message: "Overtime multiplier must be a positive number" });
        continue;
      }

      const dedupKey = row.classificationId
        ? `id:${row.classificationId}`
        : `name:${(row.newClassificationName ?? "").trim().toLowerCase()}`;
      const previous = validatedByClass.get(dedupKey);
      if (previous) {
        skipped++;
        errors.push({ rowNumber: previous.rowNumber, message: `Superseded by later row for the same classification (row ${rowNumber})` });
      }
      validatedByClass.set(dedupKey, { row, rowNumber });
    }

    // Phase 1.5: Auto-create missing classifications.
    if (createMissing) {
      const newClassRows = Array.from(validatedByClass.values()).filter(
        ({ row }) => !row.classificationId && row.createClassification && row.newClassificationName
      );
      // Group by lowercase name; pick first row's wage info for defaults.
      const grouped = new Map<string, { name: string; row: typeof newClassRows[number]["row"]; rowNumber: number }>();
      for (const item of newClassRows) {
        const name = item.row.newClassificationName!.trim();
        const key = name.toLowerCase();
        if (!grouped.has(key)) grouped.set(key, { name, row: item.row, rowNumber: item.rowNumber });
      }
      for (const { name, row, rowNumber } of grouped.values()) {
        const key = name.toLowerCase();
        const existingClass = classByNameLower.get(key);
        if (existingClass) continue;
        try {
          const wage = parseFloat(row.wageRate);
          const ot = parseFloat(row.overtimeMultiplier ?? "1.5");
          const defaultRegularRate = Number.isFinite(wage) && wage > 0 ? wage.toFixed(2) : null;
          const defaultOvertimeRate = Number.isFinite(wage) && Number.isFinite(ot) && wage > 0 && ot > 0
            ? (wage * ot).toFixed(2)
            : null;
          const code = codePrefix
            ? `${codePrefix}-${slugForCode(name)}`.slice(0, 40)
            : null;
          const data = insertJobClassificationSchema.parse({
            organizationId,
            name,
            code,
            description: defaultDescription,
            defaultRegularRate,
            defaultOvertimeRate,
            isActive: defaultIsActive,
            sortOrder: defaultSortOrder,
          });
          const [c] = await db.insert(jobClassifications).values(data).returning();
          if (c) {
            classificationsCreated++;
            classByNameLower.set(key, c);
            validClassIds.add(c.id);
            await logAudit({
              userId: req.user!.id,
              entityType: "job_classification",
              entityId: c.id,
              action: "CREATE",
              newValue: JSON.stringify(c),
            }, req);
          }
        } catch (err: unknown) {
          // If unique constraint hit (race), refetch the existing one.
          const refetch = await db
            .select()
            .from(jobClassifications)
            .where(and(eq(jobClassifications.organizationId, organizationId), eq(jobClassifications.name, name)));
          if (refetch[0]) {
            classByNameLower.set(key, refetch[0]);
            validClassIds.add(refetch[0].id);
          } else {
            errors.push({ rowNumber, message: `Failed to create classification "${name}": ${err instanceof Error ? err.message : "unknown error"}` });
          }
        }
      }
    }

    for (const { row, rowNumber } of validatedByClass.values()) {
      try {
        const wageRate = row.wageRate;
        const fringeHealthRate = row.fringeHealthRate ?? "0";
        const fringePensionRate = row.fringePensionRate ?? "0";
        const fringeVacationRate = row.fringeVacationRate ?? "0";
        const fringeTrainingRate = row.fringeTrainingRate ?? "0";
        const breakdownSum =
          parseFloat(fringeHealthRate) + parseFloat(fringePensionRate) +
          parseFloat(fringeVacationRate) + parseFloat(fringeTrainingRate);
        const fringeRate = row.fringeRate && parseFloat(row.fringeRate) > 0
          ? row.fringeRate
          : breakdownSum.toFixed(2);
        const totalRate = (parseFloat(wageRate) + parseFloat(fringeRate)).toFixed(2);
        const overtimeMultiplier = row.overtimeMultiplier ?? "1.5";
        const effectiveDate = row.effectiveDate;

        // Resolve classificationId: either provided, or just-created by name.
        let classificationId = row.classificationId ?? null;
        if (!classificationId && row.newClassificationName) {
          const c = classByNameLower.get(row.newClassificationName.trim().toLowerCase());
          classificationId = c?.id ?? null;
        }
        if (!classificationId || !validClassIds.has(classificationId)) {
          skipped++;
          errors.push({ rowNumber, message: "Classification could not be resolved" });
          continue;
        }

        const existing = existingByClass.get(classificationId);
        if (existing) {
          const [u] = await db
            .update(prevailingWageRates)
            .set({
              wageRate,
              fringeRate,
              fringeHealthRate,
              fringePensionRate,
              fringeVacationRate,
              fringeTrainingRate,
              totalRate,
              overtimeMultiplier,
              effectiveDate,
              expirationDate: row.expirationDate || null,
              wageDecision: row.wageDecision || null,
              notes: row.notes || null,
              updatedAt: new Date(),
            })
            .where(and(
              eq(prevailingWageRates.id, existing.id),
              eq(prevailingWageRates.organizationId, organizationId)
            ))
            .returning();
          if (u) {
            updated++;
            await logAudit({
              userId: req.user!.id,
              entityType: "prevailing_wage_rate",
              entityId: u.id,
              action: "UPDATE",
              oldValue: JSON.stringify(existing),
              newValue: JSON.stringify(u),
            }, req);
            const dec = (u.wageDecision ?? "").trim();
            if (dec && dec !== (existing.wageDecision ?? "").trim()) {
              decisionsToSync.add(dec);
            }
          }
        } else {
          const data = insertPrevailingWageRateSchema.parse({
            organizationId,
            projectId,
            classificationId,
            wageRate,
            fringeRate,
            fringeHealthRate,
            fringePensionRate,
            fringeVacationRate,
            fringeTrainingRate,
            totalRate,
            overtimeMultiplier,
            effectiveDate,
            expirationDate: row.expirationDate || null,
            wageDecision: row.wageDecision || null,
            notes: row.notes || null,
          });
          const [c] = await db.insert(prevailingWageRates).values(data).returning();
          if (c) {
            created++;
            await logAudit({
              userId: req.user!.id,
              entityType: "prevailing_wage_rate",
              entityId: c.id,
              action: "CREATE",
              newValue: JSON.stringify(c),
            }, req);
            const dec = (c.wageDecision ?? "").trim();
            if (dec) decisionsToSync.add(dec);
          }
        }
      } catch (rowErr: unknown) {
        skipped++;
        const message = rowErr instanceof Error ? rowErr.message : "Failed to import row";
        errors.push({ rowNumber, message });
      }
    }

    // Task #1331: queue Davis-Bacon syncs for any wage decisions newly
    // referenced by the rows we just created or updated. queueWageDecisionSync
    // short-circuits on `cached`, so it's safe to fire for every distinct
    // decision; the helper will skip those already in the local cache.
    for (const decision of decisionsToSync) {
      triggerWageDecisionSync(organizationId, decision, {
        route: "POST /prevailing-wage-rates/import",
        projectId,
      });
    }

    res.json({ created, updated, skipped, errors, classificationsCreated });
  } catch (error) {
    next(error);
  }
});

router.patch("/prevailing-wage-rates/:id", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user!.organizationId;
    if (!organizationId) {
      return res.status(400).json({ error: "Organization required" });
    }

    const { id } = req.params;
    const { wageRate, fringeRate, fringeHealthRate, fringePensionRate, fringeVacationRate, fringeTrainingRate, overtimeMultiplier, effectiveDate, expirationDate, wageDecision, notes } = req.body;

    const [existing] = await db
      .select()
      .from(prevailingWageRates)
      .where(and(
        eq(prevailingWageRates.id, id),
        eq(prevailingWageRates.organizationId, organizationId)
      ));

    if (!existing) {
      return res.status(404).json({ error: "Prevailing wage rate not found" });
    }

    const newWageRate = wageRate !== undefined ? wageRate : existing.wageRate;
    const newHealth = fringeHealthRate !== undefined ? fringeHealthRate : existing.fringeHealthRate;
    const newPension = fringePensionRate !== undefined ? fringePensionRate : existing.fringePensionRate;
    const newVacation = fringeVacationRate !== undefined ? fringeVacationRate : existing.fringeVacationRate;
    const newTraining = fringeTrainingRate !== undefined ? fringeTrainingRate : existing.fringeTrainingRate;
    const breakdownSum =
      parseFloat(newHealth || "0") +
      parseFloat(newPension || "0") +
      parseFloat(newVacation || "0") +
      parseFloat(newTraining || "0");
    const breakdownChanged =
      fringeHealthRate !== undefined ||
      fringePensionRate !== undefined ||
      fringeVacationRate !== undefined ||
      fringeTrainingRate !== undefined;
    let newFringeRate = fringeRate !== undefined ? fringeRate : existing.fringeRate;
    if (fringeRate === undefined && breakdownChanged) {
      newFringeRate = breakdownSum.toFixed(2);
    }
    const totalRate = (parseFloat(newWageRate) + parseFloat(newFringeRate)).toFixed(2);

    const [updated] = await db
      .update(prevailingWageRates)
      .set({
        wageRate: newWageRate,
        fringeRate: newFringeRate,
        fringeHealthRate: newHealth,
        fringePensionRate: newPension,
        fringeVacationRate: newVacation,
        fringeTrainingRate: newTraining,
        totalRate,
        overtimeMultiplier: overtimeMultiplier !== undefined ? overtimeMultiplier : existing.overtimeMultiplier,
        effectiveDate: effectiveDate !== undefined ? effectiveDate : existing.effectiveDate,
        expirationDate: expirationDate !== undefined ? expirationDate : existing.expirationDate,
        wageDecision: wageDecision !== undefined ? wageDecision : existing.wageDecision,
        notes: notes !== undefined ? notes : existing.notes,
        updatedAt: new Date()
      })
      .where(eq(prevailingWageRates.id, id))
      .returning();

    await logAudit({
      userId: req.user!.id,
      entityType: "prevailing_wage_rate",
      entityId: id,
      action: "UPDATE",
      oldValue: typeof existing === 'string' ? existing : JSON.stringify(existing),
      newValue: typeof updated === 'string' ? updated : JSON.stringify(updated)
    }, req);

    if (
      updated.wageDecision &&
      (updated.wageDecision ?? "").trim() !== (existing.wageDecision ?? "").trim()
    ) {
      triggerWageDecisionSync(organizationId, updated.wageDecision, {
        route: "PATCH /prevailing-wage-rates/:id",
        rateId: updated.id,
      });
    }

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.delete("/prevailing-wage-rates/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user!.organizationId;
    if (!organizationId) {
      return res.status(400).json({ error: "Organization required" });
    }

    const { id } = req.params;

    const [existing] = await db
      .select()
      .from(prevailingWageRates)
      .where(and(
        eq(prevailingWageRates.id, id),
        eq(prevailingWageRates.organizationId, organizationId)
      ));

    if (!existing) {
      return res.status(404).json({ error: "Prevailing wage rate not found" });
    }

    await db
      .delete(prevailingWageRates)
      .where(eq(prevailingWageRates.id, id));

    await logAudit({
      userId: req.user!.id,
      entityType: "prevailing_wage_rate",
      entityId: id,
      action: "DELETE",
      oldValue: typeof existing === 'string' ? existing : JSON.stringify(existing)
    }, req);

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ==================== ANNUAL SALARY CATEGORIES ====================

function computeBurdenedCost(baseSalary: number, burdenPercentage: number, fixedBurdenAmount: number): number {
  return baseSalary + (baseSalary * burdenPercentage / 100) + fixedBurdenAmount;
}

router.get("/salary-categories", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user!.organizationId;
    if (!organizationId) return res.status(400).json({ error: "Organization required" });

    const categories = await db
      .select()
      .from(annualSalaryCategories)
      .where(eq(annualSalaryCategories.organizationId, organizationId))
      .orderBy(asc(annualSalaryCategories.name));

    res.json(categories);
  } catch (error) {
    next(error);
  }
});

router.post("/salary-categories", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user!.organizationId;
    if (!organizationId) return res.status(400).json({ error: "Organization required" });

    const data = insertAnnualSalaryCategorySchema.parse({
      ...req.body,
      organizationId
    });

    const [category] = await db
      .insert(annualSalaryCategories)
      .values(data)
      .returning();

    await logAudit({
      userId: req.user!.id,
      entityType: "annual_salary_category",
      entityId: category.id,
      action: "CREATE",
      newValue: JSON.stringify(data)
    }, req);

    res.status(201).json(category);
  } catch (error: any) {
    logError("Error creating salary category:", {}, error instanceof Error ? error : new Error(String(error)));
    if (error?.code === "23505") return res.status(409).json({ error: "A salary category with this name already exists" });
    next(error);
  }
});

router.patch("/salary-categories/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user!.organizationId;
    if (!organizationId) return res.status(400).json({ error: "Organization required" });

    const { id } = req.params;
    const updates = { ...req.body, updatedAt: new Date() };

    const [updated] = await db
      .update(annualSalaryCategories)
      .set(updates)
      .where(and(eq(annualSalaryCategories.id, id), eq(annualSalaryCategories.organizationId, organizationId)))
      .returning();

    if (!updated) return res.status(404).json({ error: "Salary category not found" });

    await logAudit({
      userId: req.user!.id,
      entityType: "annual_salary_category",
      entityId: id,
      action: "UPDATE",
      newValue: JSON.stringify(updates)
    }, req);

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.delete("/salary-categories/:id", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user!.organizationId;
    if (!organizationId) return res.status(400).json({ error: "Organization required" });

    const { id } = req.params;
    const [deleted] = await db
      .delete(annualSalaryCategories)
      .where(and(eq(annualSalaryCategories.id, id), eq(annualSalaryCategories.organizationId, organizationId)))
      .returning();

    if (!deleted) return res.status(404).json({ error: "Salary category not found" });

    await logAudit({
      userId: req.user!.id,
      entityType: "annual_salary_category",
      entityId: id,
      action: "DELETE"
    }, req);

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ==================== BURDEN RATES ====================

router.get("/burden-rates", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user!.organizationId;
    if (!organizationId) return res.status(400).json({ error: "Organization required" });

    const rates = await db
      .select()
      .from(burdenRates)
      .where(eq(burdenRates.organizationId, organizationId))
      .orderBy(asc(burdenRates.name));

    res.json(rates);
  } catch (error) {
    next(error);
  }
});

router.post("/burden-rates", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user!.organizationId;
    if (!organizationId) return res.status(400).json({ error: "Organization required" });

    const body = { ...req.body, organizationId };
    const totalPercent = (parseFloat(body.taxesPercent || "0") + parseFloat(body.benefitsPercent || "0") + parseFloat(body.insurancePercent || "0") + parseFloat(body.overheadPercent || "0"));
    if (!body.burdenPercentage && totalPercent > 0) {
      body.burdenPercentage = String(totalPercent);
    }

    const data = insertBurdenRateSchema.parse(body);

    const [rate] = await db
      .insert(burdenRates)
      .values(data)
      .returning();

    await logAudit({
      userId: req.user!.id,
      entityType: "burden_rate",
      entityId: rate.id,
      action: "CREATE",
      newValue: JSON.stringify(data)
    }, req);

    res.status(201).json(rate);
  } catch (error: any) {
    logError("Error creating burden rate:", {}, error instanceof Error ? error : new Error(String(error)));
    if (error?.code === "23505") return res.status(409).json({ error: "A burden rate with this name already exists" });
    next(error);
  }
});

router.patch("/burden-rates/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user!.organizationId;
    if (!organizationId) return res.status(400).json({ error: "Organization required" });

    const { id } = req.params;
    const updates = { ...req.body, updatedAt: new Date() };
    const totalPercent = (parseFloat(updates.taxesPercent || "0") + parseFloat(updates.benefitsPercent || "0") + parseFloat(updates.insurancePercent || "0") + parseFloat(updates.overheadPercent || "0"));
    if (totalPercent > 0 && !updates.burdenPercentage) {
      updates.burdenPercentage = String(totalPercent);
    }

    const [updated] = await db
      .update(burdenRates)
      .set(updates)
      .where(and(eq(burdenRates.id, id), eq(burdenRates.organizationId, organizationId)))
      .returning();

    if (!updated) return res.status(404).json({ error: "Burden rate not found" });

    await logAudit({
      userId: req.user!.id,
      entityType: "burden_rate",
      entityId: id,
      action: "UPDATE",
      newValue: JSON.stringify(updates)
    }, req);

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.delete("/burden-rates/:id", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user!.organizationId;
    if (!organizationId) return res.status(400).json({ error: "Organization required" });

    const { id } = req.params;
    const [deleted] = await db
      .delete(burdenRates)
      .where(and(eq(burdenRates.id, id), eq(burdenRates.organizationId, organizationId)))
      .returning();

    if (!deleted) return res.status(404).json({ error: "Burden rate not found" });

    await logAudit({
      userId: req.user!.id,
      entityType: "burden_rate",
      entityId: id,
      action: "DELETE"
    }, req);

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ==================== EMPLOYEE COST ASSIGNMENTS ====================

router.get("/cost-assignments", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user!.organizationId;
    if (!organizationId) return res.status(400).json({ error: "Organization required" });

    const assignments = await db
      .select({
        id: employeeCostAssignments.id,
        organizationId: employeeCostAssignments.organizationId,
        userId: employeeCostAssignments.userId,
        salaryCategoryId: employeeCostAssignments.salaryCategoryId,
        burdenRateId: employeeCostAssignments.burdenRateId,
        workingHoursPerYear: employeeCostAssignments.workingHoursPerYear,
        fullyBurdenedCost: employeeCostAssignments.fullyBurdenedCost,
        derivedHourlyRate: employeeCostAssignments.derivedHourlyRate,
        effectiveDate: employeeCostAssignments.effectiveDate,
        endDate: employeeCostAssignments.endDate,
        notes: employeeCostAssignments.notes,
        createdAt: employeeCostAssignments.createdAt,
        updatedAt: employeeCostAssignments.updatedAt,
        userName: users.firstName,
        userLastName: users.lastName,
        userEmail: users.email,
        salaryName: annualSalaryCategories.name,
        baseAnnualSalary: annualSalaryCategories.baseAnnualSalary,
        burdenName: burdenRates.name,
        burdenPercentage: burdenRates.burdenPercentage,
        fixedBurdenAmount: burdenRates.fixedBurdenAmount,
      })
      .from(employeeCostAssignments)
      .leftJoin(users, eq(employeeCostAssignments.userId, users.id))
      .leftJoin(annualSalaryCategories, eq(employeeCostAssignments.salaryCategoryId, annualSalaryCategories.id))
      .leftJoin(burdenRates, eq(employeeCostAssignments.burdenRateId, burdenRates.id))
      .where(eq(employeeCostAssignments.organizationId, organizationId))
      .orderBy(asc(users.lastName), asc(users.firstName));

    res.json(assignments);
  } catch (error) {
    next(error);
  }
});

router.post("/cost-assignments", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user!.organizationId;
    if (!organizationId) return res.status(400).json({ error: "Organization required" });

    const data = insertEmployeeCostAssignmentSchema.parse({
      ...req.body,
      organizationId
    });

    const [salaryCategory] = await db
      .select()
      .from(annualSalaryCategories)
      .where(and(eq(annualSalaryCategories.id, data.salaryCategoryId), eq(annualSalaryCategories.organizationId, organizationId)));

    if (!salaryCategory) return res.status(404).json({ error: "Salary category not found" });

    let burdenPercentage = 0;
    let fixedBurdenAmount = 0;
    if (data.burdenRateId) {
      const [burden] = await db
        .select()
        .from(burdenRates)
        .where(and(eq(burdenRates.id, data.burdenRateId), eq(burdenRates.organizationId, organizationId)));
      if (burden) {
        burdenPercentage = parseFloat(burden.burdenPercentage || "0");
        fixedBurdenAmount = parseFloat(burden.fixedBurdenAmount || "0");
      }
    }

    const baseSalary = parseFloat(salaryCategory.baseAnnualSalary);
    const fullyBurdenedCost = computeBurdenedCost(baseSalary, burdenPercentage, fixedBurdenAmount);
    const workingHours = data.workingHoursPerYear || 2080;
    const derivedHourlyRate = fullyBurdenedCost / workingHours;

    const [assignment] = await db
      .insert(employeeCostAssignments)
      .values({
        ...data,
        fullyBurdenedCost: fullyBurdenedCost.toFixed(2),
        derivedHourlyRate: derivedHourlyRate.toFixed(4),
      })
      .returning();

    await logAudit({
      userId: req.user!.id,
      entityType: "employee_cost_assignment",
      entityId: assignment.id,
      action: "CREATE",
      newValue: JSON.stringify(data)
    }, req);

    res.status(201).json(assignment);
  } catch (error: any) {
    logError("Error creating cost assignment:", {}, error instanceof Error ? error : new Error(String(error)));
    if (error?.code === "23505") return res.status(409).json({ error: "This employee already has an assignment for this salary category" });
    next(error);
  }
});

router.patch("/cost-assignments/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user!.organizationId;
    if (!organizationId) return res.status(400).json({ error: "Organization required" });

    const { id } = req.params;
    const updates = { ...req.body, updatedAt: new Date() };

    const [existing] = await db
      .select()
      .from(employeeCostAssignments)
      .where(and(eq(employeeCostAssignments.id, id), eq(employeeCostAssignments.organizationId, organizationId)));

    if (!existing) return res.status(404).json({ error: "Cost assignment not found" });

    const salaryCatId = updates.salaryCategoryId || existing.salaryCategoryId;
    const burdenRateIdVal = updates.burdenRateId !== undefined ? updates.burdenRateId : existing.burdenRateId;
    const workingHours = updates.workingHoursPerYear || existing.workingHoursPerYear || 2080;

    const [salaryCategory] = await db
      .select()
      .from(annualSalaryCategories)
      .where(eq(annualSalaryCategories.id, salaryCatId));

    if (salaryCategory) {
      let burdenPercentage = 0;
      let fixedBurdenAmount = 0;
      if (burdenRateIdVal) {
        const [burden] = await db
          .select()
          .from(burdenRates)
          .where(eq(burdenRates.id, burdenRateIdVal));
        if (burden) {
          burdenPercentage = parseFloat(burden.burdenPercentage || "0");
          fixedBurdenAmount = parseFloat(burden.fixedBurdenAmount || "0");
        }
      }
      const baseSalary = parseFloat(salaryCategory.baseAnnualSalary);
      const fullyBurdenedCost = computeBurdenedCost(baseSalary, burdenPercentage, fixedBurdenAmount);
      const derivedHourlyRate = fullyBurdenedCost / workingHours;
      updates.fullyBurdenedCost = fullyBurdenedCost.toFixed(2);
      updates.derivedHourlyRate = derivedHourlyRate.toFixed(4);
    }

    const [updated] = await db
      .update(employeeCostAssignments)
      .set(updates)
      .where(and(eq(employeeCostAssignments.id, id), eq(employeeCostAssignments.organizationId, organizationId)))
      .returning();

    await logAudit({
      userId: req.user!.id,
      entityType: "employee_cost_assignment",
      entityId: id,
      action: "UPDATE",
      newValue: JSON.stringify(updates)
    }, req);

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.delete("/cost-assignments/:id", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user!.organizationId;
    if (!organizationId) return res.status(400).json({ error: "Organization required" });

    const { id } = req.params;
    const [deleted] = await db
      .delete(employeeCostAssignments)
      .where(and(eq(employeeCostAssignments.id, id), eq(employeeCostAssignments.organizationId, organizationId)))
      .returning();

    if (!deleted) return res.status(404).json({ error: "Cost assignment not found" });

    await logAudit({
      userId: req.user!.id,
      entityType: "employee_cost_assignment",
      entityId: id,
      action: "DELETE"
    }, req);

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.post("/cost-assignments/recalculate", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user!.organizationId;
    if (!organizationId) return res.status(400).json({ error: "Organization required" });

    const allAssignments = await db
      .select()
      .from(employeeCostAssignments)
      .where(eq(employeeCostAssignments.organizationId, organizationId));

    let updated = 0;
    for (const assignment of allAssignments) {
      const [salaryCategory] = await db
        .select()
        .from(annualSalaryCategories)
        .where(eq(annualSalaryCategories.id, assignment.salaryCategoryId));

      if (!salaryCategory) continue;

      let burdenPercentage = 0;
      let fixedBurdenAmount = 0;
      if (assignment.burdenRateId) {
        const [burden] = await db
          .select()
          .from(burdenRates)
          .where(eq(burdenRates.id, assignment.burdenRateId));
        if (burden) {
          burdenPercentage = parseFloat(burden.burdenPercentage || "0");
          fixedBurdenAmount = parseFloat(burden.fixedBurdenAmount || "0");
        }
      }

      const baseSalary = parseFloat(salaryCategory.baseAnnualSalary);
      const fullyBurdenedCost = computeBurdenedCost(baseSalary, burdenPercentage, fixedBurdenAmount);
      const workingHours = assignment.workingHoursPerYear || 2080;
      const derivedHourlyRate = fullyBurdenedCost / workingHours;

      await db
        .update(employeeCostAssignments)
        .set({
          fullyBurdenedCost: fullyBurdenedCost.toFixed(2),
          derivedHourlyRate: derivedHourlyRate.toFixed(4),
          updatedAt: new Date(),
        })
        .where(eq(employeeCostAssignments.id, assignment.id));

      updated++;
    }

    res.json({ success: true, updated });
  } catch (error) {
    next(error);
  }
});

export default router;