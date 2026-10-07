import {
  BotSettingsModel,
  OrderModel,
  OrderRole,
  OrderStatus,
  OrderType,
  SignalSide,
  SystemLogCategory,
  SystemLogLevel,
  TradeCloseReason,
  TradeExecutionModel,
  TradeExecutionStatus,
  type OrderDocument,
  type TradeExecutionDocument
} from "../../models/index.js";
import { eventBus } from "../../services/eventBus.js";
import { writeSystemLog } from "../../services/systemLogService.js";
import { refreshTradeAggregate } from "../../services/tradeAggregateService.js";
import { recordClosedTrade } from "../../services/tradingStatsService.js";
import type { BinanceAccountClientRegistry } from "./binance.accounts.js";
import {
  BINANCE_ERROR_CODES,
  isBinanceError,
  type BinanceFuturesClient
} from "./binance.client.js";
import { floorToStep, isZeroQuantity, roundToStep } from "./binance.math.js";
import {
  applyExchangeState,
  isActiveOrder,
  recordOrder,
  type OrderOwner
} from "./binance.orders.js";
import type { BinanceOrderSide, SymbolRules } from "./binance.types.js";

export interface PositionManagerLogger {
  info(data: Record<string, unknown>, message: string): void;
  warn(data: Record<string, unknown>, message: string): void;
  error(data: Record<string, unknown>, message: string): void;
}

export interface PositionManagerOptions {
  registry: BinanceAccountClientRegistry;
  logger: PositionManagerLogger;
  intervalMs: number;
}

const MANAGED_STATUSES = [
  TradeExecutionStatus.Executing,
  TradeExecutionStatus.Open,
  TradeExecutionStatus.PartiallyClosed
];

/**
 * Position is only treated as closed after it reads zero on consecutive syncs,
 * so a momentarily stale position read never cancels a live position's SL/TPs.
 */
const ZERO_POSITION_CONFIRMATIONS = 2;

interface SyncContext {
  execution: TradeExecutionDocument;
  orders: OrderDocument[];
  client: BinanceFuturesClient;
  rules: SymbolRules;
  owner: OrderOwner;
  exitSide: BinanceOrderSide;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const sumFilled = (orders: OrderDocument[]): number =>
  orders.reduce((total, order) => total + order.filledQuantity, 0);

const ordersWithRole = (orders: OrderDocument[], role: OrderRole): OrderDocument[] =>
  orders.filter((order) => order.role === role);

/**
 * Reconciles every open trade execution with Binance on a fixed interval.
 * Binance is the source of truth; each sync reads exchange state and moves the
 * execution forward, so missed ticks or restarts are self-healing.
 */
export class PositionManager {
  private readonly registry: BinanceAccountClientRegistry;
  private readonly logger: PositionManagerLogger;
  private readonly intervalMs: number;
  private timer?: NodeJS.Timeout;
  private syncing = false;
  private readonly executionQueues = new Map<string, Promise<unknown>>();

  public constructor(options: PositionManagerOptions) {
    this.registry = options.registry;
    this.logger = options.logger;
    this.intervalMs = options.intervalMs;
  }

  public start(): void {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      void this.syncAll();
    }, this.intervalMs);
    this.logger.info({ intervalMs: this.intervalMs }, "Position manager started");
  }

  public async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }

    while (this.syncing) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  public async syncAll(): Promise<void> {
    if (this.syncing) {
      return;
    }

    this.syncing = true;

    try {
      const executions = await TradeExecutionModel.find({
        status: { $in: MANAGED_STATUSES }
      });

      for (const execution of executions) {
        try {
          await this.runExclusive(execution._id.toString(), async () => {
            // Re-read: a manual close may have changed it while queued.
            const current = await TradeExecutionModel.findById(execution._id);

            if (current && MANAGED_STATUSES.includes(current.status)) {
              await this.syncExecution(current);
            }
          });
        } catch (error) {
          this.logger.error(
            { error, executionId: execution._id.toString(), symbol: execution.symbol },
            "Position sync failed"
          );
        }
      }

      if (executions.length > 0) {
        eventBus.publish({ type: "positions" });
      }
    } catch (error) {
      this.logger.error({ error }, "Position manager tick failed");
    } finally {
      this.syncing = false;
    }
  }

  /**
   * Closes one trade now: cancels its open orders and market-closes any
   * position. Unfilled trades are simply cancelled.
   */
  public closeExecution(executionId: string): Promise<{ closed: boolean; reason?: string }> {
    return this.runExclusive(executionId, async () => {
      const execution = await TradeExecutionModel.findById(executionId);

      if (!execution || !MANAGED_STATUSES.includes(execution.status)) {
        return { closed: false, reason: "Trade is not open" };
      }

      execution.manualCloseRequested = true;
      await execution.save();
      await writeSystemLog({
        level: SystemLogLevel.Warn,
        category: SystemLogCategory.Trade,
        userId: execution.userId,
        message: `${execution.symbol} manual close requested`,
        metadata: { executionId }
      });
      await this.syncExecution(execution);
      eventBus.publish({ type: "positions" });
      return { closed: true };
    });
  }

  public async closeAll(): Promise<number> {
    const executions = await TradeExecutionModel.find({ status: { $in: MANAGED_STATUSES } })
      .select("_id")
      .lean();

    for (const execution of executions) {
      await this.closeExecution(execution._id.toString());
    }

    return executions.length;
  }

  /** Serializes work per execution so a manual close never races a sync. */
  private runExclusive<T>(executionId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.executionQueues.get(executionId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    this.executionQueues.set(executionId, next);

    return next.finally(() => {
      if (this.executionQueues.get(executionId) === next) {
        this.executionQueues.delete(executionId);
      }
    });
  }

  public async syncExecution(execution: TradeExecutionDocument): Promise<void> {
    const client = await this.registry.get(execution.binanceAccountId.toString());
    const rules = await client.getSymbolRules(execution.symbol);

    if (!rules) {
      throw new Error(`No exchange rules for ${execution.symbol}`);
    }

    const orders = await OrderModel.find({ tradeExecutionId: execution._id }).sort({
      createdAt: 1
    });
    const context: SyncContext = {
      execution,
      orders,
      client,
      rules,
      owner: {
        userId: execution.userId,
        tradeExecutionId: execution._id,
        binanceAccountId: execution.binanceAccountId,
        symbol: execution.symbol
      },
      exitSide: execution.side === SignalSide.Long ? "SELL" : "BUY"
    };

    for (const order of orders.filter(isActiveOrder)) {
      await this.refreshOrder(context, order);
    }

    const position = await client.getPosition(execution.symbol);
    const positionQuantity = Math.abs(Number(position?.positionAmt ?? 0));
    const filledEntryQuantity = sumFilled(ordersWithRole(orders, OrderRole.Entry));
    const hasPosition = !isZeroQuantity(positionQuantity, rules.stepSize);
    const hasFilledEntries = !isZeroQuantity(filledEntryQuantity, rules.stepSize);

    execution.lastSyncedAt = new Date();
    execution.positionQuantity = hasPosition ? positionQuantity : 0;
    execution.markPrice = Number(position?.markPrice) || execution.markPrice;
    execution.unrealizedPnL = hasPosition ? Number(position?.unRealizedProfit ?? 0) : 0;

    if (execution.manualCloseRequested) {
      await this.continueManualClose(context, hasPosition, hasFilledEntries, positionQuantity);
      return;
    }

    if (!hasPosition) {
      if (hasFilledEntries) {
        execution.zeroPositionChecks += 1;

        if (execution.zeroPositionChecks >= ZERO_POSITION_CONFIRMATIONS) {
          await this.finalizeClosed(context);
          return;
        }

        await execution.save();
        return;
      }

      const cancelReason = await this.getUnfilledCancelReason(context);

      if (cancelReason) {
        await this.finalizeCancelled(context, cancelReason);
        return;
      }

      await execution.save();
      return;
    }

    execution.zeroPositionChecks = 0;
    execution.actualEntry = Number(position?.entryPrice) || execution.actualEntry;

    const takeProfitFilled = ordersWithRole(orders, OrderRole.TakeProfit).some(
      (order) => order.status === OrderStatus.Filled
    );
    const previousStatus = execution.status;
    execution.status = takeProfitFilled
      ? TradeExecutionStatus.PartiallyClosed
      : TradeExecutionStatus.Open;

    if (Date.now() > execution.entryExpiresAt.getTime()) {
      await this.cancelOrders(context, ordersWithRole(orders, OrderRole.Entry));
    }

    if (
      takeProfitFilled &&
      !execution.slMovedToBreakeven &&
      (await this.shouldMoveStopToBreakeven(execution))
    ) {
      await this.moveStopToBreakeven(context, positionQuantity);
    } else {
      await this.ensureStopLoss(context, positionQuantity);
    }

    await this.syncTakeProfits(context, filledEntryQuantity);
    await execution.save();

    if (previousStatus !== execution.status) {
      await writeSystemLog({
        level: SystemLogLevel.Info,
        category: SystemLogCategory.Trade,
        userId: execution.userId,
        message: `${execution.symbol} ${execution.status === TradeExecutionStatus.Open ? "position opened" : "TP hit, position partially closed"}`,
        metadata: {
          executionId: execution._id.toString(),
          positionQuantity,
          entryPrice: execution.actualEntry
        }
      });
      await refreshTradeAggregate(execution.tradeId);
    }
  }

  private async continueManualClose(
    context: SyncContext,
    hasPosition: boolean,
    hasFilledEntries: boolean,
    positionQuantity: number
  ): Promise<void> {
    const { execution, orders } = context;

    if (!hasFilledEntries && !hasPosition) {
      await this.finalizeCancelled(context, "Cancelled manually before any entry filled");
      return;
    }

    if (!hasPosition) {
      execution.zeroPositionChecks += 1;

      if (execution.zeroPositionChecks >= ZERO_POSITION_CONFIRMATIONS) {
        await this.finalizeClosed(context);
        return;
      }

      await execution.save();
      return;
    }

    execution.zeroPositionChecks = 0;
    await this.cancelOrders(
      context,
      orders.filter((order) => order.role !== OrderRole.Close)
    );

    if (!ordersWithRole(orders, OrderRole.Close).some(isActiveOrder)) {
      await this.closeAtMarket(context, positionQuantity, "closed manually from the dashboard");
    }

    await execution.save();
  }

  private async refreshOrder(context: SyncContext, order: OrderDocument): Promise<void> {
    try {
      const response = order.isAlgo
        ? await context.client.getAlgoOrder(order.clientOrderId)
        : await context.client.getOrder(context.execution.symbol, order.clientOrderId);
      await applyExchangeState(order, response);
    } catch (error) {
      if (isBinanceError(error, BINANCE_ERROR_CODES.orderDoesNotExist)) {
        order.status = OrderStatus.Expired;
        await order.save();
        return;
      }

      throw error;
    }
  }

  private async cancelOrders(context: SyncContext, orders: OrderDocument[]): Promise<void> {
    for (const order of orders.filter(isActiveOrder)) {
      try {
        if (order.isAlgo) {
          await context.client.cancelAlgoOrder(order.clientOrderId);
        } else {
          await context.client.cancelOrder(context.execution.symbol, order.clientOrderId);
        }
      } catch (error) {
        // Usually the order filled or was cancelled in the meantime; the
        // refresh below records whichever state it ended in.
        this.logger.warn(
          { error: errorMessage(error), clientOrderId: order.clientOrderId },
          "Order cancel was not accepted"
        );
      }

      await this.refreshOrder(context, order);
    }
  }

  private async getUnfilledCancelReason(context: SyncContext): Promise<string | undefined> {
    const { execution, orders, client } = context;
    const entries = ordersWithRole(orders, OrderRole.Entry);

    if (!entries.some(isActiveOrder)) {
      return "All entry orders were cancelled or expired before filling";
    }

    if (Date.now() > execution.entryExpiresAt.getTime()) {
      return "Entry was not filled before the entry timeout";
    }

    const markPrice = await client.getMarkPrice(execution.symbol);
    execution.markPrice = markPrice;
    const firstTarget = execution.takeProfits[0]?.price;
    const isLong = execution.side === SignalSide.Long;

    if (firstTarget !== undefined && (isLong ? markPrice >= firstTarget : markPrice <= firstTarget)) {
      return `Price reached TP1 (${firstTarget}) before the entry filled`;
    }

    if (isLong ? markPrice <= execution.stopLoss : markPrice >= execution.stopLoss) {
      return `Price reached the stop loss (${execution.stopLoss}) before the entry filled`;
    }

    return undefined;
  }

  private async shouldMoveStopToBreakeven(execution: TradeExecutionDocument): Promise<boolean> {
    const settings = await BotSettingsModel.findOne({ userId: execution.userId })
      .select("moveStopToBreakeven")
      .lean();
    return settings?.moveStopToBreakeven ?? true;
  }

  private async moveStopToBreakeven(
    context: SyncContext,
    positionQuantity: number
  ): Promise<void> {
    const { execution, orders, rules } = context;
    const breakevenPrice = Number(roundToStep(execution.actualEntry ?? 0, rules.tickSize));

    if (!(breakevenPrice > 0)) {
      return;
    }

    // Remaining entries would add size after profit was taken; drop them.
    await this.cancelOrders(context, ordersWithRole(orders, OrderRole.Entry));
    // Binance allows one close-position stop per side, so the old SL must go first.
    await this.cancelOrders(context, ordersWithRole(orders, OrderRole.StopLoss));

    const placed = await this.placeStopLoss(context, breakevenPrice, positionQuantity);

    if (placed) {
      execution.slMovedToBreakeven = true;
      await writeSystemLog({
        level: SystemLogLevel.Info,
        category: SystemLogCategory.Trade,
        userId: execution.userId,
        message: `${execution.symbol} TP1 hit: stop loss moved to breakeven ${breakevenPrice}`,
        metadata: { executionId: execution._id.toString() }
      });
    }
  }

  private async ensureStopLoss(context: SyncContext, positionQuantity: number): Promise<void> {
    const hasActiveStopLoss = ordersWithRole(context.orders, OrderRole.StopLoss).some(
      isActiveOrder
    );

    if (!hasActiveStopLoss) {
      await this.placeStopLoss(context, context.execution.currentStopLoss, positionQuantity);
    }
  }

  /**
   * Places a close-position stop. If Binance says it would trigger immediately
   * (price is already past the stop), the position is closed at market instead,
   * because an open position must never be left without protection.
   */
  private async placeStopLoss(
    context: SyncContext,
    triggerPrice: number,
    positionQuantity: number
  ): Promise<boolean> {
    const { execution, orders, client, rules, owner, exitSide } = context;
    const version = ordersWithRole(orders, OrderRole.StopLoss).length + 1;

    try {
      const response = await client.placeStopLoss({
        symbol: execution.symbol,
        side: exitSide,
        triggerPrice: roundToStep(triggerPrice, rules.tickSize),
        clientAlgoId: `tfb-${execution._id.toString()}-SL${version}`
      });
      orders.push(
        await recordOrder(
          owner,
          {
            role: OrderRole.StopLoss,
            orderType: OrderType.StopMarket,
            side: exitSide,
            closePosition: true
          },
          response
        )
      );
      execution.currentStopLoss = triggerPrice;
      return true;
    } catch (error) {
      if (isBinanceError(error, BINANCE_ERROR_CODES.orderWouldImmediatelyTrigger)) {
        await this.closeAtMarket(context, positionQuantity, "price is already beyond the stop");
        return true;
      }

      this.logger.error(
        { error: errorMessage(error), executionId: execution._id.toString(), triggerPrice },
        "Stop loss placement failed; will retry next sync"
      );
      return false;
    }
  }

  private async closeAtMarket(
    context: SyncContext,
    positionQuantity: number,
    reason: string
  ): Promise<void> {
    const { execution, orders, client, rules, owner, exitSide } = context;
    const version = ordersWithRole(orders, OrderRole.Close).length + 1;
    const response = await client.placeOrder({
      symbol: execution.symbol,
      side: exitSide,
      type: "MARKET",
      quantity: floorToStep(positionQuantity, rules.marketStepSize),
      reduceOnly: true,
      newClientOrderId: `tfb-${execution._id.toString()}-C${version}`
    });
    orders.push(
      await recordOrder(
        owner,
        { role: OrderRole.Close, orderType: OrderType.Market, side: exitSide, reduceOnly: true },
        response
      )
    );

    await writeSystemLog({
      level: SystemLogLevel.Warn,
      category: SystemLogCategory.Trade,
      userId: execution.userId,
      message: `${execution.symbol} position closed at market: ${reason}`,
      metadata: { executionId: execution._id.toString(), positionQuantity }
    });
  }

  /**
   * Keeps reduce-only take-profit orders sized to the real position. Whenever
   * more entry quantity fills, open TPs are cancelled and the current position
   * is redistributed across the targets that have not been hit yet.
   */
  private async syncTakeProfits(
    context: SyncContext,
    filledEntryQuantity: number
  ): Promise<void> {
    const { execution, orders, client, rules, owner, exitSide } = context;
    const takeProfitOrders = ordersWithRole(orders, OrderRole.TakeProfit);
    const activeTakeProfits = takeProfitOrders.filter(isActiveOrder);
    const quantityChanged = !isZeroQuantity(
      filledEntryQuantity - execution.tpPlacedForQuantity,
      rules.stepSize
    );

    if (!quantityChanged && activeTakeProfits.length > 0) {
      return;
    }

    await this.cancelOrders(context, activeTakeProfits);

    const hitTargets = new Set(
      takeProfitOrders
        .filter((order) => order.status === OrderStatus.Filled)
        .map((order) => order.targetIndex)
    );
    const remainingTargets = execution.takeProfits
      .map((target, index) => ({
        price: target.price,
        allocationPercentage: target.allocationPercentage,
        index
      }))
      .filter((target) => !hitTargets.has(target.index));

    if (remainingTargets.length === 0) {
      return;
    }

    // Re-read the position: cancelled TPs may have partially filled meanwhile.
    const position = await client.getPosition(execution.symbol);
    const positionQuantity = Math.abs(Number(position?.positionAmt ?? 0));
    const totalWeight = remainingTargets.reduce(
      (total, target) => total + target.allocationPercentage,
      0
    );
    let unassignedQuantity = positionQuantity;

    for (const [slot, target] of remainingTargets.entries()) {
      const isLast = slot === remainingTargets.length - 1;
      const share =
        totalWeight > 0
          ? target.allocationPercentage / totalWeight
          : 1 / remainingTargets.length;
      const quantity = Number(
        floorToStep(isLast ? unassignedQuantity : positionQuantity * share, rules.stepSize)
      );

      // Too small for the exchange: leave it for the next target to absorb.
      if (quantity <= 0 || quantity < rules.minQty) {
        continue;
      }

      const version =
        takeProfitOrders.filter((order) => order.targetIndex === target.index).length + 1;
      const response = await client.placeOrder({
        symbol: execution.symbol,
        side: exitSide,
        type: "LIMIT",
        price: roundToStep(target.price, rules.tickSize),
        quantity: floorToStep(quantity, rules.stepSize),
        timeInForce: "GTC",
        reduceOnly: true,
        newClientOrderId: `tfb-${execution._id.toString()}-T${target.index + 1}v${version}`
      });
      orders.push(
        await recordOrder(
          owner,
          {
            role: OrderRole.TakeProfit,
            targetIndex: target.index,
            orderType: OrderType.Limit,
            side: exitSide,
            reduceOnly: true
          },
          response
        )
      );
      unassignedQuantity -= quantity;
    }

    execution.tpPlacedForQuantity = filledEntryQuantity;
  }

  private async finalizeCancelled(context: SyncContext, reason: string): Promise<void> {
    const { execution, orders } = context;
    await this.cancelOrders(context, orders);

    execution.status = TradeExecutionStatus.Cancelled;
    execution.closeReason = TradeCloseReason.Cancelled;
    execution.errorMessage = reason;
    execution.closedAt = new Date();
    await execution.save();

    await writeSystemLog({
      level: SystemLogLevel.Info,
      category: SystemLogCategory.Trade,
      userId: execution.userId,
      message: `${execution.symbol} trade cancelled: ${reason}`,
      metadata: { executionId: execution._id.toString() }
    });
    await refreshTradeAggregate(execution.tradeId);
  }

  private async finalizeClosed(context: SyncContext): Promise<void> {
    const { execution, orders, client } = context;
    await this.cancelOrders(context, orders);

    const startTime = (execution.executedAt ?? execution.createdAt).getTime() - 1000;
    const trades = await client.getUserTrades(execution.symbol, startTime);
    const realizedPnL = trades.reduce((total, trade) => total + Number(trade.realizedPnl), 0);
    const fees = trades
      .filter((trade) => trade.commissionAsset === "USDT")
      .reduce((total, trade) => total + Number(trade.commission), 0);

    execution.realizedPnL = Number(realizedPnL.toFixed(8));
    execution.fees = Number(fees.toFixed(8));
    execution.netPnL = Number((realizedPnL - fees).toFixed(8));
    execution.status = TradeExecutionStatus.Closed;
    execution.closeReason = this.getCloseReason(execution, orders);
    execution.closedAt = new Date();
    await execution.save();

    await recordClosedTrade(execution.userId, {
      realizedPnL: execution.realizedPnL,
      fees: execution.fees
    });
    await writeSystemLog({
      level: SystemLogLevel.Info,
      category: SystemLogCategory.Trade,
      userId: execution.userId,
      message: `${execution.symbol} position closed (${execution.closeReason}) net PnL ${execution.netPnL.toFixed(4)} USDT`,
      metadata: {
        executionId: execution._id.toString(),
        realizedPnL: execution.realizedPnL,
        fees: execution.fees
      }
    });
    await refreshTradeAggregate(execution.tradeId);
  }

  private getCloseReason(
    execution: TradeExecutionDocument,
    orders: OrderDocument[]
  ): TradeCloseReason {
    const filled = (role: OrderRole): OrderDocument[] =>
      ordersWithRole(orders, role).filter((order) => order.status === OrderStatus.Filled);

    if (execution.manualCloseRequested) {
      return TradeCloseReason.Manual;
    }

    if (filled(OrderRole.StopLoss).length > 0 || filled(OrderRole.Close).length > 0) {
      return TradeCloseReason.StopLoss;
    }

    const hitTargets = new Set(filled(OrderRole.TakeProfit).map((order) => order.targetIndex));
    if (hitTargets.size > 0 && hitTargets.size >= execution.takeProfits.length) {
      return TradeCloseReason.TakeProfit;
    }

    return TradeCloseReason.Manual;
  }
}
