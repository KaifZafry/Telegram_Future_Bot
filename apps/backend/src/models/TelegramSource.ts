import {
  Schema,
  model,
  type HydratedDocument,
  type Model
} from "mongoose";
import mongoose from "mongoose";
import type { Types } from "mongoose";

import { TelegramChatType } from "./enums.js";
import { enumValues } from "./shared/schemas.js";

export interface TelegramSource {
  userId: Types.ObjectId;
  name: string;
  chatId: string;
  chatType: TelegramChatType;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type TelegramSourceDocument = HydratedDocument<TelegramSource>;

const telegramSourceSchema = new Schema<TelegramSource>(
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
    chatId: {
      type: String,
      required: true,
      trim: true
    },
    chatType: {
      type: String,
      enum: enumValues(TelegramChatType),
      required: true
    },
    isActive: {
      type: Boolean,
      default: true,
      required: true,
      index: true
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

telegramSourceSchema.index({ userId: 1, chatId: 1 }, { unique: true });

export const TelegramSourceModel =
  (mongoose.models.TelegramSource as Model<TelegramSource> | undefined) ??
  model<TelegramSource>("TelegramSource", telegramSourceSchema);
