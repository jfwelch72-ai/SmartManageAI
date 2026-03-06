import { Router } from "express";
import integrationConnectionRoutes from "./integrationConnectionRoutes";
import integrationSyncRoutes from "./integrationSyncRoutes";
import integrationWebhookRoutes from "./integrationWebhookRoutes";

const router = Router();

router.use(integrationConnectionRoutes);
router.use(integrationSyncRoutes);
router.use(integrationWebhookRoutes);

export default router;
