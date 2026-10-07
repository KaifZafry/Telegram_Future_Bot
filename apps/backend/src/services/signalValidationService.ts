import {
  EntryType,
  SignalSide,
  type TakeProfitTarget,
  type TradeEntry
} from "../models/index.js";

interface EntryBounds {
  lower: number;
  upper: number;
}

export interface SignalPriceRelationshipInput {
  side: SignalSide;
  entry: TradeEntry;
  stopLoss: number;
  takeProfits: TakeProfitTarget[];
  marketPrice?: number;
}

export interface SignalPriceRelationshipResult {
  isValid: boolean;
  errors: string[];
}

const getEntryBounds = (
  entry: TradeEntry,
  marketPrice?: number
): EntryBounds | undefined => {
  if (entry.type === EntryType.Market) {
    return marketPrice === undefined
      ? undefined
      : {
          lower: marketPrice,
          upper: marketPrice
        };
  }

  if (entry.type === EntryType.Limit && entry.price !== undefined) {
    return {
      lower: entry.price,
      upper: entry.price
    };
  }

  if (
    entry.type === EntryType.EntryRange &&
    entry.minPrice !== undefined &&
    entry.maxPrice !== undefined
  ) {
    return {
      lower: entry.minPrice,
      upper: entry.maxPrice
    };
  }

  return undefined;
};

export const validateSignalPriceRelationships = (
  input: SignalPriceRelationshipInput
): SignalPriceRelationshipResult => {
  const entryBounds = getEntryBounds(input.entry, input.marketPrice);
  const errors: string[] = [];

  if (!entryBounds) {
    return {
      isValid: false,
      errors: ["Entry price context is required to validate TP/SL relationships"]
    };
  }

  if (input.side === SignalSide.Long) {
    if (input.stopLoss >= entryBounds.lower) {
      errors.push("LONG stop loss must be below entry");
    }

    if (
      input.takeProfits.some(
        (takeProfit) => takeProfit.price <= entryBounds.upper
      )
    ) {
      errors.push("LONG take-profit targets must be above entry");
    }
  }

  if (input.side === SignalSide.Short) {
    if (input.stopLoss <= entryBounds.upper) {
      errors.push("SHORT stop loss must be above entry");
    }

    if (
      input.takeProfits.some(
        (takeProfit) => takeProfit.price >= entryBounds.lower
      )
    ) {
      errors.push("SHORT take-profit targets must be below entry");
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};
