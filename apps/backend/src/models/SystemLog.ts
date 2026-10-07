import {
  Schema,
  model,
  type HydratedDocument,
  type Model
} from "mongoose";
import mongoose from "mongoose";
import type { Types } from "mongoose";

import {
  SystemLogCategory,
  SystemLogLevel
} from "./enums.js";
import { enumValues } from "./shared/schemas.js";

export interface SystemLog {
  userId?: Types.ObjectId;
  level: SystemLogLevel;
  category: SystemLogCategory;
  message: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export type SystemLogDocument = HydratedDocument<SystemLog>;

const systemLogSchema = new Schema<SystemLog>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
      index: true
    },
    level: {
      type: String,
      enum: enumValues(SystemLogLevel),
      required: true,
      index: true
    },
    category: {
      type: String,
      enum: enumValues(SystemLogCategory),
      required: true,
      index: true
    },
    message: {
      type: String,
      required: true,
      trim: true
    },
    metadata: {
      type: Schema.Types.Mixed,
      required: false
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false
  }
);

systemLogSchema.index({ createdAt: -1 });
systemLogSchema.index({ userId: 1, createdAt: -1 });

export const SystemLogModel =
  (mongoose.models.SystemLog as Model<SystemLog> | undefined) ??
  model<SystemLog>("SystemLog", systemLogSchema);
