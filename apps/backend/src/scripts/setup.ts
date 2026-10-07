import { randomBytes } from "node:crypto";

import mongoose from "mongoose";

import { env } from "../config/env.js";
import {
  BinanceAccountModel,
  BinanceEnvironment,
  BotSettingsModel,
  TelegramChatType,
  TelegramSourceModel,
  UserModel,
  type UserDocument
} from "../models/index.js";
import { hashPassword } from "../services/authService.js";
import {
  checkBinanceCredentials,
  saveBinanceAccount
} from "../services/binanceAccountService.js";
import { ask, askNumber, askYesNo, closePrompt } from "./prompt.js";

const getOrCreateUser = async (): Promise<UserDocument> => {
  const existing = await UserModel.findOne().sort({ createdAt: 1 });

  if (existing) {
    console.log(`Using user ${existing.name} <${existing.email}>`);
    return existing;
  }

  console.log("No user yet - creating the owner account.");
  return UserModel.create({
    name: await ask("Your name", "Owner"),
    email: await ask("Your email", "owner@localhost"),
    // No login exists yet; this placeholder can never match a real password.
    passwordHash: `!disabled:${randomBytes(16).toString("hex")}`
  });
};

const configureSettings = async (user: UserDocument): Promise<void> => {
  const current =
    (await BotSettingsModel.findOne({ userId: user._id })) ??
    new BotSettingsModel({ userId: user._id });

  console.log("\nTrade settings (press Enter to keep the value in brackets)");
  current.defaultMargin = await askNumber(
    "Margin per trade in USDT (position size = margin x leverage)",
    current.defaultMargin || 10
  );
  current.defaultLeverage = await askNumber(
    "Leverage when the signal does not give one",
    current.defaultLeverage
  );
  current.maxLeverage = await askNumber("Maximum leverage (caps the signal)", current.maxLeverage);
  current.entryOrderCount = await askNumber(
    "Limit orders to split an entry range into (1-10)",
    current.entryOrderCount
  );
  current.entryTimeoutMinutes = await askNumber(
    "Cancel unfilled entries after (minutes)",
    current.entryTimeoutMinutes
  );
  current.maxOpenTrades = await askNumber("Max open trades per account", current.maxOpenTrades);
  current.maxDailyLoss = await askNumber(
    "Stop trading for the day after losing (USDT, 0 = no limit)",
    current.maxDailyLoss
  );
  current.moveStopToBreakeven = await askYesNo(
    "Move stop loss to entry after TP1",
    current.isNew ? true : current.moveStopToBreakeven
  );
  current.isEnabled = await askYesNo("Enable automatic trading", current.isEnabled);

  await current.save();
  console.log("Settings saved.");
};

const addTelegramSource = async (user: UserDocument): Promise<void> => {
  console.log("\nFind the chat ID with `npm run telegram:chats` (e.g. -1001234567890).");
  const chatId = await ask("Chat ID");

  if (!/^-?\d+$/.test(chatId)) {
    console.log("Chat ID must be a number.");
    return;
  }

  const name = await ask("Name for this source", "Signal group");
  const isChannel = await askYesNo("Is it a broadcast channel (not a group)", false);

  await TelegramSourceModel.updateOne(
    { userId: user._id, chatId },
    {
      $set: {
        name,
        chatType: isChannel ? TelegramChatType.Channel : TelegramChatType.Supergroup,
        isActive: true
      }
    },
    { upsert: true }
  );
  console.log(`Source "${name}" (${chatId}) saved.`);
};

const addBinanceAccount = async (user: UserDocument): Promise<void> => {
  if (!env.CREDENTIALS_ENCRYPTION_KEY) {
    console.log(
      "\nSet CREDENTIALS_ENCRYPTION_KEY in .env first:\n" +
        `  CREDENTIALS_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`
    );
    return;
  }

  const isLive = await askYesNo("\nIs this a LIVE (real money) account? 'n' = testnet", false);
  const environment = isLive ? BinanceEnvironment.Live : BinanceEnvironment.Testnet;
  console.log(
    isLive
      ? "Use an API key with Futures enabled, withdrawals DISABLED, and an IP whitelist."
      : "Create testnet keys at https://demo.binance.com (Futures demo trading -> API Management)."
  );

  const name = await ask("Account name", isLive ? "Main" : "Testnet");
  const apiKey = await ask("API key");
  const apiSecret = await ask("API secret");

  const check = await checkBinanceCredentials(environment, apiKey, apiSecret);

  if (check.ok) {
    console.log(`Connected. Available balance: ${check.availableBalance} USDT`);

    if (check.hedgeMode) {
      console.log(
        "WARNING: account is in Hedge Mode. Switch Futures to One-way Mode or trades will be skipped."
      );
    }
  } else {
    console.log(`Could not verify keys: ${check.error}`);

    if (!(await askYesNo("Save anyway", false))) {
      return;
    }
  }

  await saveBinanceAccount({ userId: user._id, name, environment, apiKey, apiSecret });
  console.log(`Binance account "${name}" (${environment}) saved with encrypted keys.`);

  if (isLive && !env.BINANCE_ALLOW_LIVE) {
    console.log("Note: LIVE accounts are only traded when BINANCE_ALLOW_LIVE=true in .env.");
  }
};

const setDashboardPassword = async (user: UserDocument): Promise<void> => {
  const password = await ask("\nNew dashboard password (min 8 characters)");

  if (password.length < 8) {
    console.log("Password must be at least 8 characters.");
    return;
  }

  user.passwordHash = await hashPassword(password);
  await user.save();
  console.log(`Dashboard login: ${user.email} / the password you just set.`);
};

const showStatus = async (user: UserDocument): Promise<void> => {
  const [settings, sources, accounts] = await Promise.all([
    BotSettingsModel.findOne({ userId: user._id }).lean(),
    TelegramSourceModel.find({ userId: user._id }).lean(),
    BinanceAccountModel.find({ userId: user._id }).lean()
  ]);

  console.log("\n=== Status ===");
  console.log(
    settings
      ? `Trading ${settings.isEnabled ? "ENABLED" : "disabled"} | margin ${settings.defaultMargin} USDT | leverage ${settings.defaultLeverage}x (max ${settings.maxLeverage}x) | ${settings.entryOrderCount} entry orders | breakeven after TP1: ${settings.moveStopToBreakeven ? "yes" : "no"}`
      : "Settings: not configured"
  );
  console.log("Telegram sources:");
  sources.forEach((source) =>
    console.log(`  - ${source.name} (${source.chatId}) ${source.isActive ? "active" : "inactive"}`)
  );
  console.log("Binance accounts:");
  accounts.forEach((account) =>
    console.log(`  - ${account.name} [${account.environment}] ${account.isActive ? "active" : "inactive"}`)
  );
};

const main = async (): Promise<void> => {
  await mongoose.connect(env.MONGODB_URI);
  const user = await getOrCreateUser();

  for (;;) {
    await showStatus(user);
    console.log(
      "\n1) Trade settings  2) Add Telegram source  3) Add Binance account  4) Dashboard password  0) Exit"
    );
    const choice = await ask("Choose", "0");

    if (choice === "1") await configureSettings(user);
    else if (choice === "2") await addTelegramSource(user);
    else if (choice === "3") await addBinanceAccount(user);
    else if (choice === "4") await setDashboardPassword(user);
    else break;
  }
};

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    closePrompt();
    await mongoose.disconnect();
  });
