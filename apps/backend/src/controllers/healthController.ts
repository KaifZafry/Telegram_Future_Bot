import type { Request, Response } from "express";

import { isMongoHealthy } from "../config/mongodb.js";
import { healthService } from "../services/healthService.js";
import { AppError } from "../utils/AppError.js";

export const getHealth = (_request: Request, response: Response): void => {
  if (!isMongoHealthy()) {
    throw new AppError("MongoDB connection is not healthy", 503, "DATABASE_UNAVAILABLE");
  }

  response.status(200).json(healthService.getHealthStatus());
};
