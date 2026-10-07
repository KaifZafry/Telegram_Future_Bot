import {
  Schema,
  model,
  type HydratedDocument,
  type Model
} from "mongoose";
import mongoose from "mongoose";
import type { Types } from "mongoose";

import {
  SignalSide,
  TradeCloseReason,
  TradeStatus
} from "./enums.js";
import {
  enumValues,
  nonNegativeNumberValidator,
  positiveNumberValidator,
  takeProfitSchema,
  tradeEntrySchema,
  validateTakeProfitAllocation,
  type TakeProfitTarget,
  type TradeEntry
} from "./shared/schemas.js";

export interface Trade {
  userId: Types.ObjectId;
  signalId: Types.ObjectId;
  symbol: string;
  side: SignalSide;
  status: TradeStatus;
  requestedEntry: TradeEntry;
  actualEntry?: number;
  totalQuantity: number;
  leverage: number;
  stopLoss: number;
  takeProfits: TakeProfitTarget[];
  openedAt?: Date;
  closedAt?: Date;
  realizedPnL: number;
  fees: number;
  netPnL: number;
  closeReason?: TradeCloseReason;
  createdAt: Date;
  updatedAt: Date;
}

export type TradeDocument = HydratedDocument<Trade>;

const tradeSchema = new Schema<Trade>(
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
    status: {
      type: String,
      enum: enumValues(TradeStatus),
      default: TradeStatus.Pending,
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
    totalQuantity: {
      type: Number,
      required: true,
      validate: positiveNumberValidator
    },
    leverage: {
      type: Number,
      required: true,
      validate: positiveNumberValidator
    },
    stopLoss: {
      type: Number,
      required: true,
      validate: positiveNumberValidator
    },
    takeProfits: {
      type: [takeProfitSchema],
      default: [],
      validate: {
        validator: validateTakeProfitAllocation,
        message: "Total take-profit allocation cannot exceed 100%"
      }
    },
    openedAt: {
      type: Date,
      required: false
    },
    closedAt: {
      type: Date,
      required: false
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
    closeReason: {
      type: String,
      enum: enumValues(TradeCloseReason),
      required: false
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

tradeSchema.index({ userId: 1, openedAt: -1 });
tradeSchema.index({ userId: 1, status: 1 });
tradeSchema.index({ signalId: 1 });

export const TradeModel =
  (mongoose.models.Trade as Model<Trade> | undefined) ??
  model<Trade>("Trade", tradeSchema);
