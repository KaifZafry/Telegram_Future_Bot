import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose, { type Types } from "mongoose";

import type { BinanceAccountClientRegistry as Registry } from "../modules/binance/binance.accounts.js";
import type { TradeApprover } from "../modules/trading/trading.approval.js";

import { FakeBinance } from "./support/fake-binance.js";

// The pipeline pulls in the app logger, which validates env on import.
process.env.MONGODB_URI ??= "mongodb://placeholder/test";
process.env.LOG_LEVEL = "silent";

const models = await import("../models/index.js");
const { BinanceFuturesClient } = await import("../modules/binance/binance.client.js");
const { PositionManager } = await import("../modules/binance/binance.position-manager.js");
const { SignalPipeline } = await import("../modules/trading/trading.pipeline.js");

const {
  BinanceAccountModel,
  BinanceEnvironment,
  BotSettingsModel,
  DailyStatisticsModel,
  SignalModel,
  SignalStatus,
  TelegramChatType,
  TelegramSourceModel,
  TradeCloseReason,
  TradeExecutionModel,
  TradeExecutionStatus,
  TradeModel,
  TradeStatus,
  UserModel
} = models;

const RLC_SIGNAL = `Coin #RLC/USDT

Position: LONG

Leverage:  Cross 20×

Entries:  0.8250 - 0.7900

Targets: 🎯 0.8650, 0.9150, 0.9750

Stop Loss: 0.7550`;

const silentLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

let mongo: MongoMemoryServer;
let exchangeCount = 0;

interface Harness {
  exchange: FakeBinance;
  pipeline: InstanceType<typeof SignalPipeline>;
  manager: InstanceType<typeof PositionManager>;
  signalId: string;
  userId: Types.ObjectId;
  syncTimes: (count: number) => Promise<void>;
}

const createHarness = async (
  initialPrice: number,
  options: {
    signalAgeSeconds?: number;
    settings?: Record<string, unknown>;
    approver?: TradeApprover;
  } = {}
): Promise<Harness> => {
  const exchange = new FakeBinance("RLCUSDT", initialPrice);
  exchangeCount += 1;
  const client = new BinanceFuturesClient({
    baseUrl: `https://fake-${exchangeCount}.test`,
    credentials: { apiKey: "key", apiSecret: "secret" },
    fetchFn: exchange.fetch
  });
  const registry = { get: () => Promise.resolve(client) } as unknown as Registry;

  const user = await UserModel.create({ name: "Owner", email: "owner@test", passwordHash: "!" });
  await BotSettingsModel.create({
    userId: user._id,
    isEnabled: true,
    defaultMargin: 10,
    defaultLeverage: 10,
    maxLeverage: 20,
    maxOpenTrades: 3,
    entryOrderCount: 3,
    moveStopToBreakeven: true,
    ...options.settings
  });
  const source = await TelegramSourceModel.create({
    userId: user._id,
    name: "VIP",
    chatId: "-1001",
    chatType: TelegramChatType.Supergroup
  });
  await BinanceAccountModel.create({
    userId: user._id,
    name: "Testnet",
    apiKeyEncrypted: "unused",
    apiSecretEncrypted: "unused",
    environment: BinanceEnvironment.Testnet
  });
  const signal = await SignalModel.create({
    userId: user._id,
    telegramSourceId: source._id,
    telegramMessageId: "1",
    rawText: RLC_SIGNAL,
    receivedAt: new Date(Date.now() - (options.signalAgeSeconds ?? 1) * 1000)
  });

  const manager = new PositionManager({ registry, logger: silentLogger, intervalMs: 60_000 });

  return {
    exchange,
    manager,
    pipeline: new SignalPipeline({
      logger: silentLogger,
      registry,
      maxSignalAgeSeconds: 120,
      allowLiveTrading: false,
      getMarketClient: () => client,
      approver: options.approver
    }),
    signalId: signal._id.toString(),
    userId: user._id,
    syncTimes: async (count) => {
      for (let index = 0; index < count; index += 1) {
        await manager.syncAll();
      }
    }
  };
};

const getExecution = async () => {
  const execution = await TradeExecutionModel.findOne().lean();
  assert.ok(execution, "expected a trade execution");
  return execution;
};

const openTakeProfits = (exchange: FakeBinance) =>
  exchange.openOrders().filter((order) => order.reduceOnly);

const sumQuantity = (orders: { origQty: number; executedQty: number }[]): number =>
  Number(orders.reduce((total, order) => total + order.origQty - order.executedQty, 0).toFixed(4));

void describe("Trading lifecycle (fake Binance + MongoDB)", () => {
  before(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    await Promise.all(models.databaseModels.map((model) => model.syncIndexes()));
  });

  after(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  beforeEach(async () => {
    await Promise.all(
      Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({}))
    );
  });

  void it("runs a full trade: split entries, TPs follow fills, breakeven after TP1, clean close", async () => {
    const { exchange, pipeline, signalId, userId, syncTimes } = await createHarness(0.84);

    await pipeline.process(signalId);

    // Stop loss first, then three limit buys spread across the range.
    assert.deepEqual(
      exchange.openAlgoOrders().map((stop) => [stop.side, stop.triggerPrice]),
      [["SELL", 0.755]]
    );
    assert.deepEqual(
      exchange.openOrders().map((order) => [order.side, order.type, order.price]),
      [
        ["BUY", "LIMIT", 0.825],
        ["BUY", "LIMIT", 0.8075],
        ["BUY", "LIMIT", 0.79]
      ]
    );
    assert.equal((await getExecution()).status, TradeExecutionStatus.Executing);
    assert.equal((await SignalModel.findById(signalId).lean())?.status, SignalStatus.Executed);

    // First entry fills: TPs are placed for exactly the filled size.
    exchange.setPrice(0.82);
    await syncTimes(1);
    assert.equal((await getExecution()).status, TradeExecutionStatus.Open);
    assert.equal(exchange.positionAmt, 82.5);
    assert.equal(openTakeProfits(exchange).length, 3);
    assert.equal(sumQuantity(openTakeProfits(exchange)), 82.5);

    // Second entry fills: TPs are resized to the larger position.
    exchange.setPrice(0.8);
    await syncTimes(1);
    assert.equal(exchange.positionAmt, 165);
    assert.equal(sumQuantity(openTakeProfits(exchange)), 165);
    assert.deepEqual(
      openTakeProfits(exchange).map((order) => order.price),
      [0.865, 0.915, 0.975]
    );

    // TP1 hits: last entry cancelled, stop moved to the average entry.
    exchange.setPrice(0.87);
    await syncTimes(1);
    let execution = await getExecution();
    assert.equal(execution.status, TradeExecutionStatus.PartiallyClosed);
    assert.equal(execution.slMovedToBreakeven, true);
    assert.equal(exchange.openOrders().filter((order) => !order.reduceOnly).length, 0);
    const [breakevenStop] = exchange.openAlgoOrders();
    assert.ok(breakevenStop);
    assert.ok(Math.abs(breakevenStop.triggerPrice - 0.81625) <= 0.0001);
    assert.equal(openTakeProfits(exchange).length, 2);

    // Price returns to entry: breakeven stop closes the rest.
    exchange.setPrice(0.81);
    assert.equal(exchange.positionAmt, 0);
    await syncTimes(2);

    execution = await getExecution();
    assert.equal(execution.status, TradeExecutionStatus.Closed);
    assert.equal(execution.closeReason, TradeCloseReason.StopLoss);
    assert.ok(execution.netPnL > 2, `expected TP1 profit, got ${execution.netPnL}`);
    assert.equal(exchange.openOrders().length, 0, "leftover TP orders must be cancelled");
    assert.equal(exchange.openAlgoOrders().length, 0);

    assert.equal((await TradeModel.findOne().lean())?.status, TradeStatus.Closed);
    assert.equal((await SignalModel.findById(signalId).lean())?.status, SignalStatus.Completed);
    const stats = await DailyStatisticsModel.findOne({ userId }).lean();
    assert.equal(stats?.winningTrades, 1);
    assert.equal(stats?.executedSignals, 1);
  });

  void it("enters at market immediately when price is already inside the range", async () => {
    const { exchange, pipeline, signalId, syncTimes } = await createHarness(0.81);

    await pipeline.process(signalId);

    assert.ok(exchange.positionAmt > 0, "the reached part of the range fills at market");
    assert.deepEqual(
      exchange.openOrders().map((order) => order.price),
      [0.8075, 0.79]
    );

    await syncTimes(1);
    assert.equal((await getExecution()).status, TradeExecutionStatus.Open);
    assert.equal(sumQuantity(openTakeProfits(exchange)), exchange.positionAmt);
    assert.equal(exchange.openAlgoOrders().length, 1);
  });

  void it("full stop loss closes the trade as a loss and cleans up", async () => {
    const { exchange, pipeline, signalId, userId, syncTimes } = await createHarness(0.84);

    await pipeline.process(signalId);
    exchange.setPrice(0.78); // fills all three entries
    await syncTimes(1);
    assert.equal(exchange.positionAmt, 247.5);

    exchange.setPrice(0.75); // stop loss
    await syncTimes(2);

    const execution = await getExecution();
    assert.equal(execution.status, TradeExecutionStatus.Closed);
    assert.equal(execution.closeReason, TradeCloseReason.StopLoss);
    assert.ok(execution.netPnL < -10, `expected ~-13 USDT loss, got ${execution.netPnL}`);
    assert.equal(exchange.openOrders().length, 0);
    assert.equal((await DailyStatisticsModel.findOne({ userId }).lean())?.losingTrades, 1);
  });

  void it("cancels the trade when price reaches TP1 before any entry fills", async () => {
    const { exchange, pipeline, signalId, syncTimes } = await createHarness(0.84);

    await pipeline.process(signalId);
    exchange.setPrice(0.87);
    await syncTimes(1);

    const execution = await getExecution();
    assert.equal(execution.status, TradeExecutionStatus.Cancelled);
    assert.match(execution.errorMessage ?? "", /TP1/);
    assert.equal(exchange.openOrders().length, 0);
    assert.equal(exchange.openAlgoOrders().length, 0);
    assert.equal(exchange.positionAmt, 0);
  });

  void it("cancels unfilled entries after the entry timeout", async () => {
    const { exchange, pipeline, signalId, syncTimes } = await createHarness(0.84);

    await pipeline.process(signalId);
    await TradeExecutionModel.updateMany({}, { $set: { entryExpiresAt: new Date(Date.now() - 1) } });
    await syncTimes(1);

    assert.equal((await getExecution()).status, TradeExecutionStatus.Cancelled);
    assert.equal(exchange.openOrders().length, 0);
  });

  void it("re-places a missing stop loss for an open position", async () => {
    const { exchange, pipeline, signalId, syncTimes } = await createHarness(0.84);

    await pipeline.process(signalId);
    exchange.setPrice(0.82);
    // Simulate the stop disappearing (e.g. cancelled manually in the app).
    exchange.openAlgoOrders().forEach((stop) => (stop.algoStatus = "CANCELED"));
    await syncTimes(1);

    assert.deepEqual(
      exchange.openAlgoOrders().map((stop) => stop.triggerPrice),
      [0.755]
    );
  });

  void it("rejects stale signals without placing orders", async () => {
    const { exchange, pipeline, signalId } = await createHarness(0.84, { signalAgeSeconds: 600 });

    await pipeline.process(signalId);

    const signal = await SignalModel.findById(signalId).lean();
    assert.equal(signal?.status, SignalStatus.Rejected);
    assert.match(signal?.rejectionReason ?? "", /old/);
    assert.equal(exchange.orders.length, 0);
  });

  void it("does nothing when trading is disabled", async () => {
    const { exchange, pipeline, signalId } = await createHarness(0.84, {
      settings: { isEnabled: false }
    });

    await pipeline.process(signalId);

    assert.equal((await SignalModel.findById(signalId).lean())?.status, SignalStatus.Rejected);
    assert.equal(exchange.orders.length, 0);
  });

  void it("never touches an account that already holds a position in the symbol", async () => {
    const { exchange, pipeline, signalId } = await createHarness(0.84);
    exchange.positionAmt = 50;
    exchange.entryPrice = 0.8;

    await pipeline.process(signalId);

    assert.equal(exchange.orders.length, 0);
    const signal = await SignalModel.findById(signalId).lean();
    assert.equal(signal?.status, SignalStatus.Rejected);
    assert.match(signal?.rejectionReason ?? "", /open RLCUSDT position/);
    assert.equal(await TradeModel.countDocuments(), 0);
  });
});

void describe("Trade approval", () => {
  before(async () => {
    if (mongoose.connection.readyState !== mongoose.STATES.connected) {
      mongo = await MongoMemoryServer.create();
      await mongoose.connect(mongo.getUri());
      await Promise.all(models.databaseModels.map((model) => model.syncIndexes()));
    }
  });

  after(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  beforeEach(async () => {
    await Promise.all(
      Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({}))
    );
  });

  const approver =(approved: boolean, available = true) => {
    const requests: { symbol: string; lossAtStopUsdt: number }[] = [];
    return {
      requests,
      isAvailable: () => available,
      requestApproval: (request: { symbol: string; lossAtStopUsdt: number }) => {
        requests.push(request);
        return Promise.resolve(approved ? { approved: true } : { approved: false, reason: "Rejected by you" });
      }
    };
  };

  void it("places nothing when the owner rejects", async () => {
    const stub = approver(false);
    const { exchange, pipeline, signalId } = await createHarness(0.84, {
      settings: { requireApproval: true },
      approver: stub
    });

    await pipeline.process(signalId);

    assert.equal(stub.requests.length, 1);
    assert.equal(stub.requests[0]?.symbol, "RLCUSDT");
    assert.ok((stub.requests[0]?.lossAtStopUsdt ?? 0) > 0);
    assert.equal(exchange.orders.length, 0);
    const signal = await SignalModel.findById(signalId).lean();
    assert.equal(signal?.status, SignalStatus.Rejected);
    assert.equal(signal?.rejectionReason, "Rejected by you");
  });

  void it("trades once the owner approves", async () => {
    const { exchange, pipeline, signalId } = await createHarness(0.84, {
      settings: { requireApproval: true },
      approver: approver(true)
    });

    await pipeline.process(signalId);

    assert.equal(exchange.openOrders().length, 3);
    assert.equal((await SignalModel.findById(signalId).lean())?.status, SignalStatus.Executed);
  });

  void it("refuses to trade when approval is required but the bot is offline", async () => {
    const { exchange, pipeline, signalId } = await createHarness(0.84, {
      settings: { requireApproval: true },
      approver: approver(true, false)
    });

    await pipeline.process(signalId);

    assert.equal(exchange.orders.length, 0);
    assert.match((await SignalModel.findById(signalId).lean())?.rejectionReason ?? "", /control bot is not connected/);
  });
});
