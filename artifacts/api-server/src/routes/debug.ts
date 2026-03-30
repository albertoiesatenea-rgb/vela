import { Router } from "express";
import { getUsageSnapshot } from "../lib/ai-tracker";

const router = Router();

router.get("/debug/usage", (_req, res) => {
  res.json(getUsageSnapshot());
});

export default router;
