import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthRequest } from "./auth";
import {
  getDotPayItemPickerFacets,
  upsertDotPayItemPickerFacets,
} from "./storage";

/**
 * Task #1743 — REST surface for the device-syncing DOT pay-item picker
 * facet memory. Replaces the per-device
 * `dot-pay-item-picker:facets:<uid>:<specBookId>` localStorage key flagged
 * in docs/per-user-localstorage-audit.md.
 *
 * Both endpoints are scoped by `(req.user.id, :specBookId)` so a user can
 * only ever read or write their own facet selections.
 */
const router = Router();

// Cap each facet array to a reasonable upper bound. The picker UI itself is
// gated by the available facets returned by `/api/dot/pay-items/facets`,
// but the API has to defend against a hostile client persisting a giant
// array that would later be sent back to the picker on every open.
const MAX_FACET_ENTRIES = 256;
const MAX_FACET_VALUE_LENGTH = 256;

const facetStringList = z
  .array(z.string().min(1).max(MAX_FACET_VALUE_LENGTH))
  .max(MAX_FACET_ENTRIES);

const putBodySchema = z.object({
  categories: facetStringList,
  specSections: facetStringList,
});

router.get(
  "/api/dot/pay-item-picker/facets/:specBookId",
  requireAuth,
  async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user!.id;
      const specBookId = String(req.params.specBookId || "");
      if (!specBookId) {
        return res.status(400).json({ error: "specBookId is required" });
      }
      const row = await getDotPayItemPickerFacets(userId, specBookId);
      return res.json({
        specBookId,
        categories: row?.categories ?? [],
        specSections: row?.specSections ?? [],
      });
    } catch (err) {
      return next(err);
    }
  },
);

router.put(
  "/api/dot/pay-item-picker/facets/:specBookId",
  requireAuth,
  async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user!.id;
      const specBookId = String(req.params.specBookId || "");
      if (!specBookId) {
        return res.status(400).json({ error: "specBookId is required" });
      }
      const parsed = putBodySchema.parse(req.body);
      // De-duplicate while preserving first-seen order so the toggle UI
      // shows facets in the order the user picked them.
      const dedupe = (xs: string[]): string[] => {
        const seen = new Set<string>();
        const out: string[] = [];
        for (const x of xs) {
          if (!seen.has(x)) {
            seen.add(x);
            out.push(x);
          }
        }
        return out;
      };
      const categories = dedupe(parsed.categories);
      const specSections = dedupe(parsed.specSections);
      await upsertDotPayItemPickerFacets(userId, specBookId, categories, specSections);
      return res.json({ specBookId, categories, specSections });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res
          .status(400)
          .json({ error: "Invalid facets payload", details: err.errors });
      }
      return next(err);
    }
  },
);

export default router;
