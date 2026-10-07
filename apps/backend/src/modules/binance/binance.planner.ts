import {
  EntryType,
  SignalSide,
  type TakeProfitTarget,
  type TradeEntry
} from "../../models/index.js";
import { floorToStep, roundToStep } from "./binance.math.js";
import type { BinanceOrderSide, SymbolRules } from "./binance.types.js";

export interface EntryLeg {
  type: "MARKET" | "LIMIT";
  price?: string;
  quantity: string;
  /** Price used for sizing: the limit price, or the mark price for market legs. */
  referencePrice: number;
}

export interface ExecutionPlan {
  symbol: string;
  side: SignalSide;
  entrySide: BinanceOrderSide;
  exitSide: BinanceOrderSide;
  leverage: number;
  marginUsdt: number;
  notionalUsdt: number;
  averageEntryPrice: number;
  totalQuantity: number;
  legs: EntryLeg[];
  stopLoss: string;
  takeProfits: { price: string; allocationPercentage: number }[];
}

export interface PlanInput {
  symbol: string;
  side: SignalSide;
  entry: TradeEntry;
  stopLoss: number;
  takeProfits: TakeProfitTarget[];
  markPrice: number;
  marginUsdt: number;
  leverage: number;
  entryOrderCount: number;
  rules: SymbolRules;
}

export type PlanResult =
  | { ok: true; plan: ExecutionPlan }
  | { ok: false; reason: string };

const rejected = (reason: string): PlanResult => ({ ok: false, reason });

const getEntryPrices = (
  entry: TradeEntry,
  side: SignalSide,
  markPrice: number,
  count: number
): number[] => {
  if (entry.type === EntryType.Market) {
    return [markPrice];
  }

  if (entry.type === EntryType.Limit && entry.price !== undefined) {
    return [entry.price];
  }

  if (
    entry.type === EntryType.EntryRange &&
    entry.minPrice !== undefined &&
    entry.maxPrice !== undefined
  ) {
    // Start at the edge price reaches first (top of the range for a LONG,
    // bottom for a SHORT) and step towards the far edge.
    const near = side === SignalSide.Long ? entry.maxPrice : entry.minPrice;
    const far = side === SignalSide.Long ? entry.minPrice : entry.maxPrice;

    if (count === 1) {
      return [near];
    }

    return Array.from(
      { length: count },
      (_, index) => near + ((far - near) * index) / (count - 1)
    );
  }

  return [];
};

const isMarketable = (side: SignalSide, price: number, markPrice: number): boolean =>
  side === SignalSide.Long ? price >= markPrice : price <= markPrice;

const buildLegs = (
  input: PlanInput,
  count: number
): { legs: EntryLeg[]; averageEntryPrice: number } | undefined => {
  const { rules, side, markPrice } = input;
  const prices = getEntryPrices(input.entry, side, markPrice, count);

  if (prices.length === 0) {
    return undefined;
  }

  const effectivePrices = prices.map((price) =>
    isMarketable(side, price, markPrice) ? markPrice : price
  );
  const averageEntryPrice =
    effectivePrices.reduce((total, price) => total + price, 0) / effectivePrices.length;
  const totalQuantity = (input.marginUsdt * input.leverage) / averageEntryPrice;
  const legQuantity = Number(floorToStep(totalQuantity / prices.length, rules.stepSize));

  let marketQuantity = 0;
  const limitLegs: EntryLeg[] = [];

  prices.forEach((price) => {
    if (isMarketable(side, price, markPrice) || input.entry.type === EntryType.Market) {
      marketQuantity += legQuantity;
      return;
    }

    limitLegs.push({
      type: "LIMIT",
      price: roundToStep(price, rules.tickSize),
      quantity: floorToStep(legQuantity, rules.stepSize),
      referencePrice: price
    });
  });

  const legs: EntryLeg[] = [
    ...(marketQuantity > 0
      ? [
          {
            type: "MARKET" as const,
            quantity: floorToStep(marketQuantity, rules.marketStepSize),
            referencePrice: markPrice
          }
        ]
      : []),
    ...limitLegs
  ];

  const meetsExchangeMinimums = legs.every((leg) => {
    const quantity = Number(leg.quantity);
    const minQty = leg.type === "MARKET" ? rules.marketMinQty : rules.minQty;
    return (
      quantity > 0 &&
      quantity >= minQty &&
      quantity * leg.referencePrice >= rules.minNotional
    );
  });

  return meetsExchangeMinimums ? { legs, averageEntryPrice } : undefined;
};

/**
 * Turns a parsed signal into concrete Binance orders for a fixed USDT margin.
 * Entry ranges are split into `entryOrderCount` limit orders; any part of the
 * range the market has already reached is filled immediately at market. If the
 * margin is too small for the symbol's minimum order size, fewer legs are used.
 */
export const buildExecutionPlan = (input: PlanInput): PlanResult => {
  const { rules, side, markPrice, stopLoss, takeProfits } = input;
  const firstTakeProfit = takeProfits[0]?.price;

  if (rules.status !== "TRADING") {
    return rejected(`${input.symbol} is not trading on Binance Futures (${rules.status})`);
  }

  if (!(input.marginUsdt > 0)) {
    return rejected("Trade margin (defaultMargin) must be greater than 0 USDT");
  }

  if (firstTakeProfit === undefined) {
    return rejected("Signal has no take-profit targets");
  }

  if (side === SignalSide.Long ? markPrice <= stopLoss : markPrice >= stopLoss) {
    return rejected(`Price ${markPrice} is already beyond the stop loss ${stopLoss}`);
  }

  if (side === SignalSide.Long ? markPrice >= firstTakeProfit : markPrice <= firstTakeProfit) {
    return rejected(`Price ${markPrice} has already reached TP1 ${firstTakeProfit}`);
  }

  const maxLegs = input.entry.type === EntryType.EntryRange ? input.entryOrderCount : 1;

  for (let count = Math.max(1, maxLegs); count >= 1; count -= 1) {
    const built = buildLegs(input, count);

    if (!built) {
      continue;
    }

    const totalQuantity = built.legs.reduce((total, leg) => total + Number(leg.quantity), 0);

    return {
      ok: true,
      plan: {
        symbol: input.symbol,
        side,
        entrySide: side === SignalSide.Long ? "BUY" : "SELL",
        exitSide: side === SignalSide.Long ? "SELL" : "BUY",
        leverage: input.leverage,
        marginUsdt: input.marginUsdt,
        notionalUsdt: input.marginUsdt * input.leverage,
        averageEntryPrice: built.averageEntryPrice,
        totalQuantity,
        legs: built.legs,
        stopLoss: roundToStep(stopLoss, rules.tickSize),
        takeProfits: takeProfits.map((takeProfit) => ({
          price: roundToStep(takeProfit.price, rules.tickSize),
          allocationPercentage: takeProfit.allocationPercentage
        }))
      }
    };
  }

  return rejected(
    `Margin ${input.marginUsdt} USDT x${input.leverage} is below ${input.symbol}'s minimum order size (min notional ${rules.minNotional} USDT, min qty ${rules.minQty})`
  );
};
