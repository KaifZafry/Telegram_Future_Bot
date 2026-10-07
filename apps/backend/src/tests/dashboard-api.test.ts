import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

import type { BinanceAccountClientRegistry as Registry } from "../modules/binance/binance.accounts.js";
import { FakeBinance } from "./support/fake-binance.js";

process.env.MONGODB_URI ??= "mongodb://placeholder/test";
process.env.LOG_LEVEL = "silent";
process.env.NODE_ENV = "test";

const models = await import("../models/index.js");
const { app } = await import("../app.js");
const { hashPassword } = await import("../services/authService.js");
const { runtime } = await import("../services/runtime.js");
const { writeSystemLog } = await import("../services/systemLogService.js");
const { BinanceFuturesClient } = await import("../modules/binance/binance.client.js");
const { PositionManager } = await import("../modules/binance/binance.position-manager.js");
const { SignalPipeline } = await import("../modules/trading/trading.pipeline.js");

const silentLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

let mongo: MongoMemoryServer;
let server: Server;
let baseUrl: string;
let cookie = "";
let exchange: FakeBinance;
let sourceId = "";

const api = async (
  path: string,
  init: { method?: string; body?: unknown; auth?: boolean } = {}
): Promise<{ status: number; body: { success: boolean; data?: unknown; error?: { code: string } }; headers: Headers }> => {
  const response = await fetch(`${baseUrl}/api${path}`, {
    method: init.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(init.auth === false ? {} : { cookie })
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body)
  });

  return {
    status: response.status,
    body: (await response.json()) as { success: boolean; data?: unknown; error?: { code: string } },
    headers: response.headers
  };
};

const RLC_SIGNAL = "Coin #RLC/USDT\nPosition: LONG\nLeverage: Cross 20×\nEntries: 0.8250 - 0.7900\nTargets: 0.8650, 0.9150, 0.9750\nStop Loss: 0.7550";

void describe("Dashboard API", () => {
  before(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    await Promise.all(models.databaseModels.map((model) => model.syncIndexes()));

    const user = await models.UserModel.create({
      name: "Owner",
      email: "owner@test.dev",
      passwordHash: await hashPassword("correct horse battery")
    });
    await models.BotSettingsModel.create({ userId: user._id, isEnabled: true, defaultMargin: 10 });
    sourceId = (
      await models.TelegramSourceModel.create({
        userId: user._id,
        name: "VIP",
        chatId: "-1001",
        chatType: models.TelegramChatType.Supergroup
      })
    )._id.toString();
    await models.BinanceAccountModel.create({
      userId: user._id,
      name: "Testnet",
      apiKeyEncrypted: "unused",
      apiSecretEncrypted: "unused",
      environment: models.BinanceEnvironment.Testnet
    });

    exchange = new FakeBinance("RLCUSDT", 0.84);
    const client = new BinanceFuturesClient({
      baseUrl: "https://fake-api.test",
      credentials: { apiKey: "key", apiSecret: "secret" },
      fetchFn: exchange.fetch
    });
    const registry = { get: () => Promise.resolve(client), invalidate: () => undefined } as unknown as Registry;
    runtime.registry = registry;
    runtime.positionManager = new PositionManager({ registry, logger: silentLogger, intervalMs: 60_000 });

    const signal = await models.SignalModel.create({
      userId: user._id,
      telegramSourceId: sourceId,
      telegramMessageId: "1",
      rawText: RLC_SIGNAL,
      receivedAt: new Date()
    });
    await new SignalPipeline({
      logger: silentLogger,
      registry,
      maxSignalAgeSeconds: 120,
      allowLiveTrading: false,
      getMarketClient: () => client
    }).process(signal._id.toString());

    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server.close();
    await mongoose.disconnect();
    await mongo.stop();
  });

  void it("rejects requests without a session", async () => {
    const response = await api("/dashboard/summary", { auth: false });
    assert.equal(response.status, 401);
    assert.equal(response.body.error?.code, "UNAUTHENTICATED");
  });

  void it("rejects a wrong password and accepts the right one with an httpOnly cookie", async () => {
    const wrong = await api("/auth/login", {
      method: "POST",
      auth: false,
      body: { email: "owner@test.dev", password: "nope" }
    });
    assert.equal(wrong.status, 401);

    const right = await api("/auth/login", {
      method: "POST",
      auth: false,
      body: { email: "OWNER@test.dev", password: "correct horse battery" }
    });
    assert.equal(right.status, 200);
    const setCookie = right.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    cookie = setCookie.split(";")[0] ?? "";

    const me = await api("/auth/me");
    assert.deepEqual(me.body.data, { name: "Owner", email: "owner@test.dev" });
  });

  void it("rejects a tampered session cookie", async () => {
    const tampered = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { cookie: `${cookie.slice(0, -3)}abc` }
    });
    assert.equal(tampered.status, 401);
  });

  void it("returns the overview summary", async () => {
    const { body } = await api("/dashboard/summary");
    const data = body.data as {
      trading: { enabled: boolean };
      today: { executedSignals: number };
      open: { pendingEntries: number };
      accounts: unknown[];
    };

    assert.equal(data.trading.enabled, true);
    assert.equal(data.today.executedSignals, 1);
    assert.equal(data.open.pendingEntries, 1);
    assert.equal(data.accounts.length, 1);
  });

  void it("lists signals with their source name and shows detail with orders", async () => {
    const list = await api("/signals");
    const [signal] = list.body.data as { _id: string; sourceName: string; symbol: string }[];
    assert.ok(signal);
    assert.equal(signal.sourceName, "VIP");
    assert.equal(signal.symbol, "RLCUSDT");

    const detail = await api(`/signals/${signal._id}`);
    const data = detail.body.data as { executions: { accountName: string; orders: unknown[] }[] };
    assert.equal(data.executions[0]?.accountName, "Testnet");
    assert.equal(data.executions[0]?.orders.length, 4);

    assert.equal((await api("/signals/not-an-id")).status, 404);
  });

  void it("validates and saves settings", async () => {
    const invalid = await api("/settings", {
      method: "PUT",
      body: { defaultLeverage: 50, maxLeverage: 20 }
    });
    assert.equal(invalid.status, 400);

    const badSymbol = await api("/settings", { method: "PUT", body: { blockedSymbols: ["DOGE"] } });
    assert.equal(badSymbol.status, 400);

    const saved = await api("/settings", {
      method: "PUT",
      body: { defaultMargin: 25, blockedSymbols: ["dogeusdt"] }
    });
    assert.equal(saved.status, 200);
    const data = saved.body.data as { defaultMargin: number; blockedSymbols: string[] };
    assert.equal(data.defaultMargin, 25);
    assert.deepEqual(data.blockedSymbols, ["DOGEUSDT"]);
  });

  void it("adds, pauses and removes Telegram sources", async () => {
    const created = await api("/sources", {
      method: "POST",
      body: { name: "Second group", chatId: "-1002" }
    });
    assert.equal(created.status, 201);
    const id = (created.body.data as { _id: string })._id;

    const paused = await api(`/sources/${id}`, { method: "PATCH", body: { isActive: false } });
    assert.equal((paused.body.data as { isActive: boolean }).isActive, false);

    await api(`/sources/${id}`, { method: "DELETE" });
    assert.equal(((await api("/sources")).body.data as unknown[]).length, 1);
  });

  void it("manually closes an open position from the dashboard", async () => {
    exchange.setPrice(0.82); // first entry fills
    await runtime.positionManager?.syncAll();
    assert.equal(exchange.positionAmt, 82.5);

    const [position] = (await api("/positions")).body.data as { _id: string; status: string }[];
    assert.ok(position);
    assert.equal(position.status, models.TradeExecutionStatus.Open);

    const closed = await api(`/positions/${position._id}/close`, { method: "POST" });
    assert.equal(closed.status, 200);
    assert.equal(exchange.positionAmt, 0, "position is market-closed");
    assert.equal(exchange.openOrders().length, 0, "entries and TPs cancelled");
    assert.equal(exchange.openAlgoOrders().length, 0, "stop loss cancelled");

    await runtime.positionManager?.syncAll();
    await runtime.positionManager?.syncAll();

    const [trade] = (await api("/trades")).body.data as { status: string; closeReason: string }[];
    assert.equal(trade?.status, models.TradeExecutionStatus.Closed);
    assert.equal(trade?.closeReason, models.TradeCloseReason.Manual);

    const again = await api(`/positions/${position._id}/close`, { method: "POST" });
    assert.equal(again.status, 409);
  });

  void it("requires explicit confirmation to close everything", async () => {
    assert.equal((await api("/positions/close-all", { method: "POST", body: {} })).status, 400);
    const confirmed = await api("/positions/close-all", { method: "POST", body: { confirm: true } });
    assert.equal(confirmed.status, 200);
  });

  void it("streams live events to the dashboard", async () => {
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/events`, {
      headers: { cookie },
      signal: controller.signal
    });
    assert.equal(response.headers.get("content-type"), "text/event-stream");

    assert.ok(response.body);
    const stream = response.body as unknown as AsyncIterable<Uint8Array>;
    await writeSystemLog({
      level: models.SystemLogLevel.Info,
      category: models.SystemLogCategory.System,
      message: "hello dashboard"
    });

    let received = "";
    for await (const chunk of stream) {
      received += new TextDecoder().decode(chunk);
      if (received.includes("hello dashboard")) break;
    }
    controller.abort();

    assert.match(received, /event: log/);
    assert.match(received, /hello dashboard/);
  });
});
