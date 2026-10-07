import mongoose from "mongoose";

import { env } from "./env.js";
import { databaseModels } from "../models/index.js";
import { logger } from "../utils/logger.js";

export const connectMongo = async (): Promise<void> => {
  mongoose.set("strictQuery", true);

  await mongoose.connect(env.MONGODB_URI, {
    autoIndex: env.NODE_ENV !== "production"
  });

  logger.info(
    {
      database: mongoose.connection.name,
      host: mongoose.connection.host,
      readyState: mongoose.connection.readyState
    },
    "MongoDB connected"
  );
};

export const initializeDatabase = async (): Promise<void> => {
  await connectMongo();

  if (env.NODE_ENV === "production") {
    return;
  }

  await Promise.all(databaseModels.map((databaseModel) => databaseModel.syncIndexes()));
  logger.info(
    { modelCount: databaseModels.length },
    "MongoDB indexes synchronized"
  );
};

export const disconnectMongo = async (): Promise<void> => {
  if (mongoose.connection.readyState === mongoose.STATES.disconnected) {
    return;
  }

  await mongoose.disconnect();
  logger.info("MongoDB disconnected");
};

export const isMongoHealthy = (): boolean =>
  mongoose.connection.readyState === mongoose.STATES.connected;
