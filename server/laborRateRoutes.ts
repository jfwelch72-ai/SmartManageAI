import { Router, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { 
  jobClassifications, 
  employeeClassifications, 
  prevailingWageRates,
  projectEmployeeRates,
  users,
  projects,
  insertJobClassificationSchema,
  insertEmployeeClassificationSchema,
  insertPrevailingWageRateSchema
} from "@shared/schema";
import { eq, and, desc, asc } from "drizzle-orm";
import { logAudit } from "./auditLogger";

const router = Router();

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }
  next();
}

function requireRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
}

// ==================== JOB CLASSIFICATIONS ====================

router.get("/classifications", requireAuth, requireRole("ADMIN", "MANAGER", "OFFICE_MANAGER"), async (req: Request, res: Response) => {
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

router.post("/classifications", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: Request, res: Response) => {
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
      newValue: classification
    }, req);

    res.status(201).json(classification);
  } catch (error) {
    console.error("Error creating job classification:", error);
    res.status(500).json({ error: "Failed to create job classification" });
  }
});

router.patch("/classifications/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: Request, res: Response) => {
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
      oldValue: existing,
      newValue: updated
    }, req);

    res.json(updated);
  } catch (error) {
    console.error("Error updating job classification:", error);
    res.status(500).json({ error: "Failed to update job classification" });
  }
});

router.delete("/classifications/:id", requireAuth, requireRole("ADMIN"), async (req: Request, res: Response) => {
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
      oldValue: existing
    }, req);

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting job classification:", error);
    res.status(500).json({ error: "Failed to delete job classification" });
  }
});

// ==================== EMPLOYEE CLASSIFICATIONS ====================

router.get("/employee-classifications", requireAuth, requireRole("ADMIN", "MANAGER", "OFFICE_MANAGER"), async (req: Request, res: Response) => {
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

router.get("/employee-classifications/my-rates", requireAuth, async (req: Request, res: Response) => {
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

router.post("/employee-classifications", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: Request, res: Response) => {
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
      newValue: assignment
    }, req);

    res.status(201).json(assignment);
  } catch (error) {
    console.error("Error creating employee classification:", error);
    res.status(500).json({ error: "Failed to create employee classification" });
  }
});

router.patch("/employee-classifications/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: Request, res: Response) => {
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
      oldValue: existing,
      newValue: updated
    }, req);

    res.json(updated);
  } catch (error) {
    console.error("Error updating employee classification:", error);
    res.status(500).json({ error: "Failed to update employee classification" });
  }
});

router.delete("/employee-classifications/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: Request, res: Response) => {
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
      oldValue: existing
    }, req);

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting employee classification:", error);
    res.status(500).json({ error: "Failed to delete employee classification" });
  }
});

// ==================== PREVAILING WAGE RATES ====================

router.get("/prevailing-wage-rates", requireAuth, requireRole("ADMIN", "MANAGER", "OFFICE_MANAGER"), async (req: Request, res: Response) => {
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

router.post("/prevailing-wage-rates", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: Request, res: Response) => {
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
      newValue: rate
    }, req);

    res.status(201).json(rate);
  } catch (error) {
    console.error("Error creating prevailing wage rate:", error);
    res.status(500).json({ error: "Failed to create prevailing wage rate" });
  }
});

router.patch("/prevailing-wage-rates/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: Request, res: Response) => {
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
      oldValue: existing,
      newValue: updated
    }, req);

    res.json(updated);
  } catch (error) {
    console.error("Error updating prevailing wage rate:", error);
    res.status(500).json({ error: "Failed to update prevailing wage rate" });
  }
});

router.delete("/prevailing-wage-rates/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: Request, res: Response) => {
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
      oldValue: existing
    }, req);

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting prevailing wage rate:", error);
    res.status(500).json({ error: "Failed to delete prevailing wage rate" });
  }
});

export default router;
