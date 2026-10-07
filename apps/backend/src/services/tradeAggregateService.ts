import type { Types } from "mongoose";

import {
  SignalModel,
  SignalStatus,
  TradeExecutionModel,
  TradeExecutionStatus,
  TradeModel,
  TradeStatus
} from "../models/index.js";

const FINAL_EXECUTION_STATUSES = [
  TradeExecutionStatus.Closed,
  TradeExecutionStatus.Cancelled,
  TradeExecutionStatus.Failed
];

/**
 * Recomputes a Trade (and its Signal) from its per-account executions. One
 * signal fans out to many accounts, so the Trade is a roll-up, not a ledger.
 */
export const refreshTradeAggregate = async (tradeId: Types.ObjectId): Promise<void> => {
  const [trade, executions] = await Promise.all([
    TradeModel.findById(tradeId),
    TradeExecutionModel.find({ tradeId }).lean()
  ]);

  if (!trade || executions.length === 0) {
    return;
  }

  const statuses = executions.map((execution) => execution.status);
  const sum = (field: "realizedPnL" | "fees" | "netPnL"): number =>
    executions.reduce((total, execution) => total + execution[field], 0);

  trade.realizedPnL = sum("realizedPnL");
  trade.fees = sum("fees");
  trade.netPnL = sum("netPnL");

  const hasOpen = statuses.some(
    (status) =>
      status === TradeExecutionStatus.Open || status === TradeExecutionStatus.PartiallyClosed
  );
  const allFinal = statuses.every((status) => FINAL_EXECUTION_STATUSES.includes(status));

  if (hasOpen) {
    trade.status = statuses.includes(TradeExecutionStatus.PartiallyClosed)
      ? TradeStatus.PartiallyClosed
      : TradeStatus.Open;
    trade.openedAt ??= new Date();
  } else if (allFinal) {
    const closed = executions.find(
      (execution) => execution.status === TradeExecutionStatus.Closed
    );
    trade.status = closed
      ? TradeStatus.Closed
      : statuses.every((status) => status === TradeExecutionStatus.Cancelled)
        ? TradeStatus.Cancelled
        : TradeStatus.Failed;
    trade.closeReason = closed?.closeReason;
    trade.closedAt ??= new Date();
  }

  const actualEntries = executions
    .map((execution) => execution.actualEntry)
    .filter((price): price is number => price !== undefined);
  if (actualEntries.length > 0) {
    trade.actualEntry =
      actualEntries.reduce((total, price) => total + price, 0) / actualEntries.length;
  }

  await trade.save();

  if (allFinal) {
    await SignalModel.updateOne(
      { _id: trade.signalId },
      { $set: { status: closedOrFailed(statuses) } }
    );
  }
};

const closedOrFailed = (statuses: TradeExecutionStatus[]): SignalStatus =>
  statuses.includes(TradeExecutionStatus.Closed) ||
  statuses.includes(TradeExecutionStatus.Cancelled)
    ? SignalStatus.Completed
    : SignalStatus.Failed;
