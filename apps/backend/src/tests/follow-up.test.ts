import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose, { type Types } from "mongoose";

import type { BinanceAccountClientRegistry as Registry } from "../modules/binance/binance.accounts.js";
import { FakeBinance } from "./support/fake-binance.js";

process.env.MONGODB_URI ??= "mongodb://placeholder/test";
process.env.LOG_LEVEL = "silent";

const models = await import("../models/index.js");
const { BinanceFuturesClient } = await import("../modules/binance/binance.client.js");
const { PositionManager } = await import("../modules/binance/binance.position-manager.js");
const { FollowUpHandler } = await import("../modules/trading/trading.follow-up.js");
const { SignalPipeline } = await import("../modules/trading/trading.pipeline.js");
const { parseFollowUp } = await import("../modules/signal-parser/follow-up.parser.js");

const RLC_SIGNAL =
  "Coin #RLC/USDT\nPosition: LONG\nLeverage: Cross 20×\nEntries: 0.8250 - 0.7900\nTargets: 0.8650, 0.9150, 0.9750\nStop Loss: 0.7550";
const silentLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

let mongo: MongoMemoryServer;
let exchangeCount = 0;
let messageId = 0;

const setup = async (settings: Record<string, unknown> = {}) => {
  const exchange = new FakeBinance("RLCUSDT", 0.84);
  exchangeCount += 1;
  const client = new BinanceFuturesClient({
    baseUrl: `https://fake-followup-${exchangeCount}.test`,
    credentials: { apiKey: "key", apiSecret: "secret" },
    fetchFn: exchange.fetch
  });
  const registry = { get: () => Promise.resolve(client) } as unknown as Registry;
  const user = await models.UserModel.create({ name: "Owner", email: "f@test", passwordHash: "!" });
  await models.BotSettingsModel.create({ userId: user._id, isEnabled: true, defaultMargin: 10, ...settings });
  const source = await models.TelegramSourceModel.create({
    userId: user._id,
    name: "VIP",
    chatId: "-1001",
    chatType: models.TelegramChatType.Supergroup
  });
  await models.BinanceAccountModel.create({
    userId: user._id,
    name: "Testnet",
    apiKeyEncrypted: "unused",
    apiSecretEncrypted: "unused",
    environment: models.BinanceEnvironment.Testnet
  });

  const manager = new PositionManager({ registry, logger: silentLogger, intervalMs: 3_600_000 });
  const pipeline = new SignalPipeline({
    logger: silentLogger,
    registry,
    maxSignalAgeSeconds: 120,
    allowLiveTrading: false,
    getMarketClient: () => client,
    followUps: new FollowUpHandler(manager)
  });

  /** Simulates a new Telegram message from a source and runs it through the bot. */
  const post = async (
    text: string,
    options: { replyTo?: string; sourceId?: Types.ObjectId } = {}
  ) => {
    const signal = await models.SignalModel.create({
      userId: user._id,
      telegramSourceId: options.sourceId ?? source._id,
      telegramMessageId: String(++messageId),
      rawText: text,
      replyToMessageId: options.replyTo,
      receivedAt: new Date()
    });
    await pipeline.process(signal._id.toString());
    return signal;
  };

  const execution = async () => {
    const found = await models.TradeExecutionModel.findOne().lean();
    assert.ok(found);
    return found;
  };

  return { exchange, manager, pipeline, post, execution, userId: user._id };
};

void describe("Follow-up parser", () => {
  void it("recognises instructions and ignores chatter", () => {
    assert.equal(parseFollowUp("Close RLC now")?.action, "CLOSE");
    assert.deepEqual(parseFollowUp("Close RLC now")?.explicitSymbols, []);
    assert.deepEqual(parseFollowUp("#RLC close")?.explicitSymbols, ["RLC"]);
    assert.equal(parseFollowUp("Move SL to entry")?.action, "BREAKEVEN");
    assert.equal(parseFollowUp("Set SL at BE")?.action, "BREAKEVEN");
    assert.deepEqual(parseFollowUp("New SL 0.8100"), { action: "MOVE_SL", symbols: [], explicitSymbols: [], price: 0.81 });
    assert.equal(parseFollowUp("ETH signal cancelled ❌")?.action, "CANCEL");

    for (const chatter of ["RLC TP1 hit ✅ +24%", "Price is close to TP1, hold", "RLC closed in profit", "Good morning"]) {
      assert.equal(parseFollowUp(chatter), null, chatter);
    }
  });
});

void describe("Follow-up actions (fake Binance + MongoDB)", () => {
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

  void it("moves the stop to entry on 'Move SL to entry', but never widens it", async () => {
    const { exchange, manager, post, execution } = await setup();
    await post(RLC_SIGNAL);
    exchange.setPrice(0.82); // first entry fills at 0.825
    await manager.syncAll();
    exchange.setPrice(0.84); // back above entry, below TP1

    const followUp = await post("Move SL to entry ✅");
    assert.deepEqual(exchange.openAlgoOrders().map((stop) => stop.triggerPrice), [0.825]);
    assert.equal((await execution()).slMovedToBreakeven, true);
    assert.equal((await models.SignalModel.findById(followUp._id).lean())?.followUp?.action, "BREAKEVEN");

    await post("New SL 0.70");
    assert.deepEqual(
      exchange.openAlgoOrders().map((stop) => stop.triggerPrice),
      [0.825],
      "a wider stop is refused"
    );

    await post("New SL 0.8100");
    assert.deepEqual(exchange.openAlgoOrders().map((stop) => stop.triggerPrice), [0.825], "below entry is wider too");
  });

  void it("closes the named coin on 'Close RLC now'", async () => {
    const { exchange, manager, post } = await setup();
    await post(RLC_SIGNAL);
    exchange.setPrice(0.82);
    await manager.syncAll();

    await post("Close RLC now 💰");

    assert.equal(exchange.positionAmt, 0);
    assert.equal(exchange.openOrders().length, 0);
    assert.equal(exchange.openAlgoOrders().length, 0);
  });

  void it("acts on an un-named 'close now' only when it replies to the signal", async () => {
    const { exchange, manager, post } = await setup();
    const signal = await post(RLC_SIGNAL);
    exchange.setPrice(0.82);
    await manager.syncAll();

    const loose = await post("close now");
    assert.equal(exchange.positionAmt, 82.5, "an unlinked close is ignored");
    assert.match((await models.SignalModel.findById(loose._id).lean())?.followUp?.notes?.[0] ?? "", /no matching open trade/);

    await post("close now", { replyTo: signal.telegramMessageId });
    assert.equal(exchange.positionAmt, 0);
  });

  void it("cancels a trade whose entries have not filled", async () => {
    const { exchange, post, execution } = await setup();
    await post(RLC_SIGNAL);
    assert.equal(exchange.openOrders().length, 3);

    await post("RLC signal cancelled ❌");

    assert.equal((await execution()).status, models.TradeExecutionStatus.Cancelled);
    assert.equal(exchange.openOrders().length, 0);
    assert.equal(exchange.openAlgoOrders().length, 0);
  });

  void it("ignores follow-ups from a different group and when turned off", async () => {
    const other = await setup({ followUpActions: false });
    await other.post(RLC_SIGNAL);
    other.exchange.setPrice(0.82);
    await other.manager.syncAll();

    await other.post("Close RLC now");
    assert.equal(other.exchange.positionAmt, 82.5, "turned off in settings");

    await models.BotSettingsModel.updateMany({}, { $set: { followUpActions: true } });
    const strangerSource = await models.TelegramSourceModel.create({
      userId: other.userId,
      name: "Other group",
      chatId: "-1002",
      chatType: models.TelegramChatType.Supergroup
    });
    await other.post("Close RLC now", { sourceId: strangerSource._id });
    assert.equal(other.exchange.positionAmt, 82.5, "another group cannot close this trade");
  });

  void it("trades an incomplete post once the group edits it into a full signal", async () => {
    const { exchange, pipeline, post } = await setup();
    const incomplete = await post("Coin #RLC/USDT\nPosition: LONG\nEntries: 0.8250 - 0.7900");
    assert.equal(exchange.orders.length, 0);

    await models.SignalModel.updateOne({ _id: incomplete._id }, { $set: { rawText: RLC_SIGNAL, editedAt: new Date() } });
    await pipeline.processEdit(incomplete._id.toString());

    assert.equal(exchange.openOrders().length, 3);
  });

  void it("applies edited take profits to a running trade", async () => {
    const { exchange, manager, pipeline, post } = await setup();
    const signal = await post(RLC_SIGNAL);
    exchange.setPrice(0.82);
    await manager.syncAll();
    assert.deepEqual(exchange.openOrders().filter((order) => order.reduceOnly).map((order) => order.price), [0.865, 0.915, 0.975]);

    await models.SignalModel.updateOne(
      { _id: signal._id },
      { $set: { rawText: RLC_SIGNAL.replace("0.8650, 0.9150, 0.9750", "0.8700, 0.9200"), editedAt: new Date() } }
    );
    await pipeline.processEdit(signal._id.toString());

    const takeProfits = exchange.openOrders().filter((order) => order.reduceOnly);
    assert.deepEqual(takeProfits.map((order) => order.price), [0.87, 0.92]);
    assert.equal(Number(takeProfits.reduce((total, order) => total + order.origQty, 0).toFixed(4)), 82.5);
  });
});
