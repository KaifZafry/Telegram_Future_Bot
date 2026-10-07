import mongoose, { Schema, model, type HydratedDocument, type Model } from "mongoose";

import { UserRole } from "./enums.js";
import { enumValues } from "./shared/schemas.js";

export interface User {
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type UserDocument = HydratedDocument<User>;

const userSchema = new Schema<User>(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      unique: true,
      index: true
    },
    passwordHash: {
      type: String,
      required: true,
      select: false
    },
    role: {
      type: String,
      enum: enumValues(UserRole),
      default: UserRole.User,
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

export const UserModel =
  (mongoose.models.User as Model<User> | undefined) ??
  model<User>("User", userSchema);
