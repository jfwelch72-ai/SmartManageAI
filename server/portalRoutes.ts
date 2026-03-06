import { Router } from "express";
import portalDocumentRoutes from "./portalDocumentRoutes";
import portalTokenRoutes from "./portalTokenRoutes";
import portalActivityRoutes from "./portalActivityRoutes";

const router = Router();

router.use(portalDocumentRoutes);
router.use(portalTokenRoutes);
router.use(portalActivityRoutes);

export default router;
