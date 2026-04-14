import type { Request, Response, NextFunction } from "express";

export function isDevSeedEnabled(): boolean {
  return process.env.NODE_ENV === "development";
}

export function requireDevSeed(req: Request, res: Response, next: NextFunction): void {
  if (!isDevSeedEnabled()) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  next();
}
