import type { Request, Response } from "express";
import { Types } from "mongoose";
import { z } from "zod";

import { getUserId } from "../middlewares/requireAuth.js";
import {
  BinanceAccountModel,
  BinanceEnvironment,
  BotSettingsModel,
  SystemLogCategory,
  SystemLogLevel,
  TelegramChatType,
  TelegramSourceModel,
  TradeExecutionModel,
  TradeExecutionStatus
} from "../models/index.js";
import {
  checkBinanceCredentials,
  saveBinanceAccount
} from "../services/binanceAccountService.js";
import { eventBus } from "../services/eventBus.js";
import { runtime } from "../services/runtime.js";
import { writeSystemLog } from "../services/systemLogService.js";
import { AppError } from "../utils/AppError.js";

const objectIdParam = (request: Request): Types.ObjectId => {
  const id = String(request.params.id);

  if (!Types.ObjectId.isValid(id)) {
    throw new AppError("Not found", 404, "NOT_FOUND");
  }

  return new Types.ObjectId(id);
};

const symbolList = z
  .array(z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,15}USDT$/, "Use symbols like BTCUSDT"))
  .max(500);

const settingsSchema = z
  .object({
    isEnabled: z.boolean(),
    defaultMargin: z.number().positive().max(1_000_000),
    defaultLeverage: z.number().int().min(1).max(125),
    maxLeverage: z.number().int().min(1).max(125),
    entryOrderCount: z.number().int().min(1).max(10),
    entryTimeoutMinutes: z.number().int().min(1).max(43_200),
    maxOpenTrades: z.number().int().min(1).max(100),
    maxDailyLoss: z.number().min(0),
    moveStopToBreakeven: z.boolean(),
    allowedSymbols: symbolList,
    blockedSymbols: symbolList
  })
  .partial();

const getOrCreateSettings = async (userId: Types.ObjectId) =>
  (await BotSettingsModel.findOne({ userId })) ?? (await BotSettingsModel.create({ userId }));

export const getSettings = async (_request: Request, response: Response): Promise<void> => {
  const settings = await getOrCreateSettings(getUserId(response));
  response.json({ success: true, data: settings.toObject() });
};

export const updateSettings = async (request: Request, response: Response): Promise<void> => {
  const updates = settingsSchema.parse(request.body);
  const userId = getUserId(response);
  const settings = await getOrCreateSettings(userId);
  const wasEnabled = settings.isEnabled;

  settings.set(updates);

  if (settings.defaultLeverage > settings.maxLeverage) {
    throw new AppError("Default leverage cannot exceed max leverage", 400, "VALIDATION_ERROR");
  }

  await settings.save();
  eventBus.publish({ type: "settings" });

  if (updates.isEnabled !== undefined && updates.isEnabled !== wasEnabled) {
    await writeSystemLog({
      level: SystemLogLevel.Warn,
      category: SystemLogCategory.System,
      userId,
      message: `Automatic trading ${settings.isEnabled ? "enabled" : "disabled"} from the dashboard`
    });
  }

  response.json({ success: true, data: settings.toObject() });
};

export const listSources = async (_request: Request, response: Response): Promise<void> => {
  const sources = await TelegramSourceModel.find({ userId: getUserId(response) })
    .sort({ createdAt: 1 })
    .lean();
  response.json({ success: true, data: sources });
};

const sourceSchema = z.object({
  name: z.string().trim().min(1).max(100),
  chatId: z.string().trim().regex(/^-?\d+$/, "Chat ID must be a number"),
  chatType: z.nativeEnum(TelegramChatType).default(TelegramChatType.Supergroup)
});

export const createSource = async (request: Request, response: Response): Promise<void> => {
  const input = sourceSchema.parse(request.body);
  const source = await TelegramSourceModel.findOneAndUpdate(
    { userId: getUserId(response), chatId: input.chatId },
    { $set: { name: input.name, chatType: input.chatType, isActive: true } },
    { upsert: true, new: true }
  );
  response.status(201).json({ success: true, data: source.toObject() });
};

const sourcePatchSchema = z
  .object({ name: z.string().trim().min(1).max(100), isActive: z.boolean() })
  .partial();

export const updateSource = async (request: Request, response: Response): Promise<void> => {
  const source = await TelegramSourceModel.findOneAndUpdate(
    { _id: objectIdParam(request), userId: getUserId(response) },
    { $set: sourcePatchSchema.parse(request.body) },
    { new: true }
  ).lean();

  if (!source) {
    throw new AppError("Source not found", 404, "NOT_FOUND");
  }

  response.json({ success: true, data: source });
};

export const deleteSource = async (request: Request, response: Response): Promise<void> => {
  await TelegramSourceModel.deleteOne({ _id: objectIdParam(request), userId: getUserId(response) });
  response.json({ success: true });
};

/** Groups and channels the logged-in Telegram account can read (user mode). */
export const listTelegramChats = async (_request: Request, response: Response): Promise<void> => {
  response.json({ success: true, data: (await runtime.telegram?.listChats()) ?? [] });
};

export const listAccounts = async (_request: Request, response: Response): Promise<void> => {
  const accounts = await BinanceAccountModel.find({ userId: getUserId(response) })
    .sort({ createdAt: 1 })
    .lean();
  response.json({ success: true, data: accounts });
};

const accountSchema = z.object({
  name: z.string().trim().min(1).max(50),
  environment: z.nativeEnum(BinanceEnvironment),
  apiKey: z.string().trim().min(10).max(200),
  apiSecret: z.string().trim().min(10).max(200)
});

/** Verifies the keys against Binance before storing them encrypted. */
export const createAccount = async (request: Request, response: Response): Promise<void> => {
  const input = accountSchema.parse(request.body);
  const check = await checkBinanceCredentials(input.environment, input.apiKey, input.apiSecret);

  if (!check.ok) {
    throw new AppError(`Binance rejected these keys: ${check.error}`, 400, "INVALID_CREDENTIALS");
  }

  const accountId = await saveBinanceAccount({ ...input, userId: getUserId(response) });
  runtime.registry?.invalidate(accountId.toString());

  response.status(201).json({
    success: true,
    data: {
      accountId,
      availableBalance: check.availableBalance,
      hedgeMode: check.hedgeMode
    }
  });
};

const accountPatchSchema = z.object({ isActive: z.boolean() });

export const updateAccount = async (request: Request, response: Response): Promise<void> => {
  const accountId = objectIdParam(request);
  const account = await BinanceAccountModel.findOneAndUpdate(
    { _id: accountId, userId: getUserId(response) },
    { $set: accountPatchSchema.parse(request.body) },
    { new: true }
  ).lean();

  if (!account) {
    throw new AppError("Account not found", 404, "NOT_FOUND");
  }

  response.json({ success: true, data: account });
};

export const deleteAccount = async (request: Request, response: Response): Promise<void> => {
  const accountId = objectIdParam(request);
  const openTrades = await TradeExecutionModel.countDocuments({
    binanceAccountId: accountId,
    status: {
      $in: [
        TradeExecutionStatus.Pending,
        TradeExecutionStatus.Executing,
        TradeExecutionStatus.Open,
        TradeExecutionStatus.PartiallyClosed
      ]
    }
  });

  if (openTrades > 0) {
    throw new AppError(
      "This account has open trades. Close them before removing the account.",
      409,
      "HAS_OPEN_TRADES"
    );
  }

  await BinanceAccountModel.deleteOne({ _id: accountId, userId: getUserId(response) });
  runtime.registry?.invalidate(accountId.toString());
  response.json({ success: true });
};

export const getAccountBalance = async (request: Request, response: Response): Promise<void> => {
  const accountId = objectIdParam(request);

  if (!(await BinanceAccountModel.exists({ _id: accountId, userId: getUserId(response) }))) {
    throw new AppError("Account not found", 404, "NOT_FOUND");
  }

  if (!runtime.registry) {
    throw new AppError("Exchange access is not available", 503, "UNAVAILABLE");
  }

  const client = await runtime.registry.get(accountId.toString());
  response.json({ success: true, data: { availableBalance: await client.getAvailableBalance() } });
};
