import type { Request, Response } from "express";
import type { AuthRequest } from "../auth";

export function getOrgId(req: AuthRequest, res: Response): string | null {
  const orgId = req.user?.organizationId;
  if (!orgId) {
    res.status(403).json({ error: "Organization required" });
    return null;
  }
  return orgId;
}

export function getUserOrThrow(req: AuthRequest, res: Response) {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  return req.user;
}

export interface PaginationResult {
  page: number;
  limit: number;
  offset: number;
}

export function parsePagination(
  req: Request,
  defaults: { page?: number; limit?: number; maxLimit?: number } = {}
): PaginationResult {
  const { page: defaultPage = 1, limit: defaultLimit = 50, maxLimit } = defaults;
  const rawLimit = Math.max(1, parseInt(req.query.limit as string) || defaultLimit);
  const limit = maxLimit ? Math.min(rawLimit, maxLimit) : rawLimit;
  const explicitOffset = req.query.offset as string | undefined;
  if (explicitOffset !== undefined) {
    const offset = Math.max(0, parseInt(explicitOffset) || 0);
    const page = Math.floor(offset / limit) + 1;
    return { page, limit, offset };
  }
  const page = Math.max(1, parseInt(req.query.page as string) || defaultPage);
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}
