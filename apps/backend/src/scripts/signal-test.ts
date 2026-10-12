import "dotenv/config";

import { parseArgs } from "node:util";

import { env } from "../config/env.js";
import { connectMongo, disconnectMongo } from "../config/mongodb.js";
import {
  BinanceAccountModel,
  BinanceEnvironment,
  SignalModel,
  TelegramSourceModel
} from "../models/index.js";
import { BinanceAccountClientRegistry, getPublicClient } from "../modules/binance/index.js";
import { SignalPipeline } from "../modules/trading/index.js";
import { logger } from "../utils/logger.js";

/**
 * Sends a synthetic signal through the real pipeline and places REAL orders on
 * your active Binance TESTNET account(s). Refuses to run if any active account
 * is not testnet.
 *
 *   npm run signal:test -- --symbol BTCUSDT --side LONG
 */
const main = async (): Promise<void> => {
  const { values } = parseArgs({
    options: {
      symbol: { type: "string", default: "BTCUSDT" },
      side: { type: "string", default: "LONG" }
    }
  });
  const symbol = (values.symbol as string).toUpperCase();
  const isLong = (values.side as string).toUpperCase() !== "SHORT";

  await connectMongo();

  const accounts = await BinanceAccountModel.find({ isActive: true }).lean();
  if (accounts.length === 0) {
    throw new Error("No active Binance account. Run `npm run setup`.");
  }
  if (accounts.some((account) => account.environment !== BinanceEnvironment.Testnet)) {
    throw new Error("An active account is not TESTNET; deactivate it before running this test.");
  }

  const source = await TelegramSourceModel.findOne({ userId: accounts[0]?.userId }).lean();
  if (!source) {
    throw new Error("No Telegram source configured. Run `npm run setup`.");
  }

  const client = getPublicClient(BinanceEnvironment.Testnet);
  const rules = await client.getSymbolRules(symbol);
  if (!rules) {
    throw new Error(`${symbol} is not listed on Binance testnet futures`);
  }

  const mark = await client.getMarkPrice(symbol);
  const decimals = rules.tickSize.includes(".") ? rules.tickSize.replace(/0+$/, "").split(".")[1]?.length ?? 0 : 0;
  const price = (factor: number): string => (mark * factor).toFixed(decimals);
  const dir = isLong ? 1 : -1;

  const text = [
    `#${symbol.replace(/USDT$/, "")}/USDT ${isLong ? "LONG" : "SHORT"}`,
    `Entry: ${price(1)}`,
    `TP1: ${price(1 + dir * 0.01)}`,
    `TP2: ${price(1 + dir * 0.02)}`,
    `SL: ${price(1 - dir * 0.02)}`
  ].join("\n");

  console.log(`Test signal (mark ${mark}):\n${text}\n`);

  const signal = await SignalModel.create({
    userId: source.userId,
    telegramSourceId: source._id,
    telegramMessageId: `test-${Date.now()}`,
    rawText: text,
    receivedAt: new Date()
  });

  const registry = new BinanceAccountClientRegistry();
  await new SignalPipeline({
    logger,
    registry,
    maxSignalAgeSeconds: env.SIGNAL_MAX_AGE_SECONDS,
    allowLiveTrading: false
  }).process(signal._id.toString());

  const result = await SignalModel.findById(signal._id).lean();
  console.log(`Signal status: ${result?.status}${result?.rejectionReason ? ` - ${result.rejectionReason}` : ""}`);

  for (const account of accounts) {
    const accountClient = await registry.get(account._id.toString());
    console.log(`\n"${account.name}" position:`, JSON.stringify(await accountClient.getPosition(symbol)));
    console.log("Open algo (SL/TP) orders:", JSON.stringify(await accountClient.getOpenAlgoOrders(symbol)));
  }
  console.log("\nCheck Binance testnet > Positions / Open Orders. Close it there when done.");
};

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectMongo();
    setTimeout(() => process.exit(), 500);
  });
