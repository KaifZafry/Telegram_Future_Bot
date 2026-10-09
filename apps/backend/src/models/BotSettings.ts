import {
  Schema,
  model,
  type HydratedDocument,
  type Model
} from "mongoose";
import mongoose from "mongoose";
import type { Types } from "mongoose";

import {
  nonNegativeNumberValidator,
  positiveNumberValidator
} from "./shared/schemas.js";

export interface BotSettings {
  userId: Types.ObjectId;
  isEnabled: boolean;
  maxLeverage: number;
  maxDailyLoss: number;
  maxOpenTrades: number;
  maxEntryDeviationPercent: number;
  defaultRiskPercent: number;
  defaultMargin: number;
  defaultLeverage: number;
  entryOrderCount: number;
  entryTimeoutMinutes: number;
  requireApproval: boolean;
  followUpActions: boolean;
  approvalTimeoutSeconds: number;
  moveStopToBreakeven: boolean;
  allowedSymbols: string[];
  blockedSymbols: string[];
  createdAt: Date;
  updatedAt: Date;
}

export type BotSettingsDocument = HydratedDocument<BotSettings>;

const botSettingsSchema = new Schema<BotSettings>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true
    },
    isEnabled: {
      type: Boolean,
      default: false,
      required: true
    },
    maxLeverage: {
      type: Number,
      default: 20,
      required: true,
      validate: positiveNumberValidator
    },
    maxDailyLoss: {
      type: Number,
      default: 0,
      required: true,
      validate: nonNegativeNumberValidator
    },
    maxOpenTrades: {
      type: Number,
      default: 1,
      required: true,
      validate: positiveNumberValidator
    },
    maxEntryDeviationPercent: {
      type: Number,
      default: 0,
      required: true,
      validate: nonNegativeNumberValidator
    },
    defaultRiskPercent: {
      type: Number,
      default: 1,
      required: true,
      min: [0, "defaultRiskPercent must be between 0 and 100"],
      max: [100, "defaultRiskPercent must be between 0 and 100"]
    },
    defaultMargin: {
      type: Number,
      default: 0,
      required: true,
      validate: nonNegativeNumberValidator
    },
    defaultLeverage: {
      type: Number,
      default: 10,
      required: true,
      validate: positiveNumberValidator
    },
    entryOrderCount: {
      type: Number,
      default: 3,
      required: true,
      min: [1, "entryOrderCount must be between 1 and 10"],
      max: [10, "entryOrderCount must be between 1 and 10"]
    },
    entryTimeoutMinutes: {
      type: Number,
      default: 1440,
      required: true,
      validate: positiveNumberValidator
    },
    requireApproval: {
      type: Boolean,
      default: false,
      required: true
    },
    followUpActions: {
      type: Boolean,
      default: true,
      required: true
    },
    approvalTimeoutSeconds: {
      type: Number,
      default: 60,
      required: true,
      min: [10, "approvalTimeoutSeconds must be between 10 and 600"],
      max: [600, "approvalTimeoutSeconds must be between 10 and 600"]
    },
    moveStopToBreakeven: {
      type: Boolean,
      default: false,
      required: true
    },
    allowedSymbols: {
      type: [String],
      default: [],
      required: true
    },
    blockedSymbols: {
      type: [String],
      default: [],
      required: true
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

export const BotSettingsModel =
  (mongoose.models.BotSettings as Model<BotSettings> | undefined) ??
  model<BotSettings>("BotSettings", botSettingsSchema);
