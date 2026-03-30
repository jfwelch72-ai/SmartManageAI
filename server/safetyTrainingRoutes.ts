/**
 * @openapi
 * /api/safety/trainings:
 *   get:
 *     tags: [Safety]
 *     summary: List safety trainings
 *     description: Returns safety training courses for the organization.
 *     responses:
 *       200: { description: List of safety trainings }
 *   post:
 *     tags: [Safety]
 *     summary: Create a safety training
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title]
 *             properties:
 *               title: { type: string }
 *               description: { type: string }
 *               durationMinutes: { type: integer }
 *               isRequired: { type: boolean }
 *     responses:
 *       201: { description: Training created }
 * /api/safety/trainings/{id}:
 *   get:
 *     tags: [Safety]
 *     summary: Get safety training details
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Training details with assignments }
 *       404: { description: Not found }
 *   patch:
 *     tags: [Safety]
 *     summary: Update a safety training
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200: { description: Training updated }
 *   delete:
 *     tags: [Safety]
 *     summary: Delete a safety training
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Training deleted }
 * /api/safety/trainings/{id}/assignments:
 *   get:
 *     tags: [Safety]
 *     summary: Get training assignments
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: List of assignments }
 *   post:
 *     tags: [Safety]
 *     summary: Assign training to users
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userIds]
 *             properties:
 *               userIds:
 *                 type: array
 *                 items: { type: string, format: uuid }
 *               dueDate: { type: string, format: date }
 *     responses:
 *       201: { description: Training assigned }
 */
import { Router } from "express";
import { db } from "./db";
import { requireAuth, requireFeaturePermission } from "./auth";
import { safetyTrainings, safetyTrainingAssignments, insertSafetyTrainingSchema, insertSafetyTrainingAssignmentSchema, users, organizations } from "@shared/schema";
import { eq, and, inArray, desc, sql } from "drizzle-orm";
import { z } from "zod";
import type { AuthRequest } from "./auth";

const router = Router();

router.use("/api/safety-training", requireAuth, requireFeaturePermission('canManageSafety'));

function isSafetyAdmin(role?: string): boolean {
  return ["ADMIN", "SUPER_ADMIN", "SAFETY_MANAGER", "HR_MANAGER", "MANAGER"].includes(role || "");
}

// GET /api/safety-training — list all training programs for org
router.get("/api/safety-training", async (req: AuthRequest, res) => {
  try {
    const orgId = req.user!.organizationId;
    const trainings = await db
      .select()
      .from(safetyTrainings)
      .where(and(eq(safetyTrainings.organizationId, orgId!), eq(safetyTrainings.isActive, true)))
      .orderBy(desc(safetyTrainings.createdAt));

    const assignmentCounts = await db
      .select({
        trainingId: safetyTrainingAssignments.trainingId,
        total: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where status = 'COMPLETED')::int`,
      })
      .from(safetyTrainingAssignments)
      .where(eq(safetyTrainingAssignments.organizationId, orgId!))
      .groupBy(safetyTrainingAssignments.trainingId);

    const countsMap = Object.fromEntries(assignmentCounts.map(c => [c.trainingId, c]));

    const result = trainings.map(t => ({
      ...t,
      totalAssigned: countsMap[t.id]?.total ?? 0,
      totalCompleted: countsMap[t.id]?.completed ?? 0,
    }));

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/safety-training — create training program
router.post("/api/safety-training", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!isSafetyAdmin(req.user!.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const parsed = insertSafetyTrainingSchema.parse({
      ...req.body,
      organizationId: req.user!.organizationId,
      createdBy: req.user!.id,
    });
    const [created] = await db.insert(safetyTrainings).values(parsed).returning();
    res.status(201).json(created);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /api/safety-training/:id — edit training program
router.patch("/api/safety-training/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!isSafetyAdmin(req.user!.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const orgId = req.user!.organizationId;
    const { id } = req.params;
    const allowed = ["title", "description", "category", "frequency", "durationMinutes", "materials"];
    const updates: Record<string, any> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    updates.updatedAt = new Date();

    const [updated] = await db
      .update(safetyTrainings)
      .set(updates)
      .where(and(eq(safetyTrainings.id, id), eq(safetyTrainings.organizationId, orgId!)))
      .returning();

    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/safety-training/:id — soft delete (set inactive)
router.delete("/api/safety-training/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!isSafetyAdmin(req.user!.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const orgId = req.user!.organizationId;
    const { id } = req.params;
    await db
      .update(safetyTrainings)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(safetyTrainings.id, id), eq(safetyTrainings.organizationId, orgId!)));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/safety-training/assignments — list all assignments for org
router.get("/api/safety-training/assignments", requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.user!.organizationId;
    const userId = req.user!.id;
    const role = req.user!.role;

    const assignments = await db
      .select({
        id: safetyTrainingAssignments.id,
        trainingId: safetyTrainingAssignments.trainingId,
        employeeId: safetyTrainingAssignments.employeeId,
        assignedAt: safetyTrainingAssignments.assignedAt,
        dueDate: safetyTrainingAssignments.dueDate,
        status: safetyTrainingAssignments.status,
        completedAt: safetyTrainingAssignments.completedAt,
        completedByName: safetyTrainingAssignments.completedByName,
        notes: safetyTrainingAssignments.notes,
        acknowledgmentSignature: safetyTrainingAssignments.acknowledgmentSignature,
        createdAt: safetyTrainingAssignments.createdAt,
        trainingTitle: safetyTrainings.title,
        trainingCategory: safetyTrainings.category,
        trainingFrequency: safetyTrainings.frequency,
        trainingDuration: safetyTrainings.durationMinutes,
        trainingMaterials: safetyTrainings.materials,
        trainingDescription: safetyTrainings.description,
        employeeFirstName: users.firstName,
        employeeLastName: users.lastName,
        employeeEmail: users.email,
      })
      .from(safetyTrainingAssignments)
      .innerJoin(safetyTrainings, eq(safetyTrainingAssignments.trainingId, safetyTrainings.id))
      .innerJoin(users, eq(safetyTrainingAssignments.employeeId, users.id))
      .where(
        isSafetyAdmin(role)
          ? eq(safetyTrainingAssignments.organizationId, orgId!)
          : and(eq(safetyTrainingAssignments.organizationId, orgId!), eq(safetyTrainingAssignments.employeeId, userId))
      )
      .orderBy(desc(safetyTrainingAssignments.assignedAt));

    res.json(assignments);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/safety-training/assign — assign training to employees or all
router.post("/api/safety-training/assign", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!isSafetyAdmin(req.user!.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const orgId = req.user!.organizationId;
    const { trainingId, employeeIds, assignAll, dueDate } = req.body;

    if (!trainingId) return res.status(400).json({ error: "trainingId required" });

    let targetIds: string[] = employeeIds || [];
    if (assignAll) {
      const allWorkers = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.organizationId, orgId!), eq(users.isActive, true)));
      targetIds = allWorkers.map(w => w.id);
    }

    if (targetIds.length === 0) {
      return res.status(400).json({ error: "No employees selected" });
    }

    const rows = targetIds.map(empId => ({
      trainingId,
      organizationId: orgId!,
      employeeId: empId,
      assignedBy: req.user!.id,
      dueDate: dueDate || null,
      status: "PENDING" as const,
    }));

    const inserted = await db
      .insert(safetyTrainingAssignments)
      .values(rows)
      .onConflictDoNothing()
      .returning();

    res.status(201).json({ assigned: inserted.length });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /api/safety-training/assignments/:id — mark complete / update notes
router.patch("/api/safety-training/assignments/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.user!.organizationId;
    const userId = req.user!.id;
    const role = req.user!.role;
    const { id } = req.params;

    const [existing] = await db
      .select()
      .from(safetyTrainingAssignments)
      .where(and(eq(safetyTrainingAssignments.id, id), eq(safetyTrainingAssignments.organizationId, orgId!)));

    if (!existing) return res.status(404).json({ error: "Assignment not found" });

    const canEdit = isSafetyAdmin(role) || existing.employeeId === userId;
    if (!canEdit) return res.status(403).json({ error: "Insufficient permissions" });

    const updates: Record<string, any> = {};
    if (req.body.status !== undefined) {
      updates.status = req.body.status;
      if (req.body.status === "COMPLETED" && !existing.completedAt) {
        updates.completedAt = new Date();
      }
    }
    if (req.body.completedByName !== undefined) updates.completedByName = req.body.completedByName;
    if (req.body.notes !== undefined) updates.notes = req.body.notes;
    if (req.body.acknowledgmentSignature !== undefined) updates.acknowledgmentSignature = req.body.acknowledgmentSignature;
    if (req.body.dueDate !== undefined) updates.dueDate = req.body.dueDate;

    const [updated] = await db
      .update(safetyTrainingAssignments)
      .set(updates)
      .where(eq(safetyTrainingAssignments.id, id))
      .returning();

    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/safety-training/assignments/:id — remove assignment
router.delete("/api/safety-training/assignments/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!isSafetyAdmin(req.user!.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const orgId = req.user!.organizationId;
    const { id } = req.params;
    await db
      .delete(safetyTrainingAssignments)
      .where(and(eq(safetyTrainingAssignments.id, id), eq(safetyTrainingAssignments.organizationId, orgId!)));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/safety-training/export/pdf — PDF report
router.get("/api/safety-training/export/pdf", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!isSafetyAdmin(req.user!.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const orgId = req.user!.organizationId;
    const { employeeId } = req.query;

    const [org] = await db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, orgId!));

    const whereClause = employeeId
      ? and(eq(safetyTrainingAssignments.organizationId, orgId!), eq(safetyTrainingAssignments.employeeId, String(employeeId)))
      : eq(safetyTrainingAssignments.organizationId, orgId!);

    const assignments = await db
      .select({
        id: safetyTrainingAssignments.id,
        status: safetyTrainingAssignments.status,
        assignedAt: safetyTrainingAssignments.assignedAt,
        completedAt: safetyTrainingAssignments.completedAt,
        completedByName: safetyTrainingAssignments.completedByName,
        dueDate: safetyTrainingAssignments.dueDate,
        notes: safetyTrainingAssignments.notes,
        acknowledgmentSignature: safetyTrainingAssignments.acknowledgmentSignature,
        trainingTitle: safetyTrainings.title,
        trainingCategory: safetyTrainings.category,
        trainingFrequency: safetyTrainings.frequency,
        trainingDuration: safetyTrainings.durationMinutes,
        trainingDescription: safetyTrainings.description,
        trainingMaterials: safetyTrainings.materials,
        employeeFirstName: users.firstName,
        employeeLastName: users.lastName,
        employeeEmail: users.email,
      })
      .from(safetyTrainingAssignments)
      .innerJoin(safetyTrainings, eq(safetyTrainingAssignments.trainingId, safetyTrainings.id))
      .innerJoin(users, eq(safetyTrainingAssignments.employeeId, users.id))
      .where(whereClause)
      .orderBy(users.lastName, users.firstName, safetyTrainings.category);

    // Group by employee
    const byEmployee: Record<string, { name: string; email: string; records: typeof assignments }> = {};
    for (const row of assignments) {
      const empId = `${row.employeeFirstName}_${row.employeeLastName}_${row.employeeEmail}`;
      if (!byEmployee[empId]) {
        byEmployee[empId] = {
          name: `${row.employeeFirstName} ${row.employeeLastName}`,
          email: row.employeeEmail || "",
          records: [],
        };
      }
      byEmployee[empId].records.push(row);
    }

    const statusBadge = (status: string) => {
      const colors: Record<string, string> = {
        COMPLETED: "#16a34a",
        PENDING: "#ca8a04",
        OVERDUE: "#dc2626",
      };
      return `<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;background:${colors[status] || "#6b7280"}22;color:${colors[status] || "#6b7280"};border:1px solid ${colors[status] || "#6b7280"}44">${status}</span>`;
    };

    const formatDate = (d: Date | string | null) => {
      if (!d) return "—";
      return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
    };

    const employeeBlocks = Object.values(byEmployee).map(emp => {
      const rows = emp.records.map(r => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${r.trainingTitle}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${r.trainingCategory}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${r.trainingFrequency}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${r.trainingDuration ? r.trainingDuration + " min" : "—"}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${formatDate(r.assignedAt)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${r.dueDate ? formatDate(r.dueDate) : "—"}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${r.completedAt ? formatDate(r.completedAt) : "—"}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${statusBadge(r.status)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${r.acknowledgmentSignature || "—"}</td>
        </tr>`).join("");

      const completedCount = emp.records.filter(r => r.status === "COMPLETED").length;
      const total = emp.records.length;

      return `
        <div style="margin-bottom:32px;page-break-inside:avoid;">
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 18px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;">
            <div>
              <div style="font-size:16px;font-weight:700;color:#0f172a;">${emp.name}</div>
              <div style="font-size:12px;color:#64748b;">${emp.email}</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:13px;font-weight:600;color:#0f172a;">${completedCount}/${total} Completed</div>
              <div style="font-size:11px;color:#64748b;">${total > 0 ? Math.round((completedCount / total) * 100) : 0}% completion rate</div>
            </div>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead>
              <tr style="background:#f1f5f9;">
                <th style="padding:8px 12px;text-align:left;font-weight:600;color:#475569;border-bottom:2px solid #e2e8f0;">Training</th>
                <th style="padding:8px 12px;text-align:left;font-weight:600;color:#475569;border-bottom:2px solid #e2e8f0;">Category</th>
                <th style="padding:8px 12px;text-align:left;font-weight:600;color:#475569;border-bottom:2px solid #e2e8f0;">Frequency</th>
                <th style="padding:8px 12px;text-align:left;font-weight:600;color:#475569;border-bottom:2px solid #e2e8f0;">Duration</th>
                <th style="padding:8px 12px;text-align:left;font-weight:600;color:#475569;border-bottom:2px solid #e2e8f0;">Assigned</th>
                <th style="padding:8px 12px;text-align:left;font-weight:600;color:#475569;border-bottom:2px solid #e2e8f0;">Due</th>
                <th style="padding:8px 12px;text-align:left;font-weight:600;color:#475569;border-bottom:2px solid #e2e8f0;">Completed</th>
                <th style="padding:8px 12px;text-align:left;font-weight:600;color:#475569;border-bottom:2px solid #e2e8f0;">Status</th>
                <th style="padding:8px 12px;text-align:left;font-weight:600;color:#475569;border-bottom:2px solid #e2e8f0;">Acknowledgment</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    }).join("");

    const totalAll = assignments.length;
    const completedAll = assignments.filter(a => a.status === "COMPLETED").length;
    const pendingAll = assignments.filter(a => a.status === "PENDING").length;
    const overdueAll = assignments.filter(a => a.status === "OVERDUE").length;
    const reportTitle = employeeId ? `Employee Safety Training Report` : `Company-Wide Safety Training Report`;
    const reportDate = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>${reportTitle} — ${org?.name || "Organization"}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #0f172a; background: #fff; padding: 40px; }
  @media print {
    body { padding: 20px; }
    .no-print { display: none; }
    table { page-break-inside: auto; }
    tr { page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <div class="no-print" style="background:#1e293b;color:#fff;padding:12px 20px;border-radius:8px;margin-bottom:24px;display:flex;align-items:center;justify-content:space-between;">
    <span style="font-weight:600;">Safety Training Report Preview</span>
    <button onclick="window.print()" style="background:#3b82f6;color:#fff;border:none;padding:8px 18px;border-radius:6px;cursor:pointer;font-weight:600;">Print / Save as PDF</button>
  </div>

  <div style="border-bottom:3px solid #0f172a;padding-bottom:20px;margin-bottom:28px;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;">
      <div>
        <div style="font-size:24px;font-weight:800;color:#0f172a;">${org?.name || "Organization"}</div>
        <div style="font-size:18px;font-weight:600;color:#334155;margin-top:4px;">${reportTitle}</div>
        <div style="font-size:13px;color:#64748b;margin-top:4px;">Generated: ${reportDate}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#64748b;margin-bottom:8px;">Summary</div>
        <div style="display:flex;gap:16px;">
          <div style="text-align:center;"><div style="font-size:22px;font-weight:800;color:#16a34a;">${completedAll}</div><div style="font-size:11px;color:#64748b;">Completed</div></div>
          <div style="text-align:center;"><div style="font-size:22px;font-weight:800;color:#ca8a04;">${pendingAll}</div><div style="font-size:11px;color:#64748b;">Pending</div></div>
          <div style="text-align:center;"><div style="font-size:22px;font-weight:800;color:#dc2626;">${overdueAll}</div><div style="font-size:11px;color:#64748b;">Overdue</div></div>
          <div style="text-align:center;"><div style="font-size:22px;font-weight:800;color:#0f172a;">${totalAll}</div><div style="font-size:11px;color:#64748b;">Total</div></div>
        </div>
      </div>
    </div>
  </div>

  ${employeeBlocks || '<p style="color:#64748b;text-align:center;padding:40px;">No training assignments found.</p>'}

  <div style="margin-top:40px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;text-align:center;">
    This report was generated by SmartManageAI · ${org?.name || ""} · ${reportDate} · Confidential
  </div>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
