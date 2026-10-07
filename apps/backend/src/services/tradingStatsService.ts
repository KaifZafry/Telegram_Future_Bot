import type { Types } from "mongoose";

import { DailyStatisticsModel } from "../models/index.js";

const utcDay = (date = new Date()): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

export const recordSignalOutcome = async (
  userId: Types.ObjectId,
  outcome: "executed" | "rejected"
): Promise<void> => {
  await DailyStatisticsModel.updateOne(
    { userId, date: utcDay() },
    {
      $inc: {
        totalSignals: 1,
        [outcome === "executed" ? "executedSignals" : "rejectedSignals"]: 1
      }
    },
    { upsert: true }
  );
};

export const recordClosedTrade = async (
  userId: Types.ObjectId,
  result: { realizedPnL: number; fees: number }
): Promise<void> => {
  const netPnL = result.realizedPnL - result.fees;
  const outcomeField =
    netPnL > 0 ? "winningTrades" : netPnL < 0 ? "losingTrades" : "breakevenTrades";
  const date = utcDay();

  const stats = await DailyStatisticsModel.findOneAndUpdate(
    { userId, date },
    {
      $inc: {
        [outcomeField]: 1,
        totalPnL: result.realizedPnL,
        totalFees: result.fees,
        netPnL
      }
    },
    { upsert: true, new: true }
  );

  const decided = stats.winningTrades + stats.losingTrades;
  stats.winRate = decided === 0 ? 0 : Number(((stats.winningTrades / decided) * 100).toFixed(2));
  await stats.save();
};

/** Today's (UTC) net PnL, used by the daily loss limit. */
export const getTodayNetPnL = async (userId: Types.ObjectId): Promise<number> => {
  const stats = await DailyStatisticsModel.findOne({ userId, date: utcDay() }).lean();
  return stats?.netPnL ?? 0;
};
