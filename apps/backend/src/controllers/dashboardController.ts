import type { Request, Response } from "express";
import { z } from "zod";

import { env } from "../config/env.js";
import { getUserId } from "../middlewares/requireAuth.js";
import {
  BinanceAccountModel,
  BotSettingsModel,
  DailyStatisticsModel,
  SignalModel,
  SystemLogLevel,
  SystemLogModel,
  TradeExecutionModel,
  TradeExecutionStatus
} from "../models/index.js";
import { eventBus } from "../services/eventBus.js";
import { runtime } from "../services/runtime.js";

const OPEN_STATUSES = [
  TradeExecutionStatus.Executing,
  TradeExecutionStatus.Open,
  TradeExecutionStatus.PartiallyClosed
];

const utcDay = (date = new Date()): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

export const getSummary = async (_request: Request, response: Response): Promise<void> => {
  const userId = getUserId(response);
  const [settings, accounts, today, allTime, openExecutions, lastSignal] = await Promise.all([
    BotSettingsModel.findOne({ userId }).lean(),
    BinanceAccountModel.find({ userId }).select("name environment isActive").lean(),
    DailyStatisticsModel.findOne({ userId, date: utcDay() }).lean(),
    DailyStatisticsModel.aggregate<{
      totalSignals: number;
      executedSignals: number;
      winningTrades: number;
      losingTrades: number;
      breakevenTrades: number;
      netPnL: number;
      totalFees: number;
    }>([
      { $match: { userId } },
      {
        $group: {
          _id: null,
          totalSignals: { $sum: "$totalSignals" },
          executedSignals: { $sum: "$executedSignals" },
          winningTrades: { $sum: "$winningTrades" },
          losingTrades: { $sum: "$losingTrades" },
          breakevenTrades: { $sum: "$breakevenTrades" },
          netPnL: { $sum: "$netPnL" },
          totalFees: { $sum: "$totalFees" }
        }
      }
    ]),
    TradeExecutionModel.find({ userId, status: { $in: OPEN_STATUSES } })
      .select("status unrealizedPnL")
      .lean(),
    SignalModel.findOne({ userId }).sort({ receivedAt: -1 }).select("receivedAt").lean()
  ]);

  const totals = allTime[0];
  const decided = (totals?.winningTrades ?? 0) + (totals?.losingTrades ?? 0);

  response.json({
    success: true,
    data: {
      trading: {
        enabled: settings?.isEnabled ?? false,
        configured: Boolean(settings),
        liveTradingAllowed: env.BINANCE_ALLOW_LIVE
      },
      telegram: runtime.telegram?.getStatus() ?? { enabled: false, running: false, mode: "user" },
      realtime: runtime.userStreams?.getStatus() ?? { accounts: 0, connected: 0 },
      controlBot: runtime.controlBot?.getStatus() ?? { configured: false, running: false },
      accounts,
      today: {
        totalSignals: today?.totalSignals ?? 0,
        executedSignals: today?.executedSignals ?? 0,
        rejectedSignals: today?.rejectedSignals ?? 0,
        winningTrades: today?.winningTrades ?? 0,
        losingTrades: today?.losingTrades ?? 0,
        netPnL: today?.netPnL ?? 0,
        winRate: today?.winRate ?? 0
      },
      allTime: {
        totalSignals: totals?.totalSignals ?? 0,
        executedSignals: totals?.executedSignals ?? 0,
        winningTrades: totals?.winningTrades ?? 0,
        losingTrades: totals?.losingTrades ?? 0,
        breakevenTrades: totals?.breakevenTrades ?? 0,
        netPnL: totals?.netPnL ?? 0,
        totalFees: totals?.totalFees ?? 0,
        winRate: decided === 0 ? 0 : ((totals?.winningTrades ?? 0) / decided) * 100
      },
      open: {
        count: openExecutions.filter((execution) => execution.status !== TradeExecutionStatus.Executing).length,
        pendingEntries: openExecutions.filter((execution) => execution.status === TradeExecutionStatus.Executing).length,
        unrealizedPnL: openExecutions.reduce((total, execution) => total + (execution.unrealizedPnL ?? 0), 0)
      },
      lastSignalAt: lastSignal?.receivedAt
    }
  });
};

const dailyQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

/** Daily PnL with a running cumulative total, oldest first. Missing days are filled with zero. */
export const getDailyStats = async (request: Request, response: Response): Promise<void> => {
  const { days } = dailyQuerySchema.parse(request.query);
  const from = utcDay(new Date(Date.now() - (days - 1) * 86_400_000));
  const rows = await DailyStatisticsModel.find({ userId: getUserId(response), date: { $gte: from } })
    .sort({ date: 1 })
    .lean();
  const byDay = new Map(rows.map((row) => [row.date.toISOString().slice(0, 10), row]));

  let cumulative = 0;
  const series = Array.from({ length: days }, (_, index) => {
    const date = new Date(from.getTime() + index * 86_400_000).toISOString().slice(0, 10);
    const row = byDay.get(date);
    cumulative += row?.netPnL ?? 0;

    return {
      date,
      netPnL: row?.netPnL ?? 0,
      cumulativePnL: cumulative,
      winningTrades: row?.winningTrades ?? 0,
      losingTrades: row?.losingTrades ?? 0,
      totalSignals: row?.totalSignals ?? 0
    };
  });

  response.json({ success: true, data: series });
};

const logsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  includeDebug: z.enum(["true", "false"]).default("false"),
  before: z.string().datetime().optional()
});

export const getLogs = async (request: Request, response: Response): Promise<void> => {
  const query = logsQuerySchema.parse(request.query);
  const logs = await SystemLogModel.find({
    ...(query.includeDebug === "true" ? {} : { level: { $ne: SystemLogLevel.Debug } }),
    ...(query.before ? { createdAt: { $lt: new Date(query.before) } } : {})
  })
    .sort({ createdAt: -1 })
    .limit(query.limit)
    .lean();

  response.json({ success: true, data: logs });
};

/** Server-Sent Events stream of live updates (new logs, position ticks). */
export const streamEvents = (request: Request, response: Response): void => {
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  response.write("retry: 3000\n\n");

  const unsubscribe = eventBus.subscribe((event) => {
    response.write(`event: ${event.type}\ndata: ${JSON.stringify("data" in event ? event.data : {})}\n\n`);
  });
  const heartbeat = setInterval(() => {
    response.write(": ping\n\n");
  }, 25_000);

  request.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
};
