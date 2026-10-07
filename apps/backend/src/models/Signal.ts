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
  ParseStatus,
  SignalSide,
  SignalStatus,
  ValidationStatus
} from "./enums.js";
import {
  enumValues,
  positiveNumberValidator,
  takeProfitSchema,
  tradeEntrySchema,
  validateTakeProfitAllocation,
  type TakeProfitTarget,
  type TradeEntry
} from "./shared/schemas.js";

export interface Signal {
  userId: Types.ObjectId;
  telegramSourceId: Types.ObjectId;
  telegramMessageId: string;
  rawText: string;
  telegramSender?: {
    id?: string;
    username?: string;
    firstName?: string;
    lastName?: string;
    isBot?: boolean;
  };
  symbol?: string;
  side?: SignalSide;
  entry?: TradeEntry;
  leverage?: number;
  marginType?: MarginType;
  stopLoss?: number;
  takeProfits: TakeProfitTarget[];
  status: SignalStatus;
  parseStatus: ParseStatus;
  validationStatus: ValidationStatus;
  parseError?: {
    code: string;
    message: string;
  };
  rejectionReason?: string;
  receivedAt: Date;
  parsedAt?: Date;
  validatedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type SignalDocument = HydratedDocument<Signal>;

const signalSchema = new Schema<Signal>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    telegramSourceId: {
      type: Schema.Types.ObjectId,
      ref: "TelegramSource",
      required: true
    },
    telegramMessageId: {
      type: String,
      required: true,
      trim: true
    },
    rawText: {
      type: String,
      required: true
    },
    telegramSender: {
      id: {
        type: String,
        required: false
      },
      username: {
        type: String,
        required: false,
        trim: true
      },
      firstName: {
        type: String,
        required: false,
        trim: true
      },
      lastName: {
        type: String,
        required: false,
        trim: true
      },
      isBot: {
        type: Boolean,
        required: false
      }
    },
    symbol: {
      type: String,
      required: false,
      uppercase: true,
      trim: true
    },
    side: {
      type: String,
      enum: enumValues(SignalSide),
      required: false
    },
    entry: {
      type: tradeEntrySchema,
      required: false
    },
    leverage: {
      type: Number,
      required: false,
      validate: positiveNumberValidator
    },
    marginType: {
      type: String,
      enum: enumValues(MarginType),
      required: false
    },
    stopLoss: {
      type: Number,
      required: false,
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
    status: {
      type: String,
      enum: enumValues(SignalStatus),
      default: SignalStatus.Received,
      required: true
    },
    parseStatus: {
      type: String,
      enum: enumValues(ParseStatus),
      default: ParseStatus.Pending,
      required: true
    },
    validationStatus: {
      type: String,
      enum: enumValues(ValidationStatus),
      default: ValidationStatus.Pending,
      required: true
    },
    parseError: {
      code: {
        type: String,
        required: false,
        trim: true
      },
      message: {
        type: String,
        required: false,
        trim: true
      }
    },
    rejectionReason: {
      type: String,
      required: false,
      trim: true
    },
    receivedAt: {
      type: Date,
      default: () => new Date(),
      required: true
    },
    parsedAt: {
      type: Date,
      required: false
    },
    validatedAt: {
      type: Date,
      required: false
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

signalSchema.index({ userId: 1, receivedAt: -1 });
signalSchema.index(
  { telegramSourceId: 1, telegramMessageId: 1 },
  { unique: true }
);
signalSchema.index({ symbol: 1, receivedAt: -1 });
signalSchema.index({ status: 1 });

export const SignalModel =
  (mongoose.models.Signal as Model<Signal> | undefined) ??
  model<Signal>("Signal", signalSchema);
