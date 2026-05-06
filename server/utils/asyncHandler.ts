/**
 * Express 4 does NOT forward rejected promises from async route handlers
 * to the error middleware. Wrap async handlers with this so a thrown
 * error reaches the central error middleware (and Sentry) instead of
 * timing the request out.
 *
 * See `docs/runbooks/observability.md` ("Throwing errors that pass
 * through cleanly") for the full story.
 */
import type { NextFunction, Request, Response } from "express";

export const asyncHandler =
  <Req extends Request = Request, Res extends Response = Response>(
    fn: (req: Req, res: Res, next: NextFunction) => Promise<unknown>,
  ) =>
  (req: Req, res: Res, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
