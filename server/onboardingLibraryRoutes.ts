import { logError } from "./utils/logger";
import { Router, type Request, type Response, type NextFunction } from "express";
import { requireAuth, type AuthRequest } from "./auth";
import { db } from "./db";
import { organizations } from "@shared/schema";
import { eq } from "drizzle-orm";
import { getLibraryTradeIdsForLegacy } from "@shared/tradeTypeUtils";
import {
  getTrades,
  getTradeById,
  getTradesByCategory,
  getTradeCategories,
  getScopes,
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

router.get("/api/onboarding-library/for-org", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthRequest;
    const organizationId = authReq.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const [org] = await db
      .select({ tradeType: organizations.tradeType })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

    if (!org) {
      return res.status(404).json({ error: "Organization not found" });
    }

    const tradeType = org.tradeType || "GENERAL_CONTRACTOR";
    const isGC = tradeType === "GENERAL_CONTRACTOR";

    let filteredTrades;
    let filteredScopes;
    let filteredComponents: any[] = [];

    if (isGC) {
      filteredTrades = getTrades();
      filteredScopes = getScopes();
      filteredTrades.forEach(t => {
        const comps = getComponentsByTradeId(t.trade_id);
        comps.forEach(c => {
          filteredComponents.push({
            ...c,
            trade_id: t.trade_id,
            trade_name: t.trade_name,
            variants: getVariantsByComponentId(c.component_id)?.variants || [],
          });
        });
      });
    } else {
      let libraryTradeIds = getLibraryTradeIdsForLegacy(tradeType);
      if (libraryTradeIds.length === 0) {
        libraryTradeIds = getLibraryTradeIdsForLegacy("OTHER");
      }
      if (libraryTradeIds.length === 0) {
        filteredTrades = getTrades();
        filteredScopes = getScopes();
        filteredTrades.forEach(t => {
          const comps = getComponentsByTradeId(t.trade_id);
          comps.forEach(c => {
            filteredComponents.push({
              ...c,
              trade_id: t.trade_id,
              trade_name: t.trade_name,
              variants: getVariantsByComponentId(c.component_id)?.variants || [],
            });
          });
        });
      }
      if (libraryTradeIds.length > 0) {
        filteredTrades = libraryTradeIds
          .map(id => getTradeById(id))
          .filter((t): t is NonNullable<typeof t> => !!t);
        filteredScopes = libraryTradeIds.flatMap(id => getScopesByTradeId(id));
        libraryTradeIds.forEach(id => {
          const trade = getTradeById(id);
          const comps = getComponentsByTradeId(id);
          comps.forEach(c => {
            filteredComponents.push({
              ...c,
              trade_id: id,
              trade_name: trade?.trade_name || id,
              variants: getVariantsByComponentId(c.component_id)?.variants || [],
            });
          });
        });
      }
    }

    const { groups, materials: allMaterials } = (() => {
      const scopeMaterialFamilies = new Set<string>();
      filteredScopes.forEach(s => {
        s.material_families.forEach(mf => scopeMaterialFamilies.add(mf));
      });

      if (isGC || scopeMaterialFamilies.size === 0) {
        return { groups: getMaterialGroups(), materials: getMaterials() };
      }

      const allMats = getMaterials();
      const filtered = allMats.filter(m =>
        scopeMaterialFamilies.has(m.material_family_id) ||
        scopeMaterialFamilies.has(m.group)
      );
      const grps = [...new Set(filtered.map(m => m.group))].sort();
      return { groups: grps, materials: filtered.length > 0 ? filtered : allMats };
    })();

    res.json({
      tradeType,
      trades: filteredTrades,
      scopes: filteredScopes,
      components: filteredComponents,
      materials: { groups, materials: allMaterials },
    });
  } catch (error: any) {
    next(error);
  }
});

router.get("/api/onboarding-library/integrity", requireAuth, (_req: Request, res: Response) => {
  const result = validateLibraryIntegrity();
  res.json(result);
});

export default router;
