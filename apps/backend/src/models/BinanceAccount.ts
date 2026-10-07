import {
  Schema,
  model,
  type HydratedDocument,
  type Model
} from "mongoose";
import mongoose from "mongoose";
import type { Types } from "mongoose";

import {
  BinanceEnvironment,
  BinancePermission
} from "./enums.js";
import { enumValues } from "./shared/schemas.js";

export interface BinanceAccount {
  userId: Types.ObjectId;
  name: string;
  apiKeyEncrypted: string;
  apiSecretEncrypted: string;
  isActive: boolean;
  environment: BinanceEnvironment;
  permissions: BinancePermission[];
  createdAt: Date;
  updatedAt: Date;
}

export type BinanceAccountDocument = HydratedDocument<BinanceAccount>;

const binanceAccountSchema = new Schema<BinanceAccount>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    apiKeyEncrypted: {
      type: String,
      required: true,
      select: false
    },
    apiSecretEncrypted: {
      type: String,
      required: true,
      select: false
    },
    isActive: {
      type: Boolean,
      default: true,
      required: true,
      index: true
    },
    environment: {
      type: String,
      enum: enumValues(BinanceEnvironment),
      default: BinanceEnvironment.Testnet,
      required: true
    },
    permissions: {
      type: [String],
      enum: enumValues(BinancePermission),
      default: [],
      required: true
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

binanceAccountSchema.index({ userId: 1, name: 1 }, { unique: true });

export const BinanceAccountModel =
  (mongoose.models.BinanceAccount as Model<BinanceAccount> | undefined) ??
  model<BinanceAccount>("BinanceAccount", binanceAccountSchema);
