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
  subscribeToCapturedEmails,
  type CapturedEmail,
} from "./services/emailTransport";
import { logWarn } from "./utils/logger";

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

// SSE: push captured emails to subscribed admin clients in real-time.
// Same SUPER_ADMIN gating as the JSON endpoint above — the outbox is a
// shared, process-global list so no tenant should ever see another's
// captures even in QA.
router.get(
  "/api/admin/dev/email-outbox/stream",
  requireNoopTransport,
  requireAuth,
  requireRole("SUPER_ADMIN"),
  (req: AuthRequest, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const send = (event: string, data: unknown) => {
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        logWarn("[email:noop] SSE write failed");
      }
    };

    // Send a snapshot of the current outbox so newly-connected clients
    // don't have to make a separate GET first.
    send("snapshot", { messages: getTestEmailOutbox() });

    const unsubscribe = subscribeToCapturedEmails((email: CapturedEmail) => {
      send("captured", email);
    });

    const pingInterval = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        clearInterval(pingInterval);
      }
    }, 25_000);

    req.on("close", () => {
      clearInterval(pingInterval);
      unsubscribe();
    });
  },
);

export default router;
