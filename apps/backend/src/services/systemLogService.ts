import type { Types } from "mongoose";

import type { SystemLogCategory } from "../models/index.js";
import {
  SystemLogLevel,
  SystemLogModel
} from "../models/index.js";
import { logger } from "../utils/logger.js";
import { eventBus } from "./eventBus.js";

/**
 * Writes an audit entry to MongoDB, mirrors it to the process log, and pushes
 * it to connected dashboards. Audit failures are logged but never interrupt
 * trading.
 */
export const writeSystemLog = async (entry: {
  level: SystemLogLevel;
  category: SystemLogCategory;
  message: string;
  userId?: Types.ObjectId;
  metadata?: Record<string, unknown>;
}): Promise<void> => {
  const logMethod =
    entry.level === SystemLogLevel.Error || entry.level === SystemLogLevel.Fatal
      ? "error"
      : entry.level === SystemLogLevel.Warn
        ? "warn"
        : "info";
  logger[logMethod]({ category: entry.category, ...entry.metadata }, entry.message);

  try {
    await SystemLogModel.create(entry);
  } catch (error) {
    logger.error({ error }, "Failed to persist system log");
  }

  eventBus.publish({
    type: "log",
    data: {
      level: entry.level,
      category: entry.category,
      message: entry.message,
      metadata: entry.metadata,
      createdAt: new Date().toISOString()
    }
  });
};
