import {
  Schema,
  model,
  type HydratedDocument,
  type Model
} from "mongoose";
import mongoose from "mongoose";
import type { Types } from "mongoose";

import {
  OrderRole,
  OrderSide,
  OrderStatus,
  OrderType,
  PositionSide
} from "./enums.js";
import {
  enumValues,
  nonNegativeNumberValidator,
  positiveNumberValidator
} from "./shared/schemas.js";

export interface Order {
  userId: Types.ObjectId;
  tradeExecutionId: Types.ObjectId;
  binanceAccountId: Types.ObjectId;
  symbol: string;
  orderId: string;
  clientOrderId: string;
  orderType: OrderType;
  side: OrderSide;
  positionSide: PositionSide;
  role: OrderRole;
  targetIndex?: number;
  isAlgo: boolean;
  closePosition: boolean;
  quantity?: number;
  price?: number;
  stopPrice?: number;
  reduceOnly: boolean;
  status: OrderStatus;
  filledQuantity: number;
  averageFillPrice?: number;
  realizedPnL: number;
  createdAt: Date;
  updatedAt: Date;
}

export type OrderDocument = HydratedDocument<Order>;

const orderSchema = new Schema<Order>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    tradeExecutionId: {
      type: Schema.Types.ObjectId,
      ref: "TradeExecution",
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
    orderId: {
      type: String,
      required: true,
      trim: true
    },
    clientOrderId: {
      type: String,
      required: true,
      trim: true
    },
    orderType: {
      type: String,
      enum: enumValues(OrderType),
      required: true
    },
    side: {
      type: String,
      enum: enumValues(OrderSide),
      required: true
    },
    positionSide: {
      type: String,
      enum: enumValues(PositionSide),
      required: true
    },
    role: {
      type: String,
      enum: enumValues(OrderRole),
      required: true
    },
    targetIndex: {
      type: Number,
      required: false,
      min: 0
    },
    isAlgo: {
      type: Boolean,
      default: false,
      required: true
    },
    closePosition: {
      type: Boolean,
      default: false,
      required: true
    },
    quantity: {
      type: Number,
      required: false,
      validate: positiveNumberValidator
    },
    price: {
      type: Number,
      required: false,
      validate: positiveNumberValidator
    },
    stopPrice: {
      type: Number,
      required: false,
      validate: positiveNumberValidator
    },
    reduceOnly: {
      type: Boolean,
      default: false,
      required: true
    },
    status: {
      type: String,
      enum: enumValues(OrderStatus),
      default: OrderStatus.New,
      required: true
    },
    filledQuantity: {
      type: Number,
      default: 0,
      required: true,
      validate: nonNegativeNumberValidator
    },
    averageFillPrice: {
      type: Number,
      required: false,
      validate: positiveNumberValidator
    },
    realizedPnL: {
      type: Number,
      default: 0,
      required: true
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

orderSchema.index({ orderId: 1 });
orderSchema.index({ clientOrderId: 1 });
orderSchema.index({ tradeExecutionId: 1, role: 1 });
orderSchema.index({ binanceAccountId: 1, status: 1 });

export const OrderModel =
  (mongoose.models.Order as Model<Order> | undefined) ??
  model<Order>("Order", orderSchema);
