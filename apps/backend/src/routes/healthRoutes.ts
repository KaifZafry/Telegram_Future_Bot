import { Router } from "express";

import { getHealth } from "../controllers/healthController.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const healthRouter = Router();

healthRouter.get("/", asyncHandler(getHealth));
