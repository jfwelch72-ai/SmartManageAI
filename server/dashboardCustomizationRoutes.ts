import { Router } from "express";
import dashboardLayoutRoutes from "./dashboardLayoutRoutes";
import dashboardPaletteRoutes from "./dashboardPaletteRoutes";

const router = Router();

router.use(dashboardLayoutRoutes);
router.use(dashboardPaletteRoutes);

export default router;
