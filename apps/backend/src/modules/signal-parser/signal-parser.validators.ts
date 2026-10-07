import {
  EntryType,
  SignalSide,
  type TakeProfitTarget,
  type TradeEntry
} from "../../models/index.js";
import type {
  NormalizedSignal,
  ParseResult,
  SignalParserErrorCode
} from "./signal-parser.types.js";

const failed = (
  errorCode: SignalParserErrorCode,
  errorMessage: string
): ParseResult => ({
  success: false,
  errorCode,
  errorMessage
});

const isPositive = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value) && value > 0;

const getEntryBounds = (entry: TradeEntry): { min: number; max: number } | undefined => {
  if (entry.type === EntryType.Market) {
    return undefined;
  }

  if (entry.type === EntryType.Limit && isPositive(entry.price)) {
    return {
      min: entry.price,
      max: entry.price
    };
  }

  if (
    entry.type === EntryType.EntryRange &&
    isPositive(entry.minPrice) &&
    isPositive(entry.maxPrice) &&
    entry.minPrice < entry.maxPrice
  ) {
    return {
      min: entry.minPrice,
      max: entry.maxPrice
    };
  }

  return undefined;
};

const validateTakeProfitAllocations = (
  takeProfits: TakeProfitTarget[]
): ParseResult | undefined => {
  if (
    takeProfits.some(
      (takeProfit) =>
        !Number.isFinite(takeProfit.allocationPercentage) ||
        takeProfit.allocationPercentage < 0 ||
        takeProfit.allocationPercentage > 100
    )
  ) {
    return failed(
      "INVALID_TP_ALLOCATION",
      "Take-profit allocations must be between 0 and 100"
    );
  }

  const totalAllocation = Number(
    takeProfits
      .reduce(
        (total, takeProfit) => total + takeProfit.allocationPercentage,
        0
      )
      .toFixed(2)
  );

  if (totalAllocation !== 100) {
    return failed(
      "INVALID_TP_ALLOCATION",
      "Take-profit allocation total must equal 100"
    );
  }

  return undefined;
};

const validateTakeProfitOrdering = (
  side: SignalSide,
  takeProfits: TakeProfitTarget[]
): ParseResult | undefined => {
  const sortedPrices = takeProfits.map((takeProfit) => takeProfit.price);

  for (let index = 1; index < sortedPrices.length; index += 1) {
    const previousPrice = sortedPrices[index - 1];
    const currentPrice = sortedPrices[index];

    if (previousPrice === undefined || currentPrice === undefined) {
      return failed("INVALID_TAKE_PROFIT", "Take-profit price is invalid");
    }

    if (side === SignalSide.Long && currentPrice <= previousPrice) {
      return failed(
        "INVALID_TAKE_PROFIT",
        "LONG take-profit targets must be ordered from low to high"
      );
    }

    if (side === SignalSide.Short && currentPrice >= previousPrice) {
      return failed(
        "INVALID_TAKE_PROFIT",
        "SHORT take-profit targets must be ordered from high to low"
      );
    }
  }

  return undefined;
};

export const validateNormalizedSignal = (
  signal: Partial<NormalizedSignal>
): ParseResult => {
  if (!signal.symbol) {
    return failed("MISSING_SYMBOL", "Symbol could not be detected");
  }

  if (!/^[A-Z0-9]{2,10}USDT$/.test(signal.symbol)) {
    return failed("INVALID_SYMBOL_FORMAT", "Symbol format is invalid");
  }

  if (!signal.side) {
    return failed("MISSING_SIDE", "Signal side could not be detected");
  }

  if (!signal.entry) {
    return failed("MISSING_ENTRY", "Entry could not be detected");
  }

  if (signal.entry.type !== EntryType.Market && !getEntryBounds(signal.entry)) {
    return failed("INVALID_ENTRY", "Entry price or range is invalid");
  }

  if (!isPositive(signal.stopLoss)) {
    return failed("MISSING_STOP_LOSS", "Stop loss could not be detected");
  }

  if (!signal.takeProfits || signal.takeProfits.length === 0) {
    return failed(
      "MISSING_TAKE_PROFIT",
      "At least one take-profit target is required"
    );
  }

  if (signal.takeProfits.some((takeProfit) => !isPositive(takeProfit.price))) {
    return failed(
      "INVALID_TAKE_PROFIT",
      "Take-profit targets must be positive prices"
    );
  }

  if (
    new Set(signal.takeProfits.map((takeProfit) => takeProfit.price)).size !==
    signal.takeProfits.length
  ) {
    return failed("INVALID_TAKE_PROFIT", "Duplicate take-profit prices detected");
  }

  if (signal.leverage !== undefined && !isPositive(signal.leverage)) {
    return failed("INVALID_LEVERAGE", "Leverage must be greater than zero");
  }

  const allocationValidation = validateTakeProfitAllocations(signal.takeProfits);
  if (allocationValidation) {
    return allocationValidation;
  }

  const orderingValidation = validateTakeProfitOrdering(
    signal.side,
    signal.takeProfits
  );
  if (orderingValidation) {
    return orderingValidation;
  }

  const entryBounds = getEntryBounds(signal.entry);

  if (entryBounds) {
    if (
      signal.side === SignalSide.Long &&
      (signal.stopLoss >= entryBounds.min ||
        signal.takeProfits.some(
          (takeProfit) => takeProfit.price <= entryBounds.max
        ))
    ) {
      return failed(
        "INVALID_PRICE_RELATIONSHIP",
        "LONG requires SL below entry and TP targets above entry"
      );
    }

    if (
      signal.side === SignalSide.Short &&
      (signal.stopLoss <= entryBounds.max ||
        signal.takeProfits.some(
          (takeProfit) => takeProfit.price >= entryBounds.min
        ))
    ) {
      return failed(
        "INVALID_PRICE_RELATIONSHIP",
        "SHORT requires SL above entry and TP targets below entry"
      );
    }
  }

  return {
    success: true,
    data: signal as NormalizedSignal
  };
};
