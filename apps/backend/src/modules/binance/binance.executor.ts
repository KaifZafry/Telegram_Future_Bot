import type { Types } from "mongoose";

import type { MarginType, SignalSide } from "../../models/index.js";
import {
  OrderRole,
  OrderType,
  TradeExecutionModel,
  TradeExecutionStatus,
  type TradeEntry
} from "../../models/index.js";
import type { BinanceFuturesClient } from "./binance.client.js";
import type { ExecutionPlan } from "./binance.planner.js";
import { recordOrder, type OrderOwner } from "./binance.orders.js";
import type { BinanceAlgoOrderResponse, BinanceOrderResponse } from "./binance.types.js";

export interface ExecuteOnAccountInput {
  signal: {
    _id: Types.ObjectId;
    userId: Types.ObjectId;
    side: SignalSide;
    entry: TradeEntry;
  };
  tradeId: Types.ObjectId;
  account: { _id: Types.ObjectId; name: string };
  plan: ExecutionPlan;
  marginType: MarginType;
  entryTimeoutMinutes: number;
  client: BinanceFuturesClient;
}

export type ExecuteOnAccountResult =
  | { status: "placed"; executionId: string; warnings: string[] }
  | { status: "skipped" | "failed"; reason: string; executionId?: string };

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { code?: number }).code === 11000;

/**
 * Opens a planned trade on one Binance account: verifies the account is free
 * to trade the symbol, sets margin type and leverage, places the stop loss
 * first, then the entry orders. Take-profit orders are placed by the position
 * manager once entries fill, sized to the actual filled quantity.
 */
export const executeOnAccount = async (
  input: ExecuteOnAccountInput
): Promise<ExecuteOnAccountResult> => {
  const { client, plan, signal, account } = input;

  if (await client.isHedgeMode()) {
    return {
      status: "skipped",
      reason: "Account is in Hedge Mode; switch Binance Futures to One-way Mode"
    };
  }

  let position, openOrders: BinanceOrderResponse[], openAlgoOrders: BinanceAlgoOrderResponse[];
  try {
    [position, openOrders, openAlgoOrders] = await Promise.all([
      client.getPosition(plan.symbol),
      client.getOpenOrders(plan.symbol),
      client.getOpenAlgoOrders(plan.symbol)
    ]);
  } catch (error) {
    return {
      status: "failed",
      reason: `Failed to read account state before placing orders: ${errorMessage(error)}`
    };
  }

  if (position && Number(position.positionAmt) !== 0) {
    return { status: "skipped", reason: `Account already has an open ${plan.symbol} position` };
  }

  if (openOrders.length > 0 || openAlgoOrders.length > 0) {
    return { status: "skipped", reason: `Account already has open ${plan.symbol} orders` };
  }

  let execution;
  try {
    execution = await TradeExecutionModel.create({
      userId: signal.userId,
      signalId: signal._id,
      tradeId: input.tradeId,
      binanceAccountId: account._id,
      symbol: plan.symbol,
      side: signal.side,
      requestedEntry: signal.entry,
      quantity: plan.totalQuantity,
      leverage: plan.leverage,
      marginType: input.marginType,
      stopLoss: Number(plan.stopLoss),
      currentStopLoss: Number(plan.stopLoss),
      takeProfits: plan.takeProfits.map((takeProfit) => ({
        price: Number(takeProfit.price),
        allocationPercentage: takeProfit.allocationPercentage
      })),
      entryExpiresAt: new Date(Date.now() + input.entryTimeoutMinutes * 60_000),
      status: TradeExecutionStatus.Pending
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return { status: "skipped", reason: "Signal was already executed on this account" };
    }

    throw error;
  }

  const executionId = execution._id.toString();
  const fail = async (reason: string): Promise<ExecuteOnAccountResult> => {
    execution.status = TradeExecutionStatus.Failed;
    execution.errorMessage = reason;
    await execution.save();
    return { status: "failed", reason, executionId };
  };

  try {
    await client.setMarginType(plan.symbol, input.marginType);
    await client.setLeverage(plan.symbol, plan.leverage);
  } catch (error) {
    return fail(`Could not set margin/leverage: ${errorMessage(error)}`);
  }

  const owner: OrderOwner = {
    userId: signal.userId,
    tradeExecutionId: execution._id,
    binanceAccountId: account._id,
    symbol: plan.symbol
  };
  const warnings: string[] = [];
  const stopLossClientId = `tfb-${executionId}-SL1`;
  let stopLossPlaced = false;

  try {
    const stopLoss = await client.placeStopLoss({
      symbol: plan.symbol,
      side: plan.exitSide,
      triggerPrice: plan.stopLoss,
      clientAlgoId: stopLossClientId
    });
    await recordOrder(
      owner,
      {
        role: OrderRole.StopLoss,
        orderType: OrderType.StopMarket,
        side: plan.exitSide,
        closePosition: true
      },
      stopLoss
    );
    stopLossPlaced = true;
  } catch (error) {
    // The position manager places the stop loss as soon as a position exists.
    warnings.push(`Stop loss not placed up front: ${errorMessage(error)}`);
  }

  let placedEntries = 0;

  for (const [index, leg] of plan.legs.entries()) {
    try {
      const response = await client.placeOrder({
        symbol: plan.symbol,
        side: plan.entrySide,
        type: leg.type,
        quantity: leg.quantity,
        ...(leg.type === "LIMIT" ? { price: leg.price, timeInForce: "GTC" as const } : {}),
        newClientOrderId: `tfb-${executionId}-E${index + 1}`
      });
      await recordOrder(
        owner,
        {
          role: OrderRole.Entry,
          targetIndex: index,
          orderType: leg.type === "LIMIT" ? OrderType.Limit : OrderType.Market,
          side: plan.entrySide
        },
        response
      );
      placedEntries += 1;
    } catch (error) {
      warnings.push(`Entry ${index + 1} (${leg.type} ${leg.quantity}) failed: ${errorMessage(error)}`);
    }
  }

  if (placedEntries === 0) {
    if (stopLossPlaced) {
      await client.cancelAlgoOrder(stopLossClientId).catch(() => undefined);
    }

    return fail(`No entry orders could be placed. ${warnings.join("; ")}`);
  }

  execution.status = TradeExecutionStatus.Executing;
  execution.executedAt = new Date();
  if (warnings.length > 0) {
    execution.errorMessage = warnings.join("; ");
  }
  await execution.save();

  return { status: "placed", executionId, warnings };
};
