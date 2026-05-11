// Task #2780 — In-app demo request form backend.
// POST /api/demo/request — unauthenticated, rate-limited.
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { sendEmail } from "./email";
import { logError, logInfo } from "./utils/logger";
import rateLimit from "express-rate-limit";
import { PgExpressRateLimitStore } from "./utils/expressRateLimitPgStore";

function escHtml(str: string | undefined | null): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

const router = Router();

const demoLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: "Too many demo requests. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  store: process.env.RATE_LIMIT_USE_MEMORY_STORE === "1"
    ? undefined
    : new PgExpressRateLimitStore("demo_request"),
});

const demoRequestSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  company: z.string().min(1).max(200).trim(),
  email: z.string().email().max(255).trim().toLowerCase(),
  phone: z.string().max(50).trim().optional(),
  preferredTime: z.string().max(200).trim().optional(),
  notes: z.string().max(2000).trim().optional(),
});

router.post("/api/demo/request", demoLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = demoRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request data", details: parsed.error.flatten() });
    }

    const { name, company, email, phone, preferredTime, notes } = parsed.data;

    await db.execute(sql`
      INSERT INTO demo_requests (name, company, email, phone, preferred_time, notes, org_source)
      VALUES (
        ${name}, ${company}, ${email},
        ${phone ?? null}, ${preferredTime ?? null},
        ${notes ?? null}, ${"landing_page"}
      )
    `);

    logInfo("demo_request submitted", { email, company });

    const adminEmail = process.env.DEMO_REQUESTS_EMAIL || process.env.SUPPORT_REPORT_RECIPIENTS;
    if (adminEmail) {
      try {
        await sendEmail({
          to: adminEmail.split(",")[0].trim(),
          subject: `New Demo Request: ${name} from ${company}`,
          html: `
            <h2>New Demo Request</h2>
            <p><strong>Name:</strong> ${escHtml(name)}</p>
            <p><strong>Company:</strong> ${escHtml(company)}</p>
            <p><strong>Email:</strong> ${escHtml(email)}</p>
            ${phone ? `<p><strong>Phone:</strong> ${escHtml(phone)}</p>` : ""}
            ${preferredTime ? `<p><strong>Preferred Time:</strong> ${escHtml(preferredTime)}</p>` : ""}
            ${notes ? `<p><strong>Notes:</strong> ${escHtml(notes)}</p>` : ""}
          `,
        });
      } catch (emailErr) {
        logError("demo_request admin notify failed", {}, emailErr instanceof Error ? emailErr : new Error(String(emailErr)));
      }
    }

    try {
      await sendEmail({
        to: email,
        subject: "Your SmartManageAI Demo Request Received",
        html: `
          <h2>Thanks, ${escHtml(name)}!</h2>
          <p>We received your request for a live demo of SmartManageAI. Our team will reach out to you at ${escHtml(email)} within 1 business day to schedule your demo.</p>
          ${preferredTime ? `<p>Your preferred time slot: <strong>${escHtml(preferredTime)}</strong></p>` : ""}
          <p>In the meantime, feel free to explore our platform by starting a free trial at <a href="https://smartmanageai.com/register">smartmanageai.com/register</a>.</p>
          <p>— The SmartManageAI Team</p>
        `,
      });
    } catch (confirmErr) {
      logError("demo_request confirmation email failed", { email }, confirmErr instanceof Error ? confirmErr : new Error(String(confirmErr)));
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
