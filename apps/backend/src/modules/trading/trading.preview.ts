import { BinanceEnvironment } from "../../models/index.js";
import { getPublicClient } from "../binance/binance.accounts.js";
import type { BinanceFuturesClient } from "../binance/binance.client.js";
import { buildExecutionPlan, type ExecutionPlan } from "../binance/binance.planner.js";
import { parseSignalText, type ParseResult } from "../signal-parser/index.js";

export interface PreviewOptions {
  marginUsdt: number;
  defaultLeverage: number;
  maxLeverage: number;
  entryOrderCount: number;
  environment?: BinanceEnvironment;
  client?: BinanceFuturesClient;
}

export interface SignalPreview {
  parsed: ParseResult;
  environment: BinanceEnvironment;
  market?: {
    markPrice: number;
    tickSize: string;
    stepSize: string;
    minNotional: number;
  };
  plan?: ExecutionPlan;
  /** Loss if every entry fills and the stop loss is hit (before fees). */
  lossAtStopUsdt?: number;
  rejection?: string;
}

/**
 * Shows what the bot would trade for a message, using live market data,
 * without placing orders. Shared by the dashboard and `npm run signal:dry-run`.
 */
export const previewSignal = async (
  text: string,
  options: PreviewOptions
): Promise<SignalPreview> => {
  const environment = options.environment ?? BinanceEnvironment.Live;
  const parsed = parseSignalText(text);

  if (!parsed.success) {
    return { parsed, environment, rejection: parsed.errorMessage };
  }

  const signal = parsed.data;
  const client = options.client ?? getPublicClient(environment);
  const rules = await client.getSymbolRules(signal.symbol);

  if (!rules) {
    return {
      parsed,
      environment,
      rejection: `${signal.symbol} is not listed on Binance Futures (${environment})`
    };
  }

  const markPrice = await client.getMarkPrice(signal.symbol);
  const market = {
    markPrice,
    tickSize: rules.tickSize,
    stepSize: rules.stepSize,
    minNotional: rules.minNotional
  };
  const result = buildExecutionPlan({
    symbol: signal.symbol,
    side: signal.side,
    entry: signal.entry,
    stopLoss: signal.stopLoss,
    takeProfits: signal.takeProfits,
    markPrice,
    marginUsdt: options.marginUsdt,
    leverage: Math.min(signal.leverage ?? options.defaultLeverage, options.maxLeverage),
    entryOrderCount: options.entryOrderCount,
    rules
  });

  if (!result.ok) {
    return { parsed, environment, market, rejection: result.reason };
  }

  const { plan } = result;

  return {
    parsed,
    environment,
    market,
    plan,
    lossAtStopUsdt: Math.abs(plan.averageEntryPrice - Number(plan.stopLoss)) * plan.totalQuantity
  };
};
