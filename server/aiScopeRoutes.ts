import { Router } from "express";
import { logInfo, logError } from "./utils/logger";
import { sensitiveLimiter } from "./rateLimiter";
import { type AuthRequest, requireAuth } from "./auth";

import { 
  discoverTradesFromDescription, 
  suggestTradesForBidDocument,
  getTradesWithSowCounts,
  getTradeModifierCategories,
  TRADE_CATEGORIES,
  ALL_TRADES
} from "./ai/tradeDiscoveryService";

import {
  predictRelevantScopeItems,
  searchScopeItems,
  getScopeItemsForTrade,
  suggestScopeFromBidDocument,
  getModifiersForScopeItem
} from "./ai/scopePredictionEngine";

const router = Router();

router.get("/ai/trades", requireAuth, async (req: AuthRequest, res) => {
  try {
    const tradesWithCounts = await getTradesWithSowCounts();
    
    res.json({
      trades: tradesWithCounts,
      categories: TRADE_CATEGORIES,
      allTrades: ALL_TRADES,
    });
  } catch (error: any) {
    logError(`[AI Trades] Error fetching trades: ${error.message}`);
    res.status(500).json({ error: "Failed to fetch trades" });
  }
});

router.post("/ai/trades/discover", sensitiveLimiter, requireAuth, async (req: AuthRequest, res) => {
  try {
    const { projectName, projectDescription, projectType, existingScope, bidDocumentExtracts } = req.body;

    if (!projectDescription && !bidDocumentExtracts?.length) {
      return res.status(400).json({ error: "Project description or bid document extracts required" });
    }

    const result = await discoverTradesFromDescription({
      projectName,
      projectDescription,
      projectType,
      existingScope,
      bidDocumentExtracts,
    }, { orgId: req.user.organizationId || "system", userId: req.user.id });

    logInfo(`[AI Trades] Trade discovery completed for user ${req.user.id} | primaryTrade: ${result.primaryTrade} | relatedTrades: ${result.relatedTrades.length}`);

    res.json(result);
  } catch (error: any) {
    if (error.message?.includes("limit reached") || error.message?.includes("blocked")) {
      return res.status(429).json({ error: error.message });
    }
    logError(`[AI Trades] Trade discovery error: ${error.message}`);
    res.status(500).json({ error: "Failed to discover trades" });
  }
});

router.post("/ai/scope/predict", sensitiveLimiter, requireAuth, async (req: AuthRequest, res) => {
  try {
    const { tradeType, projectDescription, projectType, estimatedValue, existingScopeItems, relatedTrades, limit } = req.body;

    if (!tradeType) {
      return res.status(400).json({ error: "Trade type is required" });
    }

    const result = await predictRelevantScopeItems({
      tradeType,
      projectDescription,
      projectType,
      estimatedValue,
      existingScopeItems,
      relatedTrades,
    }, limit || 20, { orgId: req.user.organizationId || "system", userId: req.user.id });

    logInfo(`[AI Scope] Scope prediction completed for user ${req.user.id} | trade: ${tradeType} | items: ${result.predictedItems.length} | completeness: ${result.completenessScore}`);

    res.json(result);
  } catch (error: any) {
    if (error.message?.includes("limit reached") || error.message?.includes("blocked")) {
      return res.status(429).json({ error: error.message });
    }
    logError(`[AI Scope] Scope prediction error: ${error.message}`);
    res.status(500).json({ error: "Failed to predict scope items" });
  }
});

router.get("/ai/scope/search", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { q, trades, limit } = req.query;

    if (!q || typeof q !== 'string') {
      return res.status(400).json({ error: "Search query is required" });
    }

    const tradeTypes = trades ? (trades as string).split(',') : undefined;
    const searchLimit = limit ? parseInt(limit as string, 10) : 50;

    const result = await searchScopeItems(
      q,
      tradeTypes,
      req.user.organizationId || undefined,
      searchLimit
    );

    res.json(result);
  } catch (error: any) {
    logError(`[AI Scope] Scope search error: ${error.message}`);
    res.status(500).json({ error: "Failed to search scope items" });
  }
});

router.get("/ai/scope/trade/:tradeType", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { tradeType } = req.params;

    const items = await getScopeItemsForTrade(
      tradeType,
      req.user.organizationId || undefined
    );

    res.json({ items, count: items.length });
  } catch (error: any) {
    logError(`[AI Scope] Error fetching trade scope items: ${error.message}`);
    res.status(500).json({ error: "Failed to fetch scope items for trade" });
  }
});

router.get("/ai/scope/modifiers/:tradeType", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { tradeType } = req.params;
    const { categoryId } = req.query;

    const modifiers = await getModifiersForScopeItem(
      tradeType,
      categoryId as string | undefined
    );

    res.json({ modifiers });
  } catch (error: any) {
    logError(`[AI Scope] Error fetching modifiers: ${error.message}`);
    res.status(500).json({ error: "Failed to fetch modifiers" });
  }
});

router.post("/ai/trades/modifiers", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { tradeTypes } = req.body;

    if (!tradeTypes || !Array.isArray(tradeTypes)) {
      return res.status(400).json({ error: "Trade types array is required" });
    }

    const result = await getTradeModifierCategories(tradeTypes);

    res.json(result);
  } catch (error: any) {
    logError(`[AI Scope] Error fetching trade modifiers: ${error.message}`);
    res.status(500).json({ error: "Failed to fetch trade modifiers" });
  }
});

router.post("/ai/scope/from-document", sensitiveLimiter, requireAuth, async (req: AuthRequest, res) => {
  try {
    const { documentText, tradeType, limit } = req.body;

    if (!documentText || !tradeType) {
      return res.status(400).json({ error: "Document text and trade type are required" });
    }

    const result = await suggestScopeFromBidDocument(
      documentText,
      tradeType,
      limit || 30,
      { orgId: req.user.organizationId || "system", userId: req.user.id }
    );

    logInfo(`[AI Scope] Scope from document completed for user ${req.user.id} | trade: ${tradeType} | items: ${result.predictedItems.length}`);

    res.json(result);
  } catch (error: any) {
    if (error.message?.includes("limit reached") || error.message?.includes("blocked")) {
      return res.status(429).json({ error: error.message });
    }
    logError(`[AI Scope] Scope from document error: ${error.message}`);
    res.status(500).json({ error: "Failed to suggest scope from document" });
  }
});

export default router;
