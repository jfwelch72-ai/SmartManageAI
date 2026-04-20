import { Router } from "express";
import { z } from "zod";
import crypto from "crypto";
import { db } from "./db";
import { crmQuotes, crmQuoteLineItems, crmQuoteAcceptanceTokens, crmOpportunities, organizations, crmOrganisationNotes, crmOpportunityActivities } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import rateLimit from "express-rate-limit";

const router = Router();

const acceptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function loadByToken(token: string) {
  const tokenHash = hashToken(token);
  const [tok] = await db.select().from(crmQuoteAcceptanceTokens).where(eq(crmQuoteAcceptanceTokens.tokenHash, tokenHash)).limit(1);
  if (!tok) return null;
  if (tok.expiresAt < new Date() && tok.status === "PENDING") {
    await db.update(crmQuoteAcceptanceTokens).set({ status: "EXPIRED" }).where(eq(crmQuoteAcceptanceTokens.id, tok.id));
    tok.status = "EXPIRED";
  }
  return tok;
}

// GET /api/public/quotes/accept/:token — load quote details (also marks as VIEWED)
router.get("/api/public/quotes/accept/:token", acceptLimiter, async (req, res, next) => {
  try {
    const tok = await loadByToken(req.params.token);
    if (!tok) return res.status(404).json({ error: "Invalid or expired link" });

    const [quote] = await db.select().from(crmQuotes).where(eq(crmQuotes.id, tok.quoteId)).limit(1);
    if (!quote) return res.status(404).json({ error: "Quote not found" });
    const items = await db.select().from(crmQuoteLineItems).where(eq(crmQuoteLineItems.quoteId, quote.id));
    const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, tok.organizationId)).limit(1);

    if (tok.status === "PENDING") {
      await db.update(crmQuoteAcceptanceTokens).set({ status: "VIEWED", viewedAt: new Date() }).where(eq(crmQuoteAcceptanceTokens.id, tok.id));
    }

    res.json({
      status: tok.status === "PENDING" ? "VIEWED" : tok.status,
      expiresAt: tok.expiresAt,
      organization: { name: org?.name ?? "" },
      quote: {
        id: quote.id, quoteNumber: quote.quoteNumber, title: quote.title, status: quote.status,
        validUntil: quote.validUntil, subtotal: quote.subtotal, taxRate: quote.taxRate, taxAmount: quote.taxAmount,
        discountAmount: quote.discountAmount, totalAmount: quote.totalAmount, notes: quote.notes, terms: quote.terms,
      },
      lineItems: items,
      decision: { signedName: tok.signedName, signedEmail: tok.signedEmail, decidedAt: tok.decidedAt, declineReason: tok.declineReason },
    });
  } catch (e) { next(e); }
});

const decisionSchema = z.object({
  decision: z.enum(["ACCEPT", "DECLINE"]),
  signedName: z.string().min(2).max(120),
  signedEmail: z.string().email().max(200).optional().nullable(),
  declineReason: z.string().max(2000).optional().nullable(),
  consent: z.literal(true),
});

router.post("/api/public/quotes/accept/:token", acceptLimiter, async (req, res, next) => {
  try {
    const parsed = decisionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });

    const tok = await loadByToken(req.params.token);
    if (!tok) return res.status(404).json({ error: "Invalid or expired link" });
    if (tok.status === "ACCEPTED" || tok.status === "DECLINED") return res.status(409).json({ error: "Quote already decided" });
    if (tok.status === "EXPIRED") return res.status(410).json({ error: "Link expired" });

    const newStatus = parsed.data.decision === "ACCEPT" ? "ACCEPTED" : "DECLINED";
    await db.update(crmQuoteAcceptanceTokens).set({
      status: newStatus,
      decidedAt: new Date(),
      signedName: parsed.data.signedName,
      signedEmail: parsed.data.signedEmail ?? null,
      declineReason: parsed.data.declineReason ?? null,
      ipAddress: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
    }).where(eq(crmQuoteAcceptanceTokens.id, tok.id));

    if (newStatus === "ACCEPTED") {
      await db.update(crmQuotes).set({ status: "ACCEPTED", acceptedAt: new Date(), updatedAt: new Date() }).where(eq(crmQuotes.id, tok.quoteId));
      const [quote] = await db.select().from(crmQuotes).where(eq(crmQuotes.id, tok.quoteId)).limit(1);
      if (quote?.opportunityId) {
        await db.update(crmOpportunities).set({
          stage: "WON",
          wonAt: new Date(),
          updatedAt: new Date(),
        }).where(and(eq(crmOpportunities.id, quote.opportunityId), eq(crmOpportunities.organizationId, tok.organizationId)));
        await db.insert(crmOpportunityActivities).values({
          opportunityId: quote.opportunityId,
          activityType: "NOTE",
          description: `Quote ${quote.quoteNumber} accepted by ${parsed.data.signedName} via signed link.`,
        });
      }
    } else {
      await db.update(crmQuotes).set({ status: "DECLINED", updatedAt: new Date() }).where(eq(crmQuotes.id, tok.quoteId));
      const [quote] = await db.select().from(crmQuotes).where(eq(crmQuotes.id, tok.quoteId)).limit(1);
      if (quote?.opportunityId) {
        await db.insert(crmOpportunityActivities).values({
          opportunityId: quote.opportunityId,
          activityType: "NOTE",
          description: `Quote ${quote.quoteNumber} declined by ${parsed.data.signedName}${parsed.data.declineReason ? `: ${parsed.data.declineReason}` : ""}.`,
        });
      }
    }

    res.json({ ok: true, status: newStatus });
  } catch (e) { next(e); }
});

export { hashToken };
export default router;
