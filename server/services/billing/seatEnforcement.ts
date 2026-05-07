/**
 * Seat enforcement.
 *
 * Task #2482 — Billing & Subscription Productization.
 *
 * `assertSeatAvailable` is the single chokepoint every user-creation /
 * invitation route should call before persisting a new active user.
 * Counts only `is_active = true` users in the org against the plan
 * limit (or the per-org override on `organization_subscriptions`).
 */

import { db } from "../../db";
import { users, organizationSubscriptions } from "@shared/schema";
import { and, eq, count } from "drizzle-orm";
import { PLAN_LIMITS, type PlanTier } from "@shared/billing/plans";

export interface SeatStatus {
  used: number;
  limit: number; // -1 = unlimited
  remaining: number; // Infinity when unlimited
  planTier: PlanTier;
}

export async function getSeatStatus(organizationId: string): Promise<SeatStatus> {
  const [sub] = await db
    .select()
    .from(organizationSubscriptions)
    .where(eq(organizationSubscriptions.organizationId, organizationId))
    .limit(1);

  const planTier = (sub?.planTier as PlanTier) ?? "free";
  const baseLimit = PLAN_LIMITS[planTier]?.users ?? PLAN_LIMITS.free.users;
  const limit = sub?.seatLimitOverride != null ? sub.seatLimitOverride : baseLimit;

  const [row] = await db
    .select({ value: count() })
    .from(users)
    .where(and(eq(users.organizationId, organizationId), eq(users.isActive, true)));

  const used = Number(row?.value ?? 0);
  const remaining = limit === -1 ? Infinity : Math.max(0, limit - used);

  return { used, limit, remaining, planTier };
}

export class SeatLimitExceededError extends Error {
  status = 402;
  code = "SEAT_LIMIT_EXCEEDED";
  constructor(public seat: SeatStatus) {
    super(
      `Seat limit reached for plan "${seat.planTier}" (${seat.used}/${seat.limit === -1 ? "∞" : seat.limit}). Upgrade your plan or contact support to add seats.`,
    );
  }
}

/**
 * Throws SeatLimitExceededError when no seats remain. Pass `count` to
 * pre-validate a bulk invite (default 1).
 */
export async function assertSeatAvailable(
  organizationId: string,
  countToAdd = 1,
): Promise<SeatStatus> {
  const status = await getSeatStatus(organizationId);
  if (status.limit === -1) return status;
  if (status.used + countToAdd > status.limit) {
    throw new SeatLimitExceededError(status);
  }
  return status;
}
