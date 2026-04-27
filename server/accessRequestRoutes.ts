import { Router, type Response } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import {
  accessRequests,
  users,
  userDashboardPermissions,
  type AccessRequest,
} from "@shared/schema";
import { requireAuth, type AuthRequest } from "./auth";
import { logInfo, logError } from "./utils/logger";
import { logUpdate } from "./auditLogger";
import {
  notifyUsers,
  getApproverUserIds,
} from "./services/approvalNotificationService";

const router = Router();

// Roles allowed to triage / approve access requests for the organization.
// Mirrors the role list used by `getApproverUserIds` (APPROVER_ROLES) so
// the same admins fan-out notifications and gate the approval endpoint.
const ADMIN_ROLES = ["SUPER_ADMIN", "ADMIN", "HUSTLER"] as const;

function isAdmin(role: string): boolean {
  return (ADMIN_ROLES as readonly string[]).includes(role);
}

// Subset of `userDashboardPermissions` columns we let admins flip via the
// self-serve approval flow. Kept as a hard allow-list so a malicious or
// confused requester cannot escalate to arbitrary internal flags
// (e.g. payroll columns) — the full editor on the Feature Permissions
// tab still covers everything else. Names must match real columns on
// `user_dashboard_permissions`; unknown entries are silently dropped at
// both create and approve time.
const PERMISSION_ALLOWLIST = new Set<string>([
  "canAccessDashboard",
  "canAccessProjects",
  "canCreateProjects",
  "canEditProjects",
  "canAccessCalendar",
  "canAccessTasks",
  "canAccessMessages",
  "canViewBids",
  "canEditBids",
  "canGenerateBidPDFs",
  "canConvertBidToProject",
  "canViewProjectEstimates",
  "canAccessTMBilling",
  "canAccessProgressBilling",
  "canManageContracts",
  "canAccessSubcontracts",
  "canAccessTimeClock",
  "canApproveTime",
  "canAccessTMDaily",
]);

// Roles a requester is allowed to ask for. Mirrors `userRoleEnum` minus
// SUPER_ADMIN (platform-only) and HUSTLER (managed by Replit support).
// Keeping this in sync with the enum is enforced by the table column type.
const REQUESTABLE_ROLES = [
  "ADMIN",
  "MANAGER",
  "SUPERINTENDENT",
  "ESTIMATOR",
  "FIELD_WORKER",
  "VENDOR",
] as const;

const createSchema = z.object({
  requestedRole: z.enum(REQUESTABLE_ROLES).optional().nullable(),
  requestedPermissions: z.array(z.string()).optional().nullable(),
  featureContext: z.string().max(200).optional().nullable(),
  reason: z.string().min(5, "Please describe why you need access").max(1000),
});

const denySchema = z.object({
  decisionNote: z.string().max(500).optional().nullable(),
});

// POST /api/access-requests — submit a new request. Available to any
// authenticated, org-scoped user; SUPER_ADMIN doesn't need this since
// they already bypass org gates everywhere.
router.post("/", requireAuth, async (req: AuthRequest, res: Response, next) => {
  try {
    const user = req.user!;
    if (!user.organizationId) {
      return res.status(400).json({ error: "User has no organization" });
    }

    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request",
        details: parsed.error.flatten(),
      });
    }
    const data = parsed.data;

    const filteredPerms =
      data.requestedPermissions?.filter((p) => PERMISSION_ALLOWLIST.has(p)) ??
      null;

    const [created] = await db
      .insert(accessRequests)
      .values({
        organizationId: user.organizationId,
        requesterUserId: user.id,
        requestedRole: data.requestedRole ?? null,
        requestedPermissions:
          filteredPerms && filteredPerms.length > 0 ? filteredPerms : null,
        featureContext: data.featureContext ?? null,
        reason: data.reason,
      })
      .returning();

    // Fan-out to org admins so they can approve / deny from the
    // Access requests tab. Best-effort — failures are logged but
    // don't block the user's request creation.
    try {
      const adminIds = await getApproverUserIds(
        user.organizationId,
        user.id,
        ADMIN_ROLES,
      );
      if (adminIds.length > 0) {
        const featureLabel = data.featureContext
          ? ` for "${data.featureContext}"`
          : "";
        await notifyUsers(
          adminIds,
          {
            type: "ACCESS_REQUEST_NEW",
            title: "New access request",
            message: `${user.firstName ?? user.email} requested access${featureLabel}.`,
            relatedEntityId: created.id,
            relatedEntityType: "access_request",
          },
          user.organizationId,
        );
      }
    } catch (notifyErr) {
      logError(
        "Failed to fan out access request notification",
        { requestId: created.id },
        notifyErr instanceof Error
          ? notifyErr
          : new Error(String(notifyErr)),
      );
    }

    logInfo("Access request created", {
      requestId: created.id,
      requesterUserId: user.id,
      organizationId: user.organizationId,
    });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// GET /api/access-requests — admins see the org queue (PENDING first, then
// recent decisions). Non-admins see only their own requests so they can
// track status from the user-facing dialog.
router.get("/", requireAuth, async (req: AuthRequest, res: Response, next) => {
  try {
    const user = req.user!;
    if (!user.organizationId) {
      return res.json([]);
    }

    const statusFilter = typeof req.query.status === "string"
      ? req.query.status.toUpperCase()
      : null;

    const whereClauses = [eq(accessRequests.organizationId, user.organizationId)];
    if (!isAdmin(user.role)) {
      whereClauses.push(eq(accessRequests.requesterUserId, user.id));
    }
    if (
      statusFilter &&
      ["PENDING", "APPROVED", "DENIED"].includes(statusFilter)
    ) {
      whereClauses.push(
        eq(
          accessRequests.status,
          statusFilter as AccessRequest["status"],
        ),
      );
    }

    const rows = await db
      .select()
      .from(accessRequests)
      .where(and(...whereClauses))
      .orderBy(desc(accessRequests.createdAt))
      .limit(200);

    // Hydrate requester display info for the admin queue. Cheap join via
    // a second query to avoid pulling the full users row through drizzle's
    // relation syntax (which the rest of this file doesn't use).
    const userIds = Array.from(
      new Set(
        rows.flatMap((r) =>
          [r.requesterUserId, r.decidedById].filter(
            (id): id is string => !!id,
          ),
        ),
      ),
    );
    const userRows = userIds.length
      ? await db
          .select({
            id: users.id,
            firstName: users.firstName,
            lastName: users.lastName,
            email: users.email,
            role: users.role,
          })
          .from(users)
          .where(inArray(users.id, userIds))
      : [];
    const usersById = new Map(userRows.map((u) => [u.id, u]));

    res.json(
      rows.map((r) => ({
        ...r,
        requester: usersById.get(r.requesterUserId) ?? null,
        decidedBy: r.decidedById ? usersById.get(r.decidedById) ?? null : null,
      })),
    );
  } catch (err) {
    next(err);
  }
});

async function loadAndAuthorize(
  req: AuthRequest,
  res: Response,
  id: string,
): Promise<AccessRequest | null> {
  const user = req.user!;
  if (!isAdmin(user.role)) {
    res.status(403).json({ error: "Admin access required" });
    return null;
  }
  const [row] = await db
    .select()
    .from(accessRequests)
    .where(eq(accessRequests.id, id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Access request not found" });
    return null;
  }
  if (
    user.role !== "SUPER_ADMIN" &&
    row.organizationId !== user.organizationId
  ) {
    res.status(403).json({ error: "Access denied" });
    return null;
  }
  if (row.status !== "PENDING") {
    res
      .status(409)
      .json({ error: `Request already ${row.status.toLowerCase()}` });
    return null;
  }
  return row;
}

// POST /api/access-requests/:id/approve — apply the requested role/perms
// and notify the requester.
router.post(
  "/:id/approve",
  requireAuth,
  async (req: AuthRequest, res: Response, next) => {
    try {
      const user = req.user!;
      const request = await loadAndAuthorize(req, res, req.params.id);
      if (!request) return;

      const parsedNote = denySchema.safeParse(req.body ?? {});
      const decisionNote = parsedNote.success
        ? parsedNote.data.decisionNote ?? null
        : null;

      // Run the role bump, permission flag grant, and request status
      // update in a single transaction so an admin never ends up with
      // a half-applied approval (e.g. role updated but request still
      // PENDING, or permissions flipped without the audit/notification
      // record updating). On any failure the transaction rolls back and
      // the catch block surfaces a 500 to the admin so they can retry.
      const allowedPerms = (request.requestedPermissions ?? []).filter((p) =>
        PERMISSION_ALLOWLIST.has(p),
      );

      const result = await db.transaction(async (tx) => {
        const [targetUserRow] = await tx
          .select()
          .from(users)
          .where(eq(users.id, request.requesterUserId))
          .limit(1);
        if (!targetUserRow) {
          throw new Error("Requester user no longer exists");
        }

        if (request.requestedRole) {
          await tx
            .update(users)
            .set({
              role: request.requestedRole,
              updatedAt: new Date(),
            })
            .where(eq(users.id, targetUserRow.id));
        }

        // Flip requested permission flags on the requester's
        // userDashboardPermissions row. Insert a row if missing so the
        // grant survives the first time a user is granted any flag.
        if (allowedPerms.length > 0) {
          const [existingPerm] = await tx
            .select()
            .from(userDashboardPermissions)
            .where(eq(userDashboardPermissions.userId, targetUserRow.id))
            .limit(1);

          const flagUpdates = Object.fromEntries(
            allowedPerms.map((p) => [p, true]),
          );

          if (existingPerm) {
            await tx
              .update(userDashboardPermissions)
              .set({ ...flagUpdates, updatedAt: new Date() })
              .where(eq(userDashboardPermissions.id, existingPerm.id));
          } else {
            await tx.insert(userDashboardPermissions).values({
              organizationId: request.organizationId,
              userId: targetUserRow.id,
              ...flagUpdates,
            });
          }
        }

        const [updatedRow] = await tx
          .update(accessRequests)
          .set({
            status: "APPROVED",
            decidedById: user.id,
            decidedAt: new Date(),
            decisionNote,
            updatedAt: new Date(),
          })
          .where(eq(accessRequests.id, request.id))
          .returning();

        return updatedRow;
      });

      const updated = result;

      await logUpdate(
        user.id,
        "access_request",
        request.id,
        request,
        updated,
        req,
      );

      // Tell the requester. Best-effort; never fail the approval on a
      // notification error.
      try {
        await notifyUsers(
          [request.requesterUserId],
          {
            type: "ACCESS_REQUEST_APPROVED",
            title: "Access request approved",
            message: decisionNote
              ? `Your access request was approved: ${decisionNote}`
              : "Your access request was approved.",
            relatedEntityId: request.id,
            relatedEntityType: "access_request",
          },
          request.organizationId,
        );
      } catch (notifyErr) {
        logError(
          "Failed to notify requester of access approval",
          { requestId: request.id },
          notifyErr instanceof Error
            ? notifyErr
            : new Error(String(notifyErr)),
        );
      }

      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/access-requests/:id/deny — record an admin's denial + note.
router.post(
  "/:id/deny",
  requireAuth,
  async (req: AuthRequest, res: Response, next) => {
    try {
      const user = req.user!;
      const request = await loadAndAuthorize(req, res, req.params.id);
      if (!request) return;

      const parsed = denySchema.safeParse(req.body ?? {});
      const decisionNote = parsed.success
        ? parsed.data.decisionNote ?? null
        : null;

      const [updated] = await db
        .update(accessRequests)
        .set({
          status: "DENIED",
          decidedById: user.id,
          decidedAt: new Date(),
          decisionNote,
          updatedAt: new Date(),
        })
        .where(eq(accessRequests.id, request.id))
        .returning();

      await logUpdate(
        user.id,
        "access_request",
        request.id,
        request,
        updated,
        req,
      );

      try {
        await notifyUsers(
          [request.requesterUserId],
          {
            type: "ACCESS_REQUEST_DENIED",
            title: "Access request denied",
            message: decisionNote
              ? `Your access request was denied: ${decisionNote}`
              : "Your access request was denied.",
            relatedEntityId: request.id,
            relatedEntityType: "access_request",
          },
          request.organizationId,
        );
      } catch (notifyErr) {
        logError(
          "Failed to notify requester of access denial",
          { requestId: request.id },
          notifyErr instanceof Error
            ? notifyErr
            : new Error(String(notifyErr)),
        );
      }

      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
