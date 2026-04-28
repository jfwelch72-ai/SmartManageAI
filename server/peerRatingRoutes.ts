import type { Express, Response, NextFunction } from "express";
import { requireAuth, requireFeaturePermission, type AuthRequest } from "./auth";
import { db } from "./db";
import { eq, and, sql, ne, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { peerRatings, users, crewMembers, crewProjectAssignments, organizations } from "@shared/schema";
import { timeClockShifts } from "@shared/schema";
import { logError } from "./utils/logger";
import { parseOrRespond } from "./utils/validation";

const currentPeriod = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};

const submitPeerRatingSchema = z.object({
  rateeId: z.string().min(1),
  projectId: z.string().optional().nullable(),
  crewId: z.string().optional().nullable(),
  teamwork: z.number().int().min(1).max(5),
  reliability: z.number().int().min(1).max(5),
  communication: z.number().int().min(1).max(5),
  helpfulness: z.number().int().min(1).max(5),
  comment: z.string().optional().nullable(),
});

export function registerPeerRatingRoutes(app: Express) {
  const getOrgId = (req: AuthRequest, res: Response): string | null => {
    const orgId = req.user?.organizationId;
    if (!orgId) {
      res.status(400).json({ error: "Organization required" });
      return null;
    }
    return orgId;
  };

  const isManagerOrAdmin = (role: string | undefined) =>
    role === "ADMIN" || role === "MANAGER";

  async function getRateableCoworkerIds(userId: string, orgId: string, scopeMode: string): Promise<Set<string>> {
    const coworkerIds = new Set<string>();

    if (scopeMode === "org_wide") {
      const allOrgUsers = await db.select({ id: users.id })
        .from(users)
        .where(and(eq(users.organizationId, orgId), eq(users.isActive, true), ne(users.id, userId)));
      allOrgUsers.forEach(u => coworkerIds.add(u.id));
    } else {
      const userCrews = await db.select({ crewId: crewMembers.crewId })
        .from(crewMembers).where(eq(crewMembers.userId, userId));
      const crewIds = userCrews.map(c => c.crewId);

      if (crewIds.length > 0) {
        for (const cid of crewIds) {
          const members = await db.select({ userId: crewMembers.userId })
            .from(crewMembers).where(eq(crewMembers.crewId, cid));
          members.forEach(m => { if (m.userId !== userId) coworkerIds.add(m.userId); });
        }

        const crewProjects = await db.select({ projectId: crewProjectAssignments.projectId })
          .from(crewProjectAssignments)
          .where(inArray(crewProjectAssignments.crewId, crewIds));
        const projectIds = crewProjects.map(cp => cp.projectId);

        if (projectIds.length > 0) {
          const projectCrews = await db.select({ crewId: crewProjectAssignments.crewId })
            .from(crewProjectAssignments)
            .where(inArray(crewProjectAssignments.projectId, projectIds));
          const allProjectCrewIds = projectCrews.map(pc => pc.crewId);

          if (allProjectCrewIds.length > 0) {
            for (const pcid of allProjectCrewIds) {
              const members = await db.select({ userId: crewMembers.userId })
                .from(crewMembers).where(eq(crewMembers.crewId, pcid));
              members.forEach(m => { if (m.userId !== userId) coworkerIds.add(m.userId); });
            }
          }
        }
      }

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const userShifts = await db.select({ projectId: timeClockShifts.projectId })
        .from(timeClockShifts)
        .where(and(
          eq(timeClockShifts.userId, userId),
          sql`${timeClockShifts.projectId} IS NOT NULL`,
          sql`${timeClockShifts.clockIn} >= ${thirtyDaysAgo}`
        ));
      const shiftProjectIds = [...new Set(userShifts.map(s => s.projectId).filter(Boolean))] as string[];

      if (shiftProjectIds.length > 0) {
        const coworkerShifts = await db.select({ userId: timeClockShifts.userId })
          .from(timeClockShifts)
          .where(and(
            inArray(timeClockShifts.projectId, shiftProjectIds),
            ne(timeClockShifts.userId, userId),
            sql`${timeClockShifts.clockIn} >= ${thirtyDaysAgo}`
          ));
        coworkerShifts.forEach(s => coworkerIds.add(s.userId));
      }
    }

    return coworkerIds;
  }

  app.get("/api/peer-ratings/settings", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const orgId = getOrgId(req, res);
      if (!orgId) return;
      if (!isManagerOrAdmin(req.user?.role)) {
        return res.status(403).json({ error: "Only managers and admins can view peer rating settings" });
      }
      const [org] = await db.select({
        peerRatingAnonymityMode: organizations.peerRatingAnonymityMode,
        peerRatingScopeMode: organizations.peerRatingScopeMode,
      }).from(organizations).where(eq(organizations.id, orgId));
      if (!org) return res.status(404).json({ error: "Organization not found" });
      res.json(org);
    } catch (err) {
      next(err);
    }
  });

  app.patch("/api/peer-ratings/settings", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const orgId = getOrgId(req, res);
      if (!orgId) return;
      if (!isManagerOrAdmin(req.user?.role)) {
        return res.status(403).json({ error: "Only managers and admins can update peer rating settings" });
      }

      const schema = z.object({
        peerRatingAnonymityMode: z.enum(["fully_anonymous", "managers_can_see"]).optional(),
        peerRatingScopeMode: z.enum(["project_crew", "org_wide"]).optional(),
      });
      const data = parseOrRespond(schema, req.body, res);
      if (!data) return;

      const updates: Record<string, string> = {};
      if (data.peerRatingAnonymityMode) updates.peerRatingAnonymityMode = data.peerRatingAnonymityMode;
      if (data.peerRatingScopeMode) updates.peerRatingScopeMode = data.peerRatingScopeMode;

      if (Object.keys(updates).length > 0) {
        await db.update(organizations).set(updates).where(eq(organizations.id, orgId));
      }

      res.json({ success: true });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
      next(err);
    }
  });

  app.get("/api/peer-ratings/rateable-coworkers", requireAuth, requireFeaturePermission("canSubmitPeerRatings"), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const orgId = getOrgId(req, res);
      if (!orgId) return;
      const userId = req.user!.id;

      const [org] = await db.select({
        peerRatingScopeMode: organizations.peerRatingScopeMode,
      }).from(organizations).where(eq(organizations.id, orgId));

      const scopeMode = org?.peerRatingScopeMode || "project_crew";
      const period = currentPeriod();

      const coworkerIds = await getRateableCoworkerIds(userId, orgId, scopeMode);

      if (coworkerIds.size === 0) {
        return res.json([]);
      }

      const ids = Array.from(coworkerIds);
      const coworkers = await db.select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        avatarUrl: users.avatarUrl,
        role: users.role,
      }).from(users).where(
        and(
          eq(users.organizationId, orgId),
          eq(users.isActive, true),
          inArray(users.id, ids)
        )
      );

      const existingRatings = await db.select({
        rateeId: peerRatings.rateeId,
        projectId: peerRatings.projectId,
      }).from(peerRatings).where(
        and(
          eq(peerRatings.raterId, userId),
          eq(peerRatings.organizationId, orgId),
          eq(peerRatings.period, period)
        )
      );
      const ratedSet = new Set(existingRatings.map(r => `${r.rateeId}:${r.projectId || ""}`));

      const result = coworkers.map(c => ({
        ...c,
        alreadyRated: ratedSet.has(`${c.id}:`) || existingRatings.some(r => r.rateeId === c.id),
      }));

      res.json(result);
    } catch (err) {
      logError("[ERROR] rateable-coworkers:", {}, err instanceof Error ? err : new Error(String(err)));
      next(err);
    }
  });

  app.post("/api/peer-ratings", requireAuth, requireFeaturePermission("canSubmitPeerRatings"), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const orgId = getOrgId(req, res);
      if (!orgId) return;
      const userId = req.user!.id;

      const data = parseOrRespond(submitPeerRatingSchema, req.body, res);
      if (!data) return;

      if (data.rateeId === userId) {
        return res.status(400).json({ error: "You cannot rate yourself" });
      }

      const period = currentPeriod();

      const [ratee] = await db.select({ id: users.id, organizationId: users.organizationId })
        .from(users).where(eq(users.id, data.rateeId));
      if (!ratee || ratee.organizationId !== orgId) {
        return res.status(400).json({ error: "Invalid ratee" });
      }

      const [org] = await db.select({
        peerRatingScopeMode: organizations.peerRatingScopeMode,
      }).from(organizations).where(eq(organizations.id, orgId));

      const scopeMode = org?.peerRatingScopeMode || "project_crew";
      const rateableIds = await getRateableCoworkerIds(userId, orgId, scopeMode);
      if (!rateableIds.has(data.rateeId)) {
        return res.status(403).json({ error: "You can only rate coworkers in your project or crew" });
      }

      const projectId = data.projectId || null;

      const duplicateConditions = [
        eq(peerRatings.raterId, userId),
        eq(peerRatings.rateeId, data.rateeId),
        eq(peerRatings.organizationId, orgId),
        eq(peerRatings.period, period),
      ];
      if (projectId) {
        duplicateConditions.push(eq(peerRatings.projectId, projectId));
      } else {
        duplicateConditions.push(isNull(peerRatings.projectId));
      }

      const existing = await db.select({ id: peerRatings.id }).from(peerRatings).where(
        and(...duplicateConditions)
      );
      if (existing.length > 0) {
        return res.status(409).json({ error: "You have already rated this coworker this period for this project" });
      }

      await db.insert(peerRatings).values({
        organizationId: orgId,
        raterId: userId,
        rateeId: data.rateeId,
        projectId,
        crewId: data.crewId || null,
        period,
        teamwork: data.teamwork,
        reliability: data.reliability,
        communication: data.communication,
        helpfulness: data.helpfulness,
        comment: data.comment || null,
      });

      res.json({ success: true });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
      next(err);
    }
  });

  app.get("/api/peer-ratings/my-scores", requireAuth, requireFeaturePermission("canViewPeerRatings"), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const orgId = getOrgId(req, res);
      if (!orgId) return;

      const userId = req.user!.id;

      const scores = await db.select({
        avgTeamwork: sql<string>`ROUND(AVG(${peerRatings.teamwork})::numeric, 2)`,
        avgReliability: sql<string>`ROUND(AVG(${peerRatings.reliability})::numeric, 2)`,
        avgCommunication: sql<string>`ROUND(AVG(${peerRatings.communication})::numeric, 2)`,
        avgHelpfulness: sql<string>`ROUND(AVG(${peerRatings.helpfulness})::numeric, 2)`,
        totalRatings: sql<string>`COUNT(*)`,
      }).from(peerRatings).where(
        and(
          eq(peerRatings.rateeId, userId),
          eq(peerRatings.organizationId, orgId)
        )
      );

      const row = scores[0] || { avgTeamwork: null, avgReliability: null, avgCommunication: null, avgHelpfulness: null, totalRatings: "0" };
      res.json({
        avgTeamwork: row.avgTeamwork ? parseFloat(row.avgTeamwork) : null,
        avgReliability: row.avgReliability ? parseFloat(row.avgReliability) : null,
        avgCommunication: row.avgCommunication ? parseFloat(row.avgCommunication) : null,
        avgHelpfulness: row.avgHelpfulness ? parseFloat(row.avgHelpfulness) : null,
        totalRatings: parseInt(row.totalRatings || "0"),
      });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/peer-ratings/user/:userId/scores", requireAuth, requireFeaturePermission("canViewPeerRatings"), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const orgId = getOrgId(req, res);
      if (!orgId) return;
      const targetUserId = req.params.userId;
      const requesterId = req.user!.id;
      const requesterRole = req.user?.role || "";

      if (targetUserId !== requesterId && !isManagerOrAdmin(requesterRole)) {
        return res.status(403).json({ error: "Only managers can view other users' peer scores" });
      }

      const scores = await db.select({
        avgTeamwork: sql<string>`ROUND(AVG(${peerRatings.teamwork})::numeric, 2)`,
        avgReliability: sql<string>`ROUND(AVG(${peerRatings.reliability})::numeric, 2)`,
        avgCommunication: sql<string>`ROUND(AVG(${peerRatings.communication})::numeric, 2)`,
        avgHelpfulness: sql<string>`ROUND(AVG(${peerRatings.helpfulness})::numeric, 2)`,
        totalRatings: sql<string>`COUNT(*)`,
      }).from(peerRatings).where(
        and(
          eq(peerRatings.rateeId, targetUserId),
          eq(peerRatings.organizationId, orgId)
        )
      );

      const row = scores[0] || { avgTeamwork: null, avgReliability: null, avgCommunication: null, avgHelpfulness: null, totalRatings: "0" };

      const [org] = await db.select({
        peerRatingAnonymityMode: organizations.peerRatingAnonymityMode,
      }).from(organizations).where(eq(organizations.id, orgId));

      const anonymityMode = org?.peerRatingAnonymityMode || "fully_anonymous";
      const showRaterIdentity = isManagerOrAdmin(requesterRole) && anonymityMode === "managers_can_see";

      let individualRatings: Array<{
        id: string;
        teamwork: number;
        reliability: number;
        communication: number;
        helpfulness: number;
        comment: string | null;
        period: string;
        createdAt: Date;
        raterFirstName?: string | null;
        raterLastName?: string | null;
        raterId?: string | null;
      }> = [];

      if (isManagerOrAdmin(requesterRole)) {
        if (showRaterIdentity) {
          const ratings = await db.select({
            id: peerRatings.id,
            teamwork: peerRatings.teamwork,
            reliability: peerRatings.reliability,
            communication: peerRatings.communication,
            helpfulness: peerRatings.helpfulness,
            comment: peerRatings.comment,
            period: peerRatings.period,
            createdAt: peerRatings.createdAt,
            raterId: peerRatings.raterId,
            raterFirstName: users.firstName,
            raterLastName: users.lastName,
          }).from(peerRatings)
            .leftJoin(users, eq(peerRatings.raterId, users.id))
            .where(
              and(
                eq(peerRatings.rateeId, targetUserId),
                eq(peerRatings.organizationId, orgId)
              )
            )
            .orderBy(sql`${peerRatings.createdAt} DESC`)
            .limit(50);
          individualRatings = ratings;
        } else {
          const ratings = await db.select({
            id: peerRatings.id,
            teamwork: peerRatings.teamwork,
            reliability: peerRatings.reliability,
            communication: peerRatings.communication,
            helpfulness: peerRatings.helpfulness,
            comment: peerRatings.comment,
            period: peerRatings.period,
            createdAt: peerRatings.createdAt,
          }).from(peerRatings)
            .where(
              and(
                eq(peerRatings.rateeId, targetUserId),
                eq(peerRatings.organizationId, orgId)
              )
            )
            .orderBy(sql`${peerRatings.createdAt} DESC`)
            .limit(50);
          individualRatings = ratings.map(r => ({
            ...r,
            raterId: null,
            raterFirstName: null,
            raterLastName: null,
          }));
        }
      }

      res.json({
        avgTeamwork: row.avgTeamwork ? parseFloat(row.avgTeamwork) : null,
        avgReliability: row.avgReliability ? parseFloat(row.avgReliability) : null,
        avgCommunication: row.avgCommunication ? parseFloat(row.avgCommunication) : null,
        avgHelpfulness: row.avgHelpfulness ? parseFloat(row.avgHelpfulness) : null,
        totalRatings: parseInt(row.totalRatings || "0"),
        individualRatings: individualRatings.length > 0 ? individualRatings : undefined,
        anonymityMode,
      });
    } catch (err) {
      next(err);
    }
  });
}
