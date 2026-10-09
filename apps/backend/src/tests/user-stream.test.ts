import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

import type { BinanceAccountClientRegistry as Registry } from "../modules/binance/binance.accounts.js";
import type { StreamSocket } from "../modules/binance/binance.user-stream.js";
import { FakeBinance } from "./support/fake-binance.js";

process.env.MONGODB_URI ??= "mongodb://placeholder/test";
process.env.LOG_LEVEL = "silent";

const models = await import("../models/index.js");
const { BinanceFuturesClient } = await import("../modules/binance/binance.client.js");
const { PositionManager } = await import("../modules/binance/binance.position-manager.js");
const { UserStreamManager } = await import("../modules/binance/binance.user-stream.js");
const { SignalPipeline } = await import("../modules/trading/trading.pipeline.js");

const silentLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Listener = (event: { data: unknown }) => void;

class FakeSocket implements StreamSocket {
  private readonly listeners = new Map<string, Listener[]>();

  public constructor(public readonly url: string) {}

  public addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  public close(): void {
    this.emit("close");
  }

  public emit(type: string, data?: unknown): void {
    this.listeners.get(type)?.forEach((listener) => listener({ data }));
  }

  public send(event: Record<string, unknown>): void {
    this.emit("message", JSON.stringify(event));
  }
}

let mongo: MongoMemoryServer;

void describe("Binance user data stream", () => {
  before(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    await Promise.all(models.databaseModels.map((model) => model.syncIndexes()));
  });

  after(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  void it("syncs a trade the moment Binance reports its order changed, and reconnects", async () => {
    const exchange = new FakeBinance("RLCUSDT", 0.84);
    const client = new BinanceFuturesClient({
      baseUrl: "https://fake-stream.test",
      credentials: { apiKey: "key", apiSecret: "secret" },
      fetchFn: exchange.fetch
    });
    const registry = { get: () => Promise.resolve(client) } as unknown as Registry;

    const user = await models.UserModel.create({ name: "Owner", email: "stream@test", passwordHash: "!" });
    await models.BotSettingsModel.create({ userId: user._id, isEnabled: true, defaultMargin: 10 });
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
    const signal = await models.SignalModel.create({
      userId: user._id,
      telegramSourceId: source._id,
      telegramMessageId: "1",
      rawText: "Coin #RLC/USDT\nPosition: LONG\nLeverage: Cross 20×\nEntries: 0.8250 - 0.7900\nTargets: 0.8650, 0.9150, 0.9750\nStop Loss: 0.7550",
      receivedAt: new Date()
    });

    await new SignalPipeline({
      logger: silentLogger,
      registry,
      maxSignalAgeSeconds: 120,
      allowLiveTrading: false,
      getMarketClient: () => client
    }).process(signal._id.toString());

    // Interval far beyond the test: any sync below comes from the stream.
    const manager = new PositionManager({ registry, logger: silentLogger, intervalMs: 3_600_000 });
    const sockets: FakeSocket[] = [];
    const streams = new UserStreamManager({
      registry,
      target: manager,
      logger: silentLogger,
      refreshMs: 3_600_000,
      socketFactory: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      }
    });

    try {
      await streams.start();
      await wait(50);
      assert.equal(sockets.length, 1);
      assert.equal(sockets[0]?.url, "wss://demo-fstream.binance.com/private/ws/fake-listen-key");
      sockets[0]?.emit("open");
      assert.deepEqual(streams.getStatus().connected, 1);

      const execution = await models.TradeExecutionModel.findOne().lean();
      assert.ok(execution);
      const executionId = execution._id.toString();

      // First entry fills on the exchange; Binance pushes ORDER_TRADE_UPDATE.
      exchange.setPrice(0.82);
      sockets[0]?.send({ e: "ORDER_TRADE_UPDATE", o: { s: "RLCUSDT", c: `tfb-${executionId}-E1`, X: "FILLED" } });
      await wait(700);

      const takeProfits = exchange.openOrders().filter((order) => order.reduceOnly);
      assert.equal(takeProfits.length, 3, "TPs placed from the stream event, without polling");
      assert.equal(
        (await models.TradeExecutionModel.findById(executionId).lean())?.status,
        models.TradeExecutionStatus.Open
      );

      // A position change without our order id still triggers an account sync.
      exchange.setPrice(0.8);
      sockets[0]?.send({ e: "ACCOUNT_UPDATE", a: { P: [{ s: "RLCUSDT", pa: "165" }] } });
      await wait(700);
      const resized = exchange.openOrders().filter((order) => order.reduceOnly);
      assert.equal(
        Number(resized.reduce((total, order) => total + order.origQty, 0).toFixed(4)),
        165
      );

      // Dropped connection: a fresh listen key and socket follow.
      sockets[0]?.emit("close");
      assert.equal(streams.getStatus().connected, 0);
      await wait(1300);
      assert.equal(sockets.length, 2);
      assert.equal(exchange.listenKeyRequests, 2);
    } finally {
      streams.stop();
      await manager.stop();
    }
  });
});
