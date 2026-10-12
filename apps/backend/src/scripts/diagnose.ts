/**
 * Diagnostic script: checks every layer needed for live signal trading.
 * Run with: npm run diagnose
 *
 * It does NOT trade. It just prints what is and isn't configured.
 */
import "dotenv/config";

import mongoose from "mongoose";
import { TelegramClient } from "telegram";
import { LogLevel } from "telegram/extensions/Logger.js";
import { StringSession } from "telegram/sessions/index.js";

import { env } from "../config/env.js";
import {
  BinanceAccountModel,
  BinanceEnvironment,
  BotSettingsModel,
  SignalModel,
  TelegramSourceModel
} from "../models/index.js";
import { BinanceFuturesClient } from "../modules/binance/binance.client.js";
import { BINANCE_BASE_URLS } from "../modules/binance/binance.types.js";

const ok = (msg: string) => console.log(`  ✓  ${msg}`);
const warn = (msg: string) => console.log(`  ⚠  ${msg}`);
const fail = (msg: string) => console.log(`  ✗  ${msg}`);

const section = (title: string) => console.log(`\n── ${title} ──────────────────────────`);

const main = async (): Promise<void> => {
  console.log("\n=== Telegram Futures Bot — Diagnostic ===");

  // ── 1. MongoDB ──────────────────────────────────────────────────
  section("MongoDB");
  try {
    await mongoose.connect(env.MONGODB_URI);
    ok(`Connected to MongoDB`);
  } catch (error) {
    fail(`Cannot connect to MongoDB: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }

  // ── 2. BotSettings ──────────────────────────────────────────────
  section("Bot Settings");
  const settings = await BotSettingsModel.findOne().lean();
  if (!settings) {
    fail("No BotSettings found — run `npm run setup` → option 1");
  } else {
    if (settings.isEnabled) ok("Auto-trading is ENABLED");
    else fail("isEnabled = false — trading is OFF (run `npm run setup` → option 1 → enable)");

    if (settings.defaultMargin > 0) ok(`Margin = ${settings.defaultMargin} USDT`);
    else fail("defaultMargin = 0 — every plan will fail (run `npm run setup` → option 1)");

    ok(`Leverage = ${settings.defaultLeverage}x (max ${settings.maxLeverage}x)`);
    ok(`Entry orders = ${settings.entryOrderCount}`);
    ok(`Entry timeout = ${settings.entryTimeoutMinutes} min`);
    ok(`Max open trades = ${settings.maxOpenTrades}`);
    if (settings.requireApproval) warn("requireApproval = true — every trade needs Telegram bot approval");
  }

  // ── 3. Telegram Sources ─────────────────────────────────────────
  section("Telegram Sources (where signals come from)");
  const sources = await TelegramSourceModel.find().lean();
  if (sources.length === 0) {
    fail("No Telegram sources in DB — run `npm run setup` → option 2");
    warn("Without a source every incoming Telegram message is SILENTLY IGNORED");
  } else {
    for (const source of sources) {
      const status = source.isActive ? "active" : "inactive";
      if (source.isActive) ok(`"${source.name}" chatId=${source.chatId} [${source.chatType}]`);
      else warn(`"${source.name}" chatId=${source.chatId} [${status}] — add again to reactivate`);
    }
  }

  // ── 4. Telegram session + live chatId check ─────────────────────
  section("Telegram Session & Chat IDs");
  if (!env.TELEGRAM_API_ID || !env.TELEGRAM_API_HASH || !env.TELEGRAM_SESSION) {
    fail("TELEGRAM_API_ID / TELEGRAM_API_HASH / TELEGRAM_SESSION not set in .env");
  } else {
    const client = new TelegramClient(
      new StringSession(env.TELEGRAM_SESSION),
      env.TELEGRAM_API_ID,
      env.TELEGRAM_API_HASH,
      { connectionRetries: 3 }
    );
    client.setLogLevel(LogLevel.ERROR);

    try {
      await client.connect();

      if (!(await client.checkAuthorization())) {
        fail("TELEGRAM_SESSION is invalid or expired — run `npm run telegram:login` again");
      } else {
        ok("Telegram session is valid and authorized");

        // Print live chatId for every stored source so user can compare
        if (sources.length > 0) {
          console.log("\n  Fetching live chat IDs from Telegram to compare with stored ones…");
          const dialogs = await client.getDialogs({ limit: 500 });

          for (const source of sources) {
            const match = dialogs.find((d) => d.id?.toString() === source.chatId);
            if (match) {
              ok(`Source "${source.name}" found in dialogs as "${match.title}" (${source.chatId})`);
            } else {
              fail(
                `Source chatId ${source.chatId} NOT FOUND in your Telegram dialogs.\n` +
                `     Run \`npm run telegram:chats\` to get the correct IDs, then re-add via \`npm run setup\`.`
              );
            }
          }
        }
      }
    } catch (error) {
      fail(`Telegram connection failed: ${error instanceof Error ? error.message : error}`);
    } finally {
      await client.disconnect();
    }
  }

  // ── 5. Binance accounts ─────────────────────────────────────────
  section("Binance Accounts");
  const accounts = await BinanceAccountModel.find().lean();
  if (accounts.length === 0) {
    fail("No Binance accounts in DB — run `npm run setup` → option 3");
  } else {
    for (const account of accounts) {
      const isLive = account.environment === BinanceEnvironment.Live;
      const willTrade = account.isActive && (!isLive || env.BINANCE_ALLOW_LIVE);
      const envLabel = `[${account.environment}]`;

      if (!account.isActive) {
        warn(`"${account.name}" ${envLabel} inactive — will not trade`);
      } else if (isLive && !env.BINANCE_ALLOW_LIVE) {
        fail(
          `"${account.name}" ${envLabel} LIVE account but BINANCE_ALLOW_LIVE=false\n` +
          `     Set BINANCE_ALLOW_LIVE=true in .env, or add a TESTNET account instead`
        );
      } else {
        ok(`"${account.name}" ${envLabel} active — will trade`);
      }

      // Quick connectivity check (public endpoint, no keys needed)
      if (willTrade) {
        try {
          const publicClient = new BinanceFuturesClient({
            baseUrl: BINANCE_BASE_URLS[account.environment]
          });
          await publicClient.getMarkPrice("BTCUSDT");
          ok(`  ${BINANCE_BASE_URLS[account.environment]} is reachable`);
        } catch {
          fail(`  ${BINANCE_BASE_URLS[account.environment]} is NOT reachable — check network/firewall`);
        }
      }
    }
  }

  // ── 6. Recent signal history ─────────────────────────────────────
  section("Recent Signals (last 10 from DB)");
  const signals = await SignalModel.find()
    .sort({ _id: -1 })
    .limit(10)
    .select("status parseStatus rawText receivedAt rejectionReason")
    .lean();

  if (signals.length === 0) {
    warn("No signals ever stored — Telegram listener may never have received a message from a configured source");
  } else {
    for (const signal of signals) {
      const age = Math.round((Date.now() - new Date(signal.receivedAt).getTime()) / 1000);
      const text = signal.rawText.slice(0, 50).replace(/\n/g, " ");
      const reason = signal.rejectionReason ? ` | reason: ${signal.rejectionReason}` : "";
      console.log(`  [${signal.status}] ${age}s ago — "${text}"${reason}`);
    }
  }

  // ── 7. Summary ───────────────────────────────────────────────────
  section("Summary");
  console.log("  If 'Recent Signals' is empty:  Telegram listener is not receiving messages");
  console.log("  If messages show REJECTED:      check rejection reason above");
  console.log("  If chatId NOT FOUND:            re-run `npm run setup` → add Telegram source with correct ID");
  console.log("  If LIVE account blocked:        set BINANCE_ALLOW_LIVE=true or add a testnet account\n");

  await mongoose.disconnect();
};

main()
  .catch((error: unknown) => {
    console.error("\nDiagnostic failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    setTimeout(() => process.exit(), 500);
  });
