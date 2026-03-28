import { Router, type IRouter } from "express";
import healthRouter from "./health";
import copilotRouter from "./copilot";

const router: IRouter = Router();

router.use(healthRouter);
router.use(copilotRouter);

export default router;
