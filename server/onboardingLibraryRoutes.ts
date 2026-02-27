import { Router, type Request, type Response } from "express";
import { requireAuth, type AuthRequest } from "./auth";
import {
  getTrades,
  getTradeById,
  getTradesByCategory,
  getTradeCategories,
  getScopesByTradeId,
  getComponentsByTradeId,
  getMaterials,
  getMaterialsByGroup,
  getMaterialGroups,
  getFormulas,
  getLineItemGrammar,
  getVariantsByComponentId,
  getCalibrationRate,
  validateLibraryIntegrity,
} from "./data/onboarding";

const router = Router();

router.get("/api/onboarding-library/trades", requireAuth, (req: Request, res: Response) => {
  const category = req.query.category as string | undefined;
  if (category) {
    return res.json(getTradesByCategory(category));
  }
  res.json({
    categories: getTradeCategories(),
    trades: getTrades(),
  });
});

router.get("/api/onboarding-library/trades/:tradeId", requireAuth, (req: Request, res: Response) => {
  const trade = getTradeById(req.params.tradeId);
  if (!trade) {
    return res.status(404).json({ error: "Trade not found" });
  }
  res.json(trade);
});

router.get("/api/onboarding-library/trades/:tradeId/scopes", requireAuth, (req: Request, res: Response) => {
  const trade = getTradeById(req.params.tradeId);
  if (!trade) {
    return res.status(404).json({ error: "Trade not found" });
  }
  res.json(getScopesByTradeId(req.params.tradeId));
});

router.get("/api/onboarding-library/trades/:tradeId/components", requireAuth, (req: Request, res: Response) => {
  const trade = getTradeById(req.params.tradeId);
  if (!trade) {
    return res.status(404).json({ error: "Trade not found" });
  }
  const components = getComponentsByTradeId(req.params.tradeId);
  res.json(components.map(c => ({
    ...c,
    variants: getVariantsByComponentId(c.component_id)?.variants || [],
  })));
});

router.get("/api/onboarding-library/materials", requireAuth, (req: Request, res: Response) => {
  const group = req.query.group as string | undefined;
  if (group) {
    return res.json(getMaterialsByGroup(group));
  }
  res.json({
    groups: getMaterialGroups(),
    materials: getMaterials(),
  });
});

router.get("/api/onboarding-library/formulas", requireAuth, (_req: Request, res: Response) => {
  res.json(getFormulas());
});

router.get("/api/onboarding-library/grammar", requireAuth, (_req: Request, res: Response) => {
  res.json(getLineItemGrammar());
});

router.get("/api/onboarding-library/calibration/:scopeId", requireAuth, (req: Request, res: Response) => {
  const rate = getCalibrationRate(req.params.scopeId);
  if (!rate) {
    return res.status(404).json({ error: "No calibration rate for this scope" });
  }
  res.json(rate);
});

router.get("/api/onboarding-library/integrity", requireAuth, (_req: Request, res: Response) => {
  const result = validateLibraryIntegrity();
  res.json(result);
});

export default router;
