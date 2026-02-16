import { Router, Response } from "express";
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

const router = Router();

// ==================== JOB CLASSIFICATIONS ====================

router.get("/classifications", requireAuth, requireRole("ADMIN", "MANAGER", "OFFICE_MANAGER", "ESTIMATOR"), async (req: AuthRequest, res: Response) => {
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
    console.error("Error fetching job classifications:", error);
    res.status(500).json({ error: "Failed to fetch job classifications" });
  }
});

router.post("/classifications", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res: Response) => {
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
    console.error("Error creating job classification:", error);
    res.status(500).json({ error: "Failed to create job classification" });
  }
});

router.patch("/classifications/:id", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res: Response) => {
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
    console.error("Error updating job classification:", error);
    res.status(500).json({ error: "Failed to update job classification" });
  }
});

router.delete("/classifications/:id", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
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
    console.error("Error deleting job classification:", error);
    res.status(500).json({ error: "Failed to delete job classification" });
  }
});

// ==================== EMPLOYEE CLASSIFICATIONS ====================

router.get("/employee-classifications", requireAuth, requireRole("ADMIN", "MANAGER", "OFFICE_MANAGER", "ESTIMATOR"), async (req: AuthRequest, res: Response) => {
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
    console.error("Error fetching employee classifications:", error);
    res.status(500).json({ error: "Failed to fetch employee classifications" });
  }
});

router.get("/employee-classifications/my-rates", requireAuth, async (req: AuthRequest, res: Response) => {
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
    console.error("Error fetching my rates:", error);
    res.status(500).json({ error: "Failed to fetch your rates" });
  }
});

router.post("/employee-classifications", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res: Response) => {
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
    console.error("Error creating employee classification:", error);
    res.status(500).json({ error: "Failed to create employee classification" });
  }
});

router.patch("/employee-classifications/:id", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res: Response) => {
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
    console.error("Error updating employee classification:", error);
    res.status(500).json({ error: "Failed to update employee classification" });
  }
});

router.delete("/employee-classifications/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
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
    console.error("Error deleting employee classification:", error);
    res.status(500).json({ error: "Failed to delete employee classification" });
  }
});

// ==================== PREVAILING WAGE RATES ====================

router.get("/prevailing-wage-rates", requireAuth, requireRole("ADMIN", "MANAGER", "OFFICE_MANAGER", "ESTIMATOR"), async (req: AuthRequest, res: Response) => {
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
    console.error("Error fetching prevailing wage rates:", error);
    res.status(500).json({ error: "Failed to fetch prevailing wage rates" });
  }
});

router.post("/prevailing-wage-rates", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    if (!organizationId) {
      return res.status(400).json({ error: "Organization required" });
    }

    const { wageRate, fringeRate, ...rest } = req.body;
    const totalRate = (parseFloat(wageRate) + parseFloat(fringeRate || 0)).toFixed(2);

    const data = insertPrevailingWageRateSchema.parse({
      ...rest,
      wageRate,
      fringeRate: fringeRate || "0",
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

    res.status(201).json(rate);
  } catch (error) {
    console.error("Error creating prevailing wage rate:", error);
    res.status(500).json({ error: "Failed to create prevailing wage rate" });
  }
});

router.patch("/prevailing-wage-rates/:id", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    if (!organizationId) {
      return res.status(400).json({ error: "Organization required" });
    }

    const { id } = req.params;
    const { wageRate, fringeRate, overtimeMultiplier, effectiveDate, expirationDate, wageDecision, notes } = req.body;

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
    const newFringeRate = fringeRate !== undefined ? fringeRate : existing.fringeRate;
    const totalRate = (parseFloat(newWageRate) + parseFloat(newFringeRate)).toFixed(2);

    const [updated] = await db
      .update(prevailingWageRates)
      .set({
        wageRate: newWageRate,
        fringeRate: newFringeRate,
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

    res.json(updated);
  } catch (error) {
    console.error("Error updating prevailing wage rate:", error);
    res.status(500).json({ error: "Failed to update prevailing wage rate" });
  }
});

router.delete("/prevailing-wage-rates/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
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
    console.error("Error deleting prevailing wage rate:", error);
    res.status(500).json({ error: "Failed to delete prevailing wage rate" });
  }
});

// ==================== ANNUAL SALARY CATEGORIES ====================

function computeBurdenedCost(baseSalary: number, burdenPercentage: number, fixedBurdenAmount: number): number {
  return baseSalary + (baseSalary * burdenPercentage / 100) + fixedBurdenAmount;
}

router.get("/salary-categories", requireAuth, requireRole("ADMIN", "MANAGER", "OFFICE_MANAGER", "ESTIMATOR"), async (req: AuthRequest, res: Response) => {
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
    console.error("Error fetching salary categories:", error);
    res.status(500).json({ error: "Failed to fetch salary categories" });
  }
});

router.post("/salary-categories", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
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
    console.error("Error creating salary category:", error);
    if (error?.code === "23505") return res.status(409).json({ error: "A salary category with this name already exists" });
    res.status(500).json({ error: "Failed to create salary category" });
  }
});

router.patch("/salary-categories/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
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
    console.error("Error updating salary category:", error);
    res.status(500).json({ error: "Failed to update salary category" });
  }
});

router.delete("/salary-categories/:id", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
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
    console.error("Error deleting salary category:", error);
    res.status(500).json({ error: "Failed to delete salary category" });
  }
});

// ==================== BURDEN RATES ====================

router.get("/burden-rates", requireAuth, requireRole("ADMIN", "MANAGER", "OFFICE_MANAGER", "ESTIMATOR"), async (req: AuthRequest, res: Response) => {
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
    console.error("Error fetching burden rates:", error);
    res.status(500).json({ error: "Failed to fetch burden rates" });
  }
});

router.post("/burden-rates", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
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
    console.error("Error creating burden rate:", error);
    if (error?.code === "23505") return res.status(409).json({ error: "A burden rate with this name already exists" });
    res.status(500).json({ error: "Failed to create burden rate" });
  }
});

router.patch("/burden-rates/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
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
    console.error("Error updating burden rate:", error);
    res.status(500).json({ error: "Failed to update burden rate" });
  }
});

router.delete("/burden-rates/:id", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
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
    console.error("Error deleting burden rate:", error);
    res.status(500).json({ error: "Failed to delete burden rate" });
  }
});

// ==================== EMPLOYEE COST ASSIGNMENTS ====================

router.get("/cost-assignments", requireAuth, requireRole("ADMIN", "MANAGER", "OFFICE_MANAGER", "ESTIMATOR"), async (req: AuthRequest, res: Response) => {
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
    console.error("Error fetching cost assignments:", error);
    res.status(500).json({ error: "Failed to fetch cost assignments" });
  }
});

router.post("/cost-assignments", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
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
    console.error("Error creating cost assignment:", error);
    if (error?.code === "23505") return res.status(409).json({ error: "This employee already has an assignment for this salary category" });
    res.status(500).json({ error: "Failed to create cost assignment" });
  }
});

router.patch("/cost-assignments/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
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
    console.error("Error updating cost assignment:", error);
    res.status(500).json({ error: "Failed to update cost assignment" });
  }
});

router.delete("/cost-assignments/:id", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
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
    console.error("Error deleting cost assignment:", error);
    res.status(500).json({ error: "Failed to delete cost assignment" });
  }
});

router.post("/cost-assignments/recalculate", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
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
    console.error("Error recalculating cost assignments:", error);
    res.status(500).json({ error: "Failed to recalculate cost assignments" });
  }
});

export default router;
