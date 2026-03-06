import { Router } from "express";
import platformOrgRoutes from "./platformOrgRoutes";
import platformUserRoutes from "./platformUserRoutes";
import platformSubscriptionRoutes from "./platformSubscriptionRoutes";
import platformAuditRoutes from "./platformAuditRoutes";

const router = Router();

router.use(platformOrgRoutes);
router.use(platformUserRoutes);
router.use(platformSubscriptionRoutes);
router.use(platformAuditRoutes);

export default router;
