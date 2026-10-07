import {
  Schema,
  model,
  type HydratedDocument,
  type Model
} from "mongoose";
import mongoose from "mongoose";
import type { Types } from "mongoose";

import { nonNegativeNumberValidator } from "./shared/schemas.js";

export interface DailyStatistics {
  userId: Types.ObjectId;
  date: Date;
  totalSignals: number;
  executedSignals: number;
  rejectedSignals: number;
  winningTrades: number;
  losingTrades: number;
  breakevenTrades: number;
  totalPnL: number;
  totalFees: number;
  netPnL: number;
  winRate: number;
  createdAt: Date;
  updatedAt: Date;
}

export type DailyStatisticsDocument = HydratedDocument<DailyStatistics>;

const dailyStatisticsSchema = new Schema<DailyStatistics>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    date: {
      type: Date,
      required: true
    },
    totalSignals: {
      type: Number,
      default: 0,
      required: true,
      validate: nonNegativeNumberValidator
    },
    executedSignals: {
      type: Number,
      default: 0,
      required: true,
      validate: nonNegativeNumberValidator
    },
    rejectedSignals: {
      type: Number,
      default: 0,
      required: true,
      validate: nonNegativeNumberValidator
    },
    winningTrades: {
      type: Number,
      default: 0,
      required: true,
      validate: nonNegativeNumberValidator
    },
    losingTrades: {
      type: Number,
      default: 0,
      required: true,
      validate: nonNegativeNumberValidator
    },
    breakevenTrades: {
      type: Number,
      default: 0,
      required: true,
      validate: nonNegativeNumberValidator
    },
    totalPnL: {
      type: Number,
      default: 0,
      required: true
    },
    totalFees: {
      type: Number,
      default: 0,
      required: true,
      validate: nonNegativeNumberValidator
    },
    netPnL: {
      type: Number,
      default: 0,
      required: true
    },
    winRate: {
      type: Number,
      default: 0,
      required: true,
      min: [0, "winRate must be between 0 and 100"],
      max: [100, "winRate must be between 0 and 100"]
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

dailyStatisticsSchema.index({ userId: 1, date: 1 }, { unique: true });

export const DailyStatisticsModel =
  (mongoose.models.DailyStatistics as Model<DailyStatistics> | undefined) ??
  model<DailyStatistics>("DailyStatistics", dailyStatisticsSchema);
