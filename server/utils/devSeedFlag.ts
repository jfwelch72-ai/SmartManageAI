import type { Request, Response, NextFunction } from "express";

export function isDevSeedEnabled(): boolean {
  if (process.env.ENABLE_DEV_SEED === "true") return true;
  return process.env.NODE_ENV === "development" || !process.env.NODE_ENV;
}

export function requireDevSeed(req: Request, res: Response, next: NextFunction): void {
  if (!isDevSeedEnabled()) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  next();
}
