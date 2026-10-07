import {
  Schema,
  model,
  type HydratedDocument,
  type Model
} from "mongoose";
import mongoose from "mongoose";
import type { Types } from "mongoose";

import {
  MarginType,
  SignalSide,
  TradeCloseReason,
  TradeExecutionStatus
} from "./enums.js";
import {
  enumValues,
  nonNegativeNumberValidator,
  positiveNumberValidator,
  takeProfitSchema,
  tradeEntrySchema,
  type TakeProfitTarget,
  type TradeEntry
} from "./shared/schemas.js";

export interface TradeExecution {
  userId: Types.ObjectId;
  signalId: Types.ObjectId;
  tradeId: Types.ObjectId;
  binanceAccountId: Types.ObjectId;
  symbol: string;
  side: SignalSide;
  requestedEntry: TradeEntry;
  actualEntry?: number;
  quantity: number;
  leverage: number;
  marginType: MarginType;
  stopLoss: number;
  currentStopLoss: number;
  takeProfits: TakeProfitTarget[];
  slMovedToBreakeven: boolean;
  tpPlacedForQuantity: number;
  entryExpiresAt: Date;
  zeroPositionChecks: number;
  closeReason?: TradeCloseReason;
  lastSyncedAt?: Date;
  positionQuantity: number;
  markPrice?: number;
  unrealizedPnL: number;
  manualCloseRequested: boolean;
  status: TradeExecutionStatus;
  realizedPnL: number;
  fees: number;
  netPnL: number;
  errorCode?: string;
  errorMessage?: string;
  executedAt?: Date;
  closedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type TradeExecutionDocument = HydratedDocument<TradeExecution>;

const tradeExecutionSchema = new Schema<TradeExecution>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    signalId: {
      type: Schema.Types.ObjectId,
      ref: "Signal",
      required: true
    },
    tradeId: {
      type: Schema.Types.ObjectId,
      ref: "Trade",
      required: true
    },
    binanceAccountId: {
      type: Schema.Types.ObjectId,
      ref: "BinanceAccount",
      required: true
    },
    symbol: {
      type: String,
      required: true,
      uppercase: true,
      trim: true
    },
    side: {
      type: String,
      enum: enumValues(SignalSide),
      required: true
    },
    requestedEntry: {
      type: tradeEntrySchema,
      required: true
    },
    actualEntry: {
      type: Number,
      required: false,
      validate: positiveNumberValidator
    },
    quantity: {
      type: Number,
      required: true,
      validate: positiveNumberValidator
    },
    leverage: {
      type: Number,
      required: true,
      validate: positiveNumberValidator
    },
    marginType: {
      type: String,
      enum: enumValues(MarginType),
      default: MarginType.Cross,
      required: true
    },
    stopLoss: {
      type: Number,
      required: true,
      validate: positiveNumberValidator
    },
    currentStopLoss: {
      type: Number,
      required: true,
      validate: positiveNumberValidator
    },
    takeProfits: {
      type: [takeProfitSchema],
      default: []
    },
    slMovedToBreakeven: {
      type: Boolean,
      default: false,
      required: true
    },
    tpPlacedForQuantity: {
      type: Number,
      default: 0,
      required: true,
      validate: nonNegativeNumberValidator
    },
    entryExpiresAt: {
      type: Date,
      required: true
    },
    zeroPositionChecks: {
      type: Number,
      default: 0,
      required: true
    },
    closeReason: {
      type: String,
      enum: enumValues(TradeCloseReason),
      required: false
    },
    lastSyncedAt: {
      type: Date,
      required: false
    },
    positionQuantity: {
      type: Number,
      default: 0,
      required: true
    },
    markPrice: {
      type: Number,
      required: false
    },
    unrealizedPnL: {
      type: Number,
      default: 0,
      required: true
    },
    manualCloseRequested: {
      type: Boolean,
      default: false,
      required: true
    },
    status: {
      type: String,
      enum: enumValues(TradeExecutionStatus),
      default: TradeExecutionStatus.Pending,
      required: true
    },
    realizedPnL: {
      type: Number,
      default: 0,
      required: true
    },
    fees: {
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
    errorCode: {
      type: String,
      required: false,
      trim: true
    },
    errorMessage: {
      type: String,
      required: false,
      trim: true
    },
    executedAt: {
      type: Date,
      required: false
    },
    closedAt: {
      type: Date,
      required: false
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

tradeExecutionSchema.index({ tradeId: 1 });
tradeExecutionSchema.index({ binanceAccountId: 1, status: 1 });
tradeExecutionSchema.index({ status: 1 });
tradeExecutionSchema.index(
  { signalId: 1, binanceAccountId: 1 },
  { unique: true }
);

export const TradeExecutionModel =
  (mongoose.models.TradeExecution as Model<TradeExecution> | undefined) ??
  model<TradeExecution>("TradeExecution", tradeExecutionSchema);
