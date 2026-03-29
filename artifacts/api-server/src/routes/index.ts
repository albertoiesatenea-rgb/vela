import { Router, type IRouter } from "express";
import healthRouter from "./health";
import copilotRouter from "./copilot";
import arenaRouter from "./arena";

const router: IRouter = Router();

router.use(healthRouter);
router.use(copilotRouter);
router.use(arenaRouter);

export default router;
