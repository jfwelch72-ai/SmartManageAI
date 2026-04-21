import { Router, type Response, type NextFunction } from "express";
import {
  type AuthRequest,
  requireAuth,
  requireRole,
} from "./auth";
import {
  isEmailTransportNoop,
  getTestEmailOutbox,
  clearTestEmailOutbox,
} from "./services/emailTransport";

const router = Router();

function requireNoopTransport(req: AuthRequest, res: Response, next: NextFunction) {
  if (!isEmailTransportNoop()) {
    return res.status(404).json({ error: "Not found" });
  }
  next();
}

// SUPER_ADMIN only: the captured outbox is a single global, in-memory
// list across the whole process, so org-level admins must NOT be able to
// read other tenants' email content even on shared QA environments.
router.get(
  "/api/admin/dev/email-outbox",
  requireNoopTransport,
  requireAuth,
  requireRole("SUPER_ADMIN"),
  (_req: AuthRequest, res: Response) => {
    res.json({
      transport: "noop",
      messages: getTestEmailOutbox(),
    });
  },
);

router.delete(
  "/api/admin/dev/email-outbox",
  requireNoopTransport,
  requireAuth,
  requireRole("SUPER_ADMIN"),
  (_req: AuthRequest, res: Response) => {
    clearTestEmailOutbox();
    res.json({ success: true });
  },
);

export default router;
