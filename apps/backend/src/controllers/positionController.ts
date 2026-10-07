import type { Request, Response } from "express";
import { Types } from "mongoose";
import { z } from "zod";

import { getUserId } from "../middlewares/requireAuth.js";
import {
  BinanceAccountModel,
  OrderModel,
  TradeExecutionModel,
  TradeExecutionStatus
} from "../models/index.js";
import { runtime } from "../services/runtime.js";
import { AppError } from "../utils/AppError.js";

const OPEN_STATUSES = [
  TradeExecutionStatus.Executing,
  TradeExecutionStatus.Open,
  TradeExecutionStatus.PartiallyClosed
];

const FINAL_STATUSES = [
  TradeExecutionStatus.Closed,
  TradeExecutionStatus.Cancelled,
  TradeExecutionStatus.Failed
];

const accountNameMap = async (userId: Types.ObjectId): Promise<Map<string, string>> => {
  const accounts = await BinanceAccountModel.find({ userId }).select("name").lean();
  return new Map(accounts.map((account) => [account._id.toString(), account.name]));
};

/** Open and pending trades with their live orders, newest first. */
export const listPositions = async (_request: Request, response: Response): Promise<void> => {
  const userId = getUserId(response);
  const executions = await TradeExecutionModel.find({ userId, status: { $in: OPEN_STATUSES } })
    .sort({ createdAt: -1 })
    .lean();
  const [orders, accountNames] = await Promise.all([
    OrderModel.find({ tradeExecutionId: { $in: executions.map((execution) => execution._id) } })
      .sort({ createdAt: 1 })
      .lean(),
    accountNameMap(userId)
  ]);

  response.json({
    success: true,
    data: executions.map((execution) => ({
      ...execution,
      accountName: accountNames.get(execution.binanceAccountId.toString()) ?? "Deleted account",
      orders: orders.filter(
        (order) => order.tradeExecutionId.toString() === execution._id.toString()
      )
    }))
  });
};

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.string().refine((value) => Types.ObjectId.isValid(value), "Invalid cursor").optional(),
  outcome: z.enum(["all", "closed", "cancelled", "failed"]).default("all")
});

export const listTradeHistory = async (request: Request, response: Response): Promise<void> => {
  const query = historyQuerySchema.parse(request.query);
  const userId = getUserId(response);
  const statusFilter =
    query.outcome === "closed"
      ? [TradeExecutionStatus.Closed]
      : query.outcome === "cancelled"
        ? [TradeExecutionStatus.Cancelled]
        : query.outcome === "failed"
          ? [TradeExecutionStatus.Failed]
          : FINAL_STATUSES;

  const executions = await TradeExecutionModel.find({
    userId,
    status: { $in: statusFilter },
    ...(query.before ? { _id: { $lt: new Types.ObjectId(query.before) } } : {})
  })
    .sort({ _id: -1 })
    .limit(query.limit)
    .lean();
  const accountNames = await accountNameMap(userId);

  response.json({
    success: true,
    data: executions.map((execution) => ({
      ...execution,
      accountName: accountNames.get(execution.binanceAccountId.toString()) ?? "Deleted account"
    })),
    nextCursor: executions.length === query.limit ? executions.at(-1)?._id : undefined
  });
};

const requirePositionManager = () => {
  if (!runtime.positionManager) {
    throw new AppError("Position manager is not running", 503, "UNAVAILABLE");
  }

  return runtime.positionManager;
};

export const closePosition = async (request: Request, response: Response): Promise<void> => {
  const id = String(request.params.id);

  if (!Types.ObjectId.isValid(id)) {
    throw new AppError("Trade not found", 404, "NOT_FOUND");
  }

  const execution = await TradeExecutionModel.exists({ _id: id, userId: getUserId(response) });

  if (!execution) {
    throw new AppError("Trade not found", 404, "NOT_FOUND");
  }

  const result = await requirePositionManager().closeExecution(id);

  if (!result.closed) {
    throw new AppError(result.reason ?? "Trade could not be closed", 409, "NOT_OPEN");
  }

  response.json({ success: true });
};

const closeAllSchema = z.object({ confirm: z.literal(true) });

/** Emergency stop: cancels every open order and market-closes every bot position. */
export const closeAllPositions = async (request: Request, response: Response): Promise<void> => {
  closeAllSchema.parse(request.body);
  const closed = await requirePositionManager().closeAll();
  response.json({ success: true, data: { closed } });
};
