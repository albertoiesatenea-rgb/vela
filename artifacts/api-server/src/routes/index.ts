import { Router, type IRouter } from "express";
import healthRouter  from "./health";
import copilotRouter from "./copilot";
import arenaRouter   from "./arena";
import debugRouter   from "./debug";

const router: IRouter = Router();

router.use(healthRouter);
router.use(copilotRouter);
router.use(arenaRouter);
router.use(debugRouter);

export default router;
