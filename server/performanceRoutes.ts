import type { Express, Response } from "express";
import { requireAuth, type AuthRequest } from "./auth";
import { db } from "./db";
import { eq, and, desc, sql, avg, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  ratingCriteria, employeeRatings, ratingScores, rewardTypes, rewardAssignments, users, projects, organizations,
  kpiTemplates, kpiAssignments, kpiEntries,
  type InsertRatingCriteria, type InsertEmployeeRating, type InsertRatingScore, type InsertRewardType, type InsertRewardAssignment,
} from "@shared/schema";

const createCriteriaSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  weight: z.union([z.string(), z.number()]).transform(v => String(v)).optional(),
  maxScore: z.coerce.number().min(1).max(100).optional(),
  sortOrder: z.coerce.number().optional(),
});

const createRatingSchema = z.object({
  employeeId: z.string().min(1, "Employee ID is required"),
  projectId: z.string().optional(),
  period: z.string().optional(),
  comments: z.string().optional(),
  scores: z.array(z.object({
    criteriaId: z.string().min(1),
    score: z.coerce.number().min(0),
    comment: z.string().optional(),
  })).min(1, "At least one score is required"),
});

const REWARD_CATEGORIES = ["BONUS", "INCENTIVE", "RECOGNITION", "POINTS", "CUSTOM"] as const;
const createRewardTypeSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  category: z.enum(REWARD_CATEGORIES).default("CUSTOM"),
  value: z.union([z.string(), z.number()]).transform(v => String(v)).optional(),
});

const assignRewardSchema = z.object({
  employeeId: z.string().min(1, "Employee ID is required"),
  rewardTypeId: z.string().min(1, "Reward type is required"),
  ratingId: z.string().optional(),
  amount: z.union([z.string(), z.number()]).transform(v => String(v)).optional(),
  justification: z.string().optional(),
});

const PRESET_REWARD_TYPES: { name: string; description: string; category: "BONUS" | "INCENTIVE" | "RECOGNITION" | "POINTS" | "CUSTOM"; value: string }[] = [
  { name: "Employee of the Month", description: "Outstanding overall performance and dedication during the month", category: "RECOGNITION", value: "250.00" },
  { name: "Safety Excellence Award", description: "Exemplary adherence to safety protocols and zero incidents", category: "INCENTIVE", value: "500.00" },
  { name: "Project Completion Bonus", description: "Successfully delivering a project on time and within budget", category: "BONUS", value: "1000.00" },
  { name: "Perfect Attendance", description: "No unexcused absences during the evaluation period", category: "RECOGNITION", value: "150.00" },
  { name: "Leadership Award", description: "Demonstrating exceptional leadership and mentoring of team members", category: "RECOGNITION", value: "300.00" },
  { name: "Innovation Bonus", description: "Introducing a process improvement or cost-saving solution", category: "BONUS", value: "750.00" },
  { name: "Team Player Award", description: "Consistently supporting teammates and fostering collaboration", category: "RECOGNITION", value: "200.00" },
  { name: "Quality Workmanship", description: "Delivering superior craftsmanship with minimal rework or defects", category: "RECOGNITION", value: "300.00" },
];

async function seedPresetRewardTypes(orgId: string) {
  const existing = await db.select({ id: rewardTypes.id }).from(rewardTypes)
    .where(eq(rewardTypes.organizationId, orgId)).limit(1);
  if (existing.length > 0) return;

  const values = PRESET_REWARD_TYPES.map((preset) => ({
    organizationId: orgId,
    name: preset.name,
    description: preset.description,
    category: preset.category,
    value: preset.value,
    isActive: true,
  }));

  await db.insert(rewardTypes).values(values);
}

const ROLE_HIERARCHY: Record<string, string[]> = {
  "ADMIN": ["MANAGER", "SUPERINTENDENT", "ESTIMATOR", "OFFICE_MANAGER", "HOURLY_EMPLOYEE", "MAINTENANCE_MANAGER"],
  "MANAGER": ["SUPERINTENDENT", "ESTIMATOR", "OFFICE_MANAGER", "HOURLY_EMPLOYEE", "MAINTENANCE_MANAGER"],
  "SUPERINTENDENT": ["HOURLY_EMPLOYEE"],
};

export function registerPerformanceRoutes(app: Express) {
  const requireAdmin = (req: AuthRequest, res: Response): boolean => {
    if (req.user?.role !== "ADMIN") {
      res.status(403).json({ error: "Admin access required" });
      return false;
    }
    return true;
  };

  const getOrgId = (req: AuthRequest, res: Response): string | null => {
    const orgId = req.user?.organizationId;
    if (!orgId) {
      res.status(400).json({ error: "Organization required" });
      return null;
    }
    return orgId;
  };

  app.get("/api/performance/criteria", requireAuth, async (req: AuthRequest, res) => {
    try {
      const orgId = getOrgId(req, res);
      if (!orgId) return;

      const results = await db
        .select()
        .from(ratingCriteria)
        .where(and(eq(ratingCriteria.organizationId, orgId), eq(ratingCriteria.isActive, true)))
        .orderBy(ratingCriteria.sortOrder);

      res.json(results);
    } catch (error) {
      console.error("Error fetching criteria:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/performance/kpi-criteria", requireAuth, async (req: AuthRequest, res) => {
    try {
      const orgId = getOrgId(req, res);
      if (!orgId) return;

      const employeeId = req.query.employeeId as string | undefined;

      const templates = await db
        .select()
        .from(kpiTemplates)
        .where(and(eq(kpiTemplates.organizationId, orgId), eq(kpiTemplates.isActive, true)));

      let assignedKpis: any[] = [];
      if (employeeId) {
        assignedKpis = await db
          .select({
            id: kpiAssignments.id,
            kpiTemplateId: kpiAssignments.kpiTemplateId,
            targetValue: kpiAssignments.targetValue,
            periodType: kpiAssignments.periodType,
          })
          .from(kpiAssignments)
          .where(and(
            eq(kpiAssignments.organizationId, orgId),
            eq(kpiAssignments.userId, employeeId),
            eq(kpiAssignments.isActive, true)
          ));
      }

      const assignmentMap = new Map(assignedKpis.map((a: any) => [a.kpiTemplateId, a]));

      const kpiCriteria = templates.map((t, idx) => {
        const assignment = assignmentMap.get(t.id);
        return {
          id: `kpi_${t.id}`,
          kpiTemplateId: t.id,
          name: t.name,
          description: t.description,
          category: t.category,
          unit: t.unit,
          direction: t.direction,
          weight: "1.0",
          maxScore: 10,
          isActive: true,
          sortOrder: idx,
          targetValue: assignment ? parseFloat(assignment.targetValue) : null,
          periodType: assignment?.periodType || null,
          assignmentId: assignment?.id || null,
          isKpiBased: true,
        };
      });

      res.json(kpiCriteria);
    } catch (error) {
      console.error("Error fetching KPI criteria:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/performance/criteria", requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!requireAdmin(req, res)) return;
      const orgId = getOrgId(req, res);
      if (!orgId) return;

      const parsed = createCriteriaSchema.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0].message }); return; }
      const { name, description, weight, maxScore, sortOrder } = parsed.data;

      const [created] = await db.insert(ratingCriteria).values({
        organizationId: orgId,
        name,
        description: description || null,
        weight: weight || "1.0",
        maxScore: maxScore || 10,
        sortOrder: sortOrder || 0,
        isActive: true,
      }).returning();

      res.status(201).json(created);
    } catch (error) {
      console.error("Error creating criteria:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.patch("/api/performance/criteria/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!requireAdmin(req, res)) return;
      const orgId = getOrgId(req, res);
      if (!orgId) return;

      const { id } = req.params;
      const { name, description, weight, maxScore, isActive, sortOrder } = req.body;

      const [existing] = await db.select().from(ratingCriteria)
        .where(and(eq(ratingCriteria.id, id), eq(ratingCriteria.organizationId, orgId)))
        .limit(1);

      if (!existing) { res.status(404).json({ error: "Criteria not found" }); return; }

      const updateData: Record<string, unknown> = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (weight !== undefined) updateData.weight = weight;
      if (maxScore !== undefined) updateData.maxScore = maxScore;
      if (isActive !== undefined) updateData.isActive = isActive;
      if (sortOrder !== undefined) updateData.sortOrder = sortOrder;

      const [updated] = await db.update(ratingCriteria).set(updateData)
        .where(and(eq(ratingCriteria.id, id), eq(ratingCriteria.organizationId, orgId)))
        .returning();

      res.json(updated);
    } catch (error) {
      console.error("Error updating criteria:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.delete("/api/performance/criteria/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!requireAdmin(req, res)) return;
      const orgId = getOrgId(req, res);
      if (!orgId) return;

      const { id } = req.params;

      const [existing] = await db.select().from(ratingCriteria)
        .where(and(eq(ratingCriteria.id, id), eq(ratingCriteria.organizationId, orgId)))
        .limit(1);

      if (!existing) { res.status(404).json({ error: "Criteria not found" }); return; }

      const [updated] = await db.update(ratingCriteria)
        .set({ isActive: false })
        .where(and(eq(ratingCriteria.id, id), eq(ratingCriteria.organizationId, orgId)))
        .returning();

      res.json(updated);
    } catch (error) {
      console.error("Error deleting criteria:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/performance/eligible-employees", requireAuth, async (req: AuthRequest, res) => {
    try {
      const orgId = getOrgId(req, res);
      if (!orgId) return;

      const userRole = req.user!.role;
      const allowedRoles = ROLE_HIERARCHY[userRole];

      if (!allowedRoles || allowedRoles.length === 0) {
        res.json([]);
        return;
      }

      const eligible = await db
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          role: users.role,
        })
        .from(users)
        .where(
          and(
            eq(users.organizationId, orgId),
            eq(users.isActive, true),
            inArray(users.role, allowedRoles as any)
          )
        );

      res.json(eligible);
    } catch (error) {
      console.error("Error fetching eligible employees:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/performance/ratings", requireAuth, async (req: AuthRequest, res) => {
    try {
      const orgId = getOrgId(req, res);
      if (!orgId) return;

      const parsed = createRatingSchema.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0].message }); return; }
      const { employeeId, projectId, period, comments, scores } = parsed.data;

      const [employee] = await db.select().from(users)
        .where(and(eq(users.id, employeeId), eq(users.organizationId, orgId)))
        .limit(1);

      if (!employee) { res.status(404).json({ error: "Employee not found in organization" }); return; }

      const evaluatorRole = req.user!.role;
      const allowedRoles = ROLE_HIERARCHY[evaluatorRole];
      if (!allowedRoles || !allowedRoles.includes(employee.role)) {
        res.status(403).json({ error: "You are not authorized to rate this employee" });
        return;
      }

      const kpiScores: { kpiTemplateId: string; score: number; comment?: string }[] = [];
      const regularCriteriaIds: string[] = [];

      for (const s of scores) {
        if (s.criteriaId.startsWith("kpi_")) {
          kpiScores.push({ kpiTemplateId: s.criteriaId.replace("kpi_", ""), score: Number(s.score), comment: s.comment });
        } else {
          regularCriteriaIds.push(s.criteriaId);
        }
      }

      const criteriaMap = new Map<string, { id: string; weight: string | null; maxScore: number }>();

      if (regularCriteriaIds.length > 0) {
        const criteriaRecords = await db.select().from(ratingCriteria)
          .where(and(
            eq(ratingCriteria.organizationId, orgId),
            eq(ratingCriteria.isActive, true),
            inArray(ratingCriteria.id, regularCriteriaIds)
          ));
        for (const c of criteriaRecords) {
          criteriaMap.set(c.id, c);
        }
      }

      if (kpiScores.length > 0) {
        const kpiTemplateIds = kpiScores.map(k => k.kpiTemplateId);
        const templates = await db.select().from(kpiTemplates)
          .where(and(
            eq(kpiTemplates.organizationId, orgId),
            eq(kpiTemplates.isActive, true),
            inArray(kpiTemplates.id, kpiTemplateIds)
          ));

        for (const t of templates) {
          const existingByKpi = await db.select().from(ratingCriteria)
            .where(and(
              eq(ratingCriteria.organizationId, orgId),
              eq(ratingCriteria.kpiTemplateId, t.id)
            ))
            .limit(1);

          let criteriaId: string;
          if (existingByKpi.length > 0) {
            criteriaId = existingByKpi[0].id;
            if (!existingByKpi[0].isActive) {
              await db.update(ratingCriteria).set({ isActive: true, name: t.name, description: t.description })
                .where(eq(ratingCriteria.id, criteriaId));
            }
          } else {
            const existingByName = await db.select().from(ratingCriteria)
              .where(and(
                eq(ratingCriteria.organizationId, orgId),
                eq(ratingCriteria.name, t.name)
              ))
              .limit(1);

            if (existingByName.length > 0) {
              criteriaId = existingByName[0].id;
              await db.update(ratingCriteria).set({ kpiTemplateId: t.id, isActive: true, description: t.description })
                .where(eq(ratingCriteria.id, criteriaId));
            } else {
              const [created] = await db.insert(ratingCriteria).values({
                organizationId: orgId,
                name: t.name,
                description: t.description,
                weight: "1.0",
                maxScore: 10,
                isActive: true,
                sortOrder: 0,
                kpiTemplateId: t.id,
              }).returning();
              criteriaId = created.id;
            }
          }

          criteriaMap.set(`kpi_${t.id}`, { id: criteriaId, weight: "1.0", maxScore: 10 });
        }

        if (kpiScores.length !== criteriaMap.size - regularCriteriaIds.length) {
          res.status(400).json({ error: "One or more KPI templates not found or inactive" });
          return;
        }
      }

      const validatedCount = criteriaMap.size;
      if (validatedCount !== scores.length) {
        res.status(400).json({ error: "One or more criteria not found or inactive" });
        return;
      }

      let totalScore = 0;
      let weightedSum = 0;
      let totalWeight = 0;

      for (const s of scores) {
        const criteria = criteriaMap.get(s.criteriaId);
        if (!criteria) continue;
        const scoreVal = Number(s.score);
        totalScore += scoreVal;
        const weight = parseFloat(criteria.weight || "1.0");
        weightedSum += scoreVal * weight;
        totalWeight += weight;
      }

      const overallScore = scores.length > 0 ? (totalScore / scores.length).toFixed(2) : "0";
      const weightedScore = totalWeight > 0 ? (weightedSum / totalWeight).toFixed(2) : overallScore;

      const [rating] = await db.insert(employeeRatings).values({
        organizationId: orgId,
        employeeId,
        evaluatorId: req.user!.id,
        projectId: projectId || null,
        period: period || null,
        overallScore,
        weightedScore,
        comments: comments || null,
      }).returning();

      const scoreInserts = scores.map((s: any) => {
        const criteria = criteriaMap.get(s.criteriaId);
        return {
          ratingId: rating.id,
          criteriaId: criteria?.id || s.criteriaId,
          score: String(s.score),
          comment: s.comment || null,
        };
      }).filter(s => s.criteriaId);

      const insertedScores = await db.insert(ratingScores).values(scoreInserts).returning();

      if (kpiScores.length > 0) {
        const now = new Date();
        const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
        const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];

        for (const ks of kpiScores) {
          const assignments = await db.select().from(kpiAssignments)
            .where(and(
              eq(kpiAssignments.organizationId, orgId),
              eq(kpiAssignments.userId, employeeId),
              eq(kpiAssignments.kpiTemplateId, ks.kpiTemplateId),
              eq(kpiAssignments.isActive, true)
            ))
            .limit(1);

          if (assignments.length > 0) {
            await db.insert(kpiEntries).values({
              organizationId: orgId,
              kpiAssignmentId: assignments[0].id,
              actualValue: String(ks.score),
              periodStart,
              periodEnd,
              notes: ks.comment || `Rating score from performance review`,
              source: "rating",
              recordedBy: req.user!.id,
            });
          }
        }
      }

      res.status(201).json({ ...rating, scores: insertedScores });
    } catch (error) {
      console.error("Error creating rating:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/performance/ratings/my", requireAuth, async (req: AuthRequest, res) => {
    try {
      const orgId = getOrgId(req, res);
      if (!orgId) return;

      const ratings = await db
        .select()
        .from(employeeRatings)
        .where(and(
          eq(employeeRatings.organizationId, orgId),
          eq(employeeRatings.employeeId, req.user!.id)
        ))
        .orderBy(desc(employeeRatings.createdAt));

      const ratingsWithScores = await Promise.all(
        ratings.map(async (r) => {
          const scores = await db.select().from(ratingScores).where(eq(ratingScores.ratingId, r.id));
          return { ...r, scores };
        })
      );

      res.json(ratingsWithScores);
    } catch (error) {
      console.error("Error fetching my ratings:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/performance/ratings", requireAuth, async (req: AuthRequest, res) => {
    try {
      const orgId = getOrgId(req, res);
      if (!orgId) return;

      const { employeeId } = req.query;

      const conditions = [eq(employeeRatings.organizationId, orgId)];

      if (employeeId) {
        conditions.push(eq(employeeRatings.employeeId, employeeId as string));
      }

      if (req.user!.role !== "ADMIN") {
        conditions.push(eq(employeeRatings.evaluatorId, req.user!.id));
      }

      const ratings = await db
        .select()
        .from(employeeRatings)
        .where(and(...conditions))
        .orderBy(desc(employeeRatings.createdAt));

      const ratingsWithScores = await Promise.all(
        ratings.map(async (r) => {
          const scores = await db.select().from(ratingScores).where(eq(ratingScores.ratingId, r.id));
          return { ...r, scores };
        })
      );

      res.json(ratingsWithScores);
    } catch (error) {
      console.error("Error fetching ratings:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/performance/leaderboard", requireAuth, async (req: AuthRequest, res) => {
    try {
      const orgId = getOrgId(req, res);
      if (!orgId) return;

      if (req.user!.role !== "ADMIN" && req.user!.role !== "MANAGER") {
        res.status(403).json({ error: "Admin or Manager access required" });
        return;
      }

      const leaderboard = await db
        .select({
          employeeId: employeeRatings.employeeId,
          firstName: users.firstName,
          lastName: users.lastName,
          role: users.role,
          avgWeightedScore: avg(employeeRatings.weightedScore),
          totalRatings: sql<number>`count(${employeeRatings.id})::int`,
        })
        .from(employeeRatings)
        .innerJoin(users, eq(employeeRatings.employeeId, users.id))
        .where(eq(employeeRatings.organizationId, orgId))
        .groupBy(employeeRatings.employeeId, users.firstName, users.lastName, users.role)
        .orderBy(desc(avg(employeeRatings.weightedScore)))
        .limit(20);

      res.json(leaderboard);
    } catch (error) {
      console.error("Error fetching leaderboard:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/performance/reward-types", requireAuth, async (req: AuthRequest, res) => {
    try {
      const orgId = getOrgId(req, res);
      if (!orgId) return;

      await seedPresetRewardTypes(orgId);

      const results = await db
        .select()
        .from(rewardTypes)
        .where(and(eq(rewardTypes.organizationId, orgId), eq(rewardTypes.isActive, true)));

      res.json(results);
    } catch (error) {
      console.error("Error fetching reward types:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/performance/reward-types", requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!requireAdmin(req, res)) return;
      const orgId = getOrgId(req, res);
      if (!orgId) return;

      const parsed = createRewardTypeSchema.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0].message }); return; }
      const { name, description, category, value } = parsed.data;

      const [created] = await db.insert(rewardTypes).values({
        organizationId: orgId,
        name,
        description: description || null,
        category: category || "CUSTOM",
        value: value || null,
        isActive: true,
      }).returning();

      res.status(201).json(created);
    } catch (error) {
      console.error("Error creating reward type:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.patch("/api/performance/reward-types/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!requireAdmin(req, res)) return;
      const orgId = getOrgId(req, res);
      if (!orgId) return;

      const { id } = req.params;
      const { name, description, category, value, isActive } = req.body;

      const [existing] = await db.select().from(rewardTypes)
        .where(and(eq(rewardTypes.id, id), eq(rewardTypes.organizationId, orgId)))
        .limit(1);

      if (!existing) { res.status(404).json({ error: "Reward type not found" }); return; }

      const updateData: Record<string, unknown> = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (category !== undefined) updateData.category = category;
      if (value !== undefined) updateData.value = value;
      if (isActive !== undefined) updateData.isActive = isActive;

      const [updated] = await db.update(rewardTypes).set(updateData)
        .where(and(eq(rewardTypes.id, id), eq(rewardTypes.organizationId, orgId)))
        .returning();

      res.json(updated);
    } catch (error) {
      console.error("Error updating reward type:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.delete("/api/performance/reward-types/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!requireAdmin(req, res)) return;
      const orgId = getOrgId(req, res);
      if (!orgId) return;

      const { id } = req.params;

      const [existing] = await db.select().from(rewardTypes)
        .where(and(eq(rewardTypes.id, id), eq(rewardTypes.organizationId, orgId)))
        .limit(1);

      if (!existing) { res.status(404).json({ error: "Reward type not found" }); return; }

      const [updated] = await db.update(rewardTypes)
        .set({ isActive: false })
        .where(and(eq(rewardTypes.id, id), eq(rewardTypes.organizationId, orgId)))
        .returning();

      res.json(updated);
    } catch (error) {
      console.error("Error deleting reward type:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/performance/rewards", requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!requireAdmin(req, res)) return;
      const orgId = getOrgId(req, res);
      if (!orgId) return;

      const parsed = assignRewardSchema.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0].message }); return; }
      const { employeeId, rewardTypeId, ratingId, amount, justification } = parsed.data;
      const { expiresAt } = req.body;

      const [employee] = await db.select().from(users)
        .where(and(eq(users.id, employeeId), eq(users.organizationId, orgId)))
        .limit(1);

      if (!employee) { res.status(404).json({ error: "Employee not found in organization" }); return; }

      const [rewardType] = await db.select().from(rewardTypes)
        .where(and(eq(rewardTypes.id, rewardTypeId), eq(rewardTypes.organizationId, orgId)))
        .limit(1);

      if (!rewardType) { res.status(404).json({ error: "Reward type not found" }); return; }

      const [created] = await db.insert(rewardAssignments).values({
        organizationId: orgId,
        employeeId,
        rewardTypeId,
        assignedById: req.user!.id,
        ratingId: ratingId || null,
        amount: amount || null,
        justification: justification || null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      }).returning();

      res.status(201).json(created);
    } catch (error) {
      console.error("Error assigning reward:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/performance/rewards/my", requireAuth, async (req: AuthRequest, res) => {
    try {
      const orgId = getOrgId(req, res);
      if (!orgId) return;

      const results = await db
        .select({
          reward: rewardAssignments,
          rewardTypeName: rewardTypes.name,
          rewardTypeCategory: rewardTypes.category,
        })
        .from(rewardAssignments)
        .innerJoin(rewardTypes, eq(rewardAssignments.rewardTypeId, rewardTypes.id))
        .where(and(
          eq(rewardAssignments.organizationId, orgId),
          eq(rewardAssignments.employeeId, req.user!.id)
        ))
        .orderBy(desc(rewardAssignments.createdAt));

      res.json(results);
    } catch (error) {
      console.error("Error fetching my rewards:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/performance/rewards/analytics", requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!requireAdmin(req, res)) return;
      const orgId = getOrgId(req, res);
      if (!orgId) return;

      const totalRewards = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(rewardAssignments)
        .where(eq(rewardAssignments.organizationId, orgId));

      const byType = await db
        .select({
          category: rewardTypes.category,
          name: rewardTypes.name,
          count: sql<number>`count(*)::int`,
          totalAmount: sql<string>`coalesce(sum(${rewardAssignments.amount}), 0)`,
        })
        .from(rewardAssignments)
        .innerJoin(rewardTypes, eq(rewardAssignments.rewardTypeId, rewardTypes.id))
        .where(eq(rewardAssignments.organizationId, orgId))
        .groupBy(rewardTypes.category, rewardTypes.name);

      const byMonth = await db
        .select({
          month: sql<string>`to_char(${rewardAssignments.createdAt}, 'YYYY-MM')`,
          count: sql<number>`count(*)::int`,
          totalAmount: sql<string>`coalesce(sum(${rewardAssignments.amount}), 0)`,
        })
        .from(rewardAssignments)
        .where(eq(rewardAssignments.organizationId, orgId))
        .groupBy(sql`to_char(${rewardAssignments.createdAt}, 'YYYY-MM')`)
        .orderBy(desc(sql`to_char(${rewardAssignments.createdAt}, 'YYYY-MM')`));

      res.json({
        totalRewards: totalRewards[0]?.count || 0,
        byType,
        byMonth,
      });
    } catch (error) {
      console.error("Error fetching reward analytics:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/performance/rewards", requireAuth, async (req: AuthRequest, res) => {
    try {
      const orgId = getOrgId(req, res);
      if (!orgId) return;

      const { employeeId } = req.query;
      const conditions = [eq(rewardAssignments.organizationId, orgId)];

      if (employeeId) {
        if (req.user!.role !== "ADMIN" && req.user!.id !== employeeId) {
          res.status(403).json({ error: "Access denied" });
          return;
        }
        conditions.push(eq(rewardAssignments.employeeId, employeeId as string));
      } else if (req.user!.role !== "ADMIN") {
        conditions.push(eq(rewardAssignments.employeeId, req.user!.id));
      }

      const results = await db
        .select({
          reward: rewardAssignments,
          rewardTypeName: rewardTypes.name,
          rewardTypeCategory: rewardTypes.category,
        })
        .from(rewardAssignments)
        .innerJoin(rewardTypes, eq(rewardAssignments.rewardTypeId, rewardTypes.id))
        .where(and(...conditions))
        .orderBy(desc(rewardAssignments.createdAt));

      res.json(results);
    } catch (error) {
      console.error("Error fetching rewards:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });
}
