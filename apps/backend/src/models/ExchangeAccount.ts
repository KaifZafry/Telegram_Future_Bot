import { Schema, model, type HydratedDocument } from "mongoose";

import type { ExchangeProvider, ExchangeAccountStatus } from "../types/exchange.js";

export interface ExchangeAccount {
  ownerId: string;
  provider: ExchangeProvider;
  label: string;
  status: ExchangeAccountStatus;
  credentialsRef?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export type ExchangeAccountDocument = HydratedDocument<ExchangeAccount>;

const exchangeAccountSchema = new Schema<ExchangeAccount>(
  {
    ownerId: {
      type: String,
      required: true,
      index: true
    },
    provider: {
      type: String,
      enum: ["binance-futures"],
      required: true,
      index: true
    },
    label: {
      type: String,
      required: true,
      trim: true
    },
    status: {
      type: String,
      enum: ["active", "disabled", "pending"],
      default: "pending",
      required: true,
      index: true
    },
    credentialsRef: {
      type: String,
      required: false
    },
    metadata: {
      type: Schema.Types.Mixed,
      required: false
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

exchangeAccountSchema.index({ ownerId: 1, provider: 1, label: 1 }, { unique: true });

export const ExchangeAccountModel = model<ExchangeAccount>(
  "ExchangeAccount",
  exchangeAccountSchema
);
