import { Schema } from "mongoose";

import { EntryType } from "../enums.js";

export interface TakeProfitTarget {
  price: number;
  allocationPercentage: number;
}

export interface TradeEntry {
  type: EntryType;
  price?: number;
  minPrice?: number;
  maxPrice?: number;
}

export const enumValues = <T extends Record<string, string>>(enumObject: T): string[] =>
  Object.values(enumObject);

export const isPositiveNumber = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  (typeof value === "number" && Number.isFinite(value) && value > 0);

export const isNonNegativeNumber = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  (typeof value === "number" && Number.isFinite(value) && value >= 0);

export const validateTakeProfitAllocation = (
  takeProfits?: TakeProfitTarget[]
): boolean => {
  if (!takeProfits) {
    return true;
  }

  return (
    takeProfits.reduce(
      (total, takeProfit) => total + takeProfit.allocationPercentage,
      0
    ) <= 100
  );
};

export const positiveNumberValidator = {
  validator: isPositiveNumber,
  message: "{PATH} must be a positive number"
};

export const nonNegativeNumberValidator = {
  validator: isNonNegativeNumber,
  message: "{PATH} must be zero or a positive number"
};

export const takeProfitSchema = new Schema<TakeProfitTarget>(
  {
    price: {
      type: Number,
      required: true,
      validate: positiveNumberValidator
    },
    allocationPercentage: {
      type: Number,
      required: true,
      min: [0, "allocationPercentage must be between 0 and 100"],
      max: [100, "allocationPercentage must be between 0 and 100"]
    }
  },
  {
    _id: false,
    versionKey: false
  }
);

export const tradeEntrySchema = new Schema<TradeEntry>(
  {
    type: {
      type: String,
      enum: enumValues(EntryType),
      required: true
    },
    price: {
      type: Number,
      required: false,
      validate: positiveNumberValidator
    },
    minPrice: {
      type: Number,
      required: false,
      validate: positiveNumberValidator
    },
    maxPrice: {
      type: Number,
      required: false,
      validate: positiveNumberValidator
    }
  },
  {
    _id: false,
    versionKey: false
  }
);

tradeEntrySchema.pre("validate", function validateEntryShape(next) {
  const entry = this as TradeEntry;

  if (entry.type === EntryType.Limit && entry.price === undefined) {
    next(new Error("LIMIT entry requires price"));
    return;
  }

  if (entry.type === EntryType.EntryRange) {
    if (entry.minPrice === undefined || entry.maxPrice === undefined) {
      next(new Error("ENTRY_RANGE requires minPrice and maxPrice"));
      return;
    }

    if (entry.minPrice >= entry.maxPrice) {
      next(new Error("ENTRY_RANGE minPrice must be below maxPrice"));
      return;
    }
  }

  next();
});
