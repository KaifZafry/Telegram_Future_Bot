import type { Request, Response } from "express";
import { Types } from "mongoose";
import { z } from "zod";

import { getUserId } from "../middlewares/requireAuth.js";
import {
  BinanceAccountModel,
  BinanceEnvironment,
  BotSettingsModel,
  OrderModel,
  SignalModel,
  SignalStatus,
  TelegramSourceModel,
  TradeExecutionModel,
  TradeModel
} from "../models/index.js";
import { previewSignal } from "../modules/trading/trading.preview.js";
import { AppError } from "../utils/AppError.js";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.string().refine((value) => Types.ObjectId.isValid(value), "Invalid cursor").optional(),
  status: z.nativeEnum(SignalStatus).optional(),
  /** "signals" hides chatter that never parsed as a trade signal. */
  view: z.enum(["all", "signals"]).default("all")
});

export const listSignals = async (request: Request, response: Response): Promise<void> => {
  const query = listQuerySchema.parse(request.query);
  const userId = getUserId(response);
  const signals = await SignalModel.find({
    userId,
    ...(query.before ? { _id: { $lt: new Types.ObjectId(query.before) } } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.view === "signals" ? { symbol: { $exists: true } } : {})
  })
    .sort({ _id: -1 })
    .limit(query.limit)
    .lean();

  const sources = await TelegramSourceModel.find({ userId }).select("name").lean();
  const sourceNames = new Map(sources.map((source) => [source._id.toString(), source.name]));

  response.json({
    success: true,
    data: signals.map((signal) => ({
      ...signal,
      sourceName: sourceNames.get(signal.telegramSourceId.toString()) ?? "Unknown source"
    })),
    nextCursor: signals.length === query.limit ? signals.at(-1)?._id : undefined
  });
};

export const getSignal = async (request: Request, response: Response): Promise<void> => {
  const userId = getUserId(response);
  const id = String(request.params.id);

  if (!Types.ObjectId.isValid(id)) {
    throw new AppError("Signal not found", 404, "NOT_FOUND");
  }

  const signal = await SignalModel.findOne({ _id: id, userId }).lean();

  if (!signal) {
    throw new AppError("Signal not found", 404, "NOT_FOUND");
  }

  const [source, trade, executions] = await Promise.all([
    TelegramSourceModel.findById(signal.telegramSourceId).select("name chatId").lean(),
    TradeModel.findOne({ signalId: signal._id }).lean(),
    TradeExecutionModel.find({ signalId: signal._id }).lean()
  ]);
  const [orders, accounts] = await Promise.all([
    OrderModel.find({ tradeExecutionId: { $in: executions.map((execution) => execution._id) } })
      .sort({ createdAt: 1 })
      .lean(),
    BinanceAccountModel.find({ userId }).select("name environment").lean()
  ]);
  const accountNames = new Map(accounts.map((account) => [account._id.toString(), account.name]));

  response.json({
    success: true,
    data: {
      signal,
      source,
      trade,
      executions: executions.map((execution) => ({
        ...execution,
        accountName: accountNames.get(execution.binanceAccountId.toString()) ?? "Deleted account",
        orders: orders.filter(
          (order) => order.tradeExecutionId.toString() === execution._id.toString()
        )
      }))
    }
  });
};

const previewSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  environment: z.nativeEnum(BinanceEnvironment).optional()
});

/** Parses and sizes a pasted message with the user's settings, without trading. */
export const previewSignalText = async (request: Request, response: Response): Promise<void> => {
  const { text, environment } = previewSchema.parse(request.body);
  const userId = getUserId(response);
  const [settings, account] = await Promise.all([
    BotSettingsModel.findOne({ userId }).lean(),
    BinanceAccountModel.findOne({ userId, isActive: true }).select("environment").lean()
  ]);

  const preview = await previewSignal(text, {
    marginUsdt: settings?.defaultMargin || 10,
    defaultLeverage: settings?.defaultLeverage ?? 10,
    maxLeverage: settings?.maxLeverage ?? 20,
    entryOrderCount: settings?.entryOrderCount ?? 3,
    environment: environment ?? account?.environment ?? BinanceEnvironment.Live
  });

  response.json({ success: true, data: preview });
};
