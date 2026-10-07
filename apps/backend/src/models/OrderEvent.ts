import {
  Schema,
  model,
  type HydratedDocument,
  type Model
} from "mongoose";
import mongoose from "mongoose";
import type { Types } from "mongoose";

import {
  OrderEventType,
  OrderStatus
} from "./enums.js";
import { enumValues } from "./shared/schemas.js";

export interface OrderEvent {
  orderId: string;
  tradeExecutionId: Types.ObjectId;
  eventType: OrderEventType;
  previousStatus?: OrderStatus;
  newStatus?: OrderStatus;
  rawEvent: Record<string, unknown>;
  eventTime: Date;
  createdAt: Date;
}

export type OrderEventDocument = HydratedDocument<OrderEvent>;

const orderEventSchema = new Schema<OrderEvent>(
  {
    orderId: {
      type: String,
      required: true,
      trim: true
    },
    tradeExecutionId: {
      type: Schema.Types.ObjectId,
      ref: "TradeExecution",
      required: true
    },
    eventType: {
      type: String,
      enum: enumValues(OrderEventType),
      required: true
    },
    previousStatus: {
      type: String,
      enum: enumValues(OrderStatus),
      required: false
    },
    newStatus: {
      type: String,
      enum: enumValues(OrderStatus),
      required: false
    },
    rawEvent: {
      type: Schema.Types.Mixed,
      required: true
    },
    eventTime: {
      type: Date,
      required: true
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false
  }
);

orderEventSchema.index({ orderId: 1, eventTime: -1 });

export const OrderEventModel =
  (mongoose.models.OrderEvent as Model<OrderEvent> | undefined) ??
  model<OrderEvent>("OrderEvent", orderEventSchema);
