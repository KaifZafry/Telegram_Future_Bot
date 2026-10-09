import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { Bot } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

process.env.MONGODB_URI ??= "mongodb://placeholder/test";
process.env.LOG_LEVEL = "silent";

const models = await import("../models/index.js");
const { ControlBot } = await import("../modules/control-bot/control-bot.js");
const { eventBus } = await import("../services/eventBus.js");

const OWNER = 111;
const STRANGER = 999;
const silentLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface ApiCall {
  method: string;
  payload: Record<string, unknown>;
}

let mongo: MongoMemoryServer;
let updateId = 0;

const createBot = () => {
  const calls: ApiCall[] = [];
  const bot = new Bot("123:fake", {
    botInfo: { id: 1, is_bot: true, first_name: "Desk", username: "desk_bot" } as UserFromGetMe
  });
  bot.api.config.use((_previous, method, payload) => {
    calls.push({ method, payload });
    const result =
      method === "sendMessage"
        ? { message_id: calls.length, date: 0, chat: { id: OWNER, type: "private" }, text: "" }
        : true;
    return Promise.resolve({ ok: true, result } as never);
  });

  const trading = {
    closed: [] as string[],
    closeAllCalls: 0,
    closeExecution(executionId: string) {
      this.closed.push(executionId);
      return Promise.resolve({ closed: true });
    },
    closeAll() {
      this.closeAllCalls += 1;
      return Promise.resolve(2);
    }
  };

  const controlBot = new ControlBot({ bot, ownerChatId: String(OWNER), logger: silentLogger, trading });
  return { bot, calls, trading, controlBot };
};

const message = (chatId: number, text: string): Update => ({
  update_id: ++updateId,
  message: {
    message_id: updateId,
    date: Math.floor(Date.now() / 1000),
    chat: { id: chatId, type: "private", first_name: "K" },
    from: { id: chatId, is_bot: false, first_name: "K" },
    text,
    ...(text.startsWith("/")
      ? { entities: [{ type: "bot_command" as const, offset: 0, length: text.split(" ")[0]?.length ?? 0 }] }
      : {})
  }
});

const callback = (chatId: number, data: string): Update => ({
  update_id: ++updateId,
  callback_query: {
    id: `cb${updateId}`,
    from: { id: chatId, is_bot: false, first_name: "K" },
    chat_instance: "x",
    data,
    message: {
      message_id: 42,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: "private", first_name: "K" },
      text: "prompt"
    }
  }
});

const sentTexts = (calls: ApiCall[]) =>
  calls.filter((call) => call.method === "sendMessage").map((call) => String(call.payload.text));

void describe("Telegram control bot", () => {
  before(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
  });

  after(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  beforeEach(async () => {
    await Promise.all(
      Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({}))
    );
    const user = await models.UserModel.create({ name: "Owner", email: "o@test", passwordHash: "!" });
    await models.BotSettingsModel.create({ userId: user._id, isEnabled: true });
  });

  void it("only answers its owner; strangers just learn their chat ID", async () => {
    const { bot, calls } = createBot();

    await bot.handleUpdate(message(STRANGER, "/status"));
    assert.equal(calls.length, 0, "no reply to a stranger's command");

    await bot.handleUpdate(message(STRANGER, "/start"));
    assert.match(sentTexts(calls)[0] ?? "", /Your chat ID is <code>999<\/code>/);

    await bot.handleUpdate(message(OWNER, "/status"));
    assert.match(sentTexts(calls)[1] ?? "", /Auto-trading:<\/b> 🟢 on/);
  });

  void it("pauses instantly and resumes only after confirmation", async () => {
    const { bot } = createBot();
    const settings = () => models.BotSettingsModel.findOne().lean();

    await bot.handleUpdate(message(OWNER, "/pause"));
    assert.equal((await settings())?.isEnabled, false);

    await bot.handleUpdate(message(OWNER, "/resume"));
    assert.equal((await settings())?.isEnabled, false, "/resume alone changes nothing");

    await bot.handleUpdate(callback(OWNER, "resume:y"));
    assert.equal((await settings())?.isEnabled, true);
  });

  void it("panic closes everything and pauses trading after confirmation", async () => {
    const { bot, trading, calls } = createBot();

    await bot.handleUpdate(message(OWNER, "/panic"));
    assert.equal(trading.closeAllCalls, 0);

    await bot.handleUpdate(callback(OWNER, "panic:y"));
    assert.equal(trading.closeAllCalls, 1);
    assert.equal((await models.BotSettingsModel.findOne().lean())?.isEnabled, false);
    assert.ok(calls.some((call) => call.method === "editMessageText" && /Close sent for 2 trades/.test(String(call.payload.text))));
  });

  void it("forwards trade alerts but not chatter", async () => {
    const { calls, controlBot } = createBot();
    controlBot.attachAlerts();

    eventBus.publish({ type: "log", data: { level: "DEBUG", category: "SIGNAL", message: "Message is not a tradable signal", createdAt: "" } });
    eventBus.publish({ type: "log", data: { level: "INFO", category: "TRADE", message: "RLCUSDT position closed (TAKE_PROFIT) net PnL 4.2000 USDT", createdAt: "" } });
    await wait(20);
    await controlBot.stop();

    assert.deepEqual(sentTexts(calls), ["🟢 RLCUSDT position closed (TAKE_PROFIT) net PnL 4.2000 USDT"]);
  });

  void it("asks for approval with buttons and resolves on the owner's answer", async () => {
    const { bot, calls, controlBot } = createBot();
    const signalId = new mongoose.Types.ObjectId().toString();

    const decision = controlBot.requestApproval({
      signalId,
      symbol: "RLCUSDT",
      side: models.SignalSide.Long,
      marginType: models.MarginType.Cross,
      lossAtStopUsdt: 9.98,
      accountNames: ["Testnet"],
      timeoutSeconds: 60,
      plan: {
        symbol: "RLCUSDT",
        side: models.SignalSide.Long,
        entrySide: "BUY",
        exitSide: "SELL",
        leverage: 20,
        marginUsdt: 10,
        notionalUsdt: 200,
        averageEntryPrice: 0.8075,
        totalQuantity: 247.5,
        legs: [{ type: "LIMIT", price: "0.8250", quantity: "82.5", referencePrice: 0.825 }],
        stopLoss: "0.7550",
        takeProfits: [{ price: "0.8650", allocationPercentage: 100 }]
      }
    });
    await wait(10);

    const prompt = calls.find((call) => call.method === "sendMessage");
    assert.match(String(prompt?.payload.text), /Approve this trade\?/);
    assert.match(String(prompt?.payload.text), /Max loss at SL ≈ −9\.98 USDT/);
    assert.match(JSON.stringify(prompt?.payload.reply_markup), new RegExp(`ap:${signalId}:y`));

    await bot.handleUpdate(callback(STRANGER, `ap:${signalId}:y`));
    await bot.handleUpdate(callback(OWNER, `ap:${signalId}:y`));
    assert.deepEqual(await decision, { approved: true });
  });

  void it("rejects automatically when nobody answers in time", async () => {
    const { controlBot } = createBot();
    const decision = await controlBot.requestApproval({
      signalId: new mongoose.Types.ObjectId().toString(),
      symbol: "BTCUSDT",
      side: models.SignalSide.Short,
      marginType: models.MarginType.Cross,
      lossAtStopUsdt: 5,
      accountNames: ["Testnet"],
      timeoutSeconds: 0.05,
      plan: {
        symbol: "BTCUSDT",
        side: models.SignalSide.Short,
        entrySide: "SELL",
        exitSide: "BUY",
        leverage: 10,
        marginUsdt: 10,
        notionalUsdt: 100,
        averageEntryPrice: 60000,
        totalQuantity: 0.002,
        legs: [{ type: "MARKET", quantity: "0.002", referencePrice: 60000 }],
        stopLoss: "61000",
        takeProfits: [{ price: "58000", allocationPercentage: 100 }]
      }
    });

    assert.equal(decision.approved, false);
    assert.match(decision.reason ?? "", /No answer/);
  });

  void it("closes a position from its button after a second confirmation", async () => {
    const { bot, trading } = createBot();
    const id = new mongoose.Types.ObjectId().toString();

    await bot.handleUpdate(callback(OWNER, `cl:${id}`));
    assert.deepEqual(trading.closed, [], "first tap only asks");

    await bot.handleUpdate(callback(OWNER, `clc:${id}`));
    assert.deepEqual(trading.closed, [id]);
  });
});
