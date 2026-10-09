import type { Types } from "mongoose";

import {
  BotSettingsModel,
  SignalModel,
  SystemLogCategory,
  SystemLogLevel,
  TradeExecutionModel,
  TradeExecutionStatus,
  type Signal
} from "../../models/index.js";
import { writeSystemLog } from "../../services/systemLogService.js";
import { parseFollowUp, type FollowUp } from "../signal-parser/follow-up.parser.js";

interface ActionResult {
  applied: boolean;
  note: string;
}

/** The position actions follow-ups can trigger (implemented by PositionManager). */
export interface FollowUpPositions {
  closeExecution(executionId: string): Promise<{ closed: boolean; reason?: string }>;
  cancelEntries(executionId: string): Promise<ActionResult>;
  moveStopLoss(executionId: string, target: "breakeven" | number): Promise<ActionResult>;
  updateTakeProfits(
    executionId: string,
    takeProfits: { price: number; allocationPercentage: number }[]
  ): Promise<ActionResult>;
}

type SignalRecord = Signal & { _id: Types.ObjectId };

interface OpenTrade {
  executionId: string;
  symbol: string;
  telegramMessageId?: string;
}

const MANAGED_STATUSES = [
  TradeExecutionStatus.Executing,
  TradeExecutionStatus.Open,
  TradeExecutionStatus.PartiallyClosed
];

const ACTION_LABEL: Record<FollowUp["action"], string> = {
  CLOSE: "close",
  CANCEL: "cancel",
  BREAKEVEN: "stop loss to entry",
  MOVE_SL: "move stop loss"
};

/**
 * Acts on follow-up messages from a signal group: close, cancel, move stop to
 * entry, or tighten the stop. A follow-up only touches trades that came from
 * the same Telegram source, and must point at them by reply or coin name.
 */
export class FollowUpHandler {
  public constructor(private readonly positions: FollowUpPositions) {}

  /** Returns true when the message was a follow-up (acted on or not). */
  public async handle(signal: SignalRecord): Promise<boolean> {
    const followUp = parseFollowUp(signal.rawText);

    if (!followUp) {
      return false;
    }

    const settings = await BotSettingsModel.findOne({ userId: signal.userId })
      .select("followUpActions")
      .lean();

    if (settings && !settings.followUpActions) {
      await this.record(signal, followUp, [], ["follow-up actions are turned off in settings"]);
      return true;
    }

    const targets = await this.findTargets(signal, followUp);

    if (targets.length === 0) {
      await this.record(signal, followUp, [], ["no matching open trade from this source"]);
      await writeSystemLog({
        level: SystemLogLevel.Info,
        category: SystemLogCategory.Signal,
        userId: signal.userId,
        message: `Follow-up "${ACTION_LABEL[followUp.action]}" ignored: no matching open trade`,
        metadata: { signalId: signal._id.toString() }
      });
      return true;
    }

    const notes: string[] = [];

    for (const target of targets) {
      const result = await this.apply(target.executionId, followUp);
      notes.push(`${target.symbol}: ${result.note}`);
      await writeSystemLog({
        level: result.applied ? SystemLogLevel.Info : SystemLogLevel.Warn,
        category: SystemLogCategory.Trade,
        userId: signal.userId,
        message: `${target.symbol} follow-up "${ACTION_LABEL[followUp.action]}": ${result.note}`,
        metadata: { signalId: signal._id.toString(), executionId: target.executionId }
      });
    }

    await this.record(signal, followUp, targets.map((target) => target.executionId), notes);
    return true;
  }

  /**
   * The provider edited a signal that is already being traded: apply new take
   * profits, and a new stop loss only if it reduces risk.
   */
  public async applyEditedLevels(
    signalId: Types.ObjectId,
    levels: { stopLoss: number; takeProfits: { price: number; allocationPercentage: number }[] }
  ): Promise<string[]> {
    const executions = await TradeExecutionModel.find({ signalId, status: { $in: MANAGED_STATUSES } }).lean();
    const notes: string[] = [];

    for (const execution of executions) {
      const executionId = execution._id.toString();

      if (levels.stopLoss !== execution.stopLoss) {
        const result = await this.positions.moveStopLoss(executionId, levels.stopLoss);
        notes.push(`${execution.symbol} SL ${levels.stopLoss}: ${result.note}`);
      }

      const oldTargets = execution.takeProfits.map((target) => target.price).join(",");
      const newTargets = levels.takeProfits.map((target) => target.price).join(",");

      if (oldTargets !== newTargets) {
        const result = await this.positions.updateTakeProfits(executionId, levels.takeProfits);
        notes.push(`${execution.symbol} TPs ${newTargets}: ${result.note}`);
      }
    }

    return notes;
  }

  private async apply(executionId: string, followUp: FollowUp): Promise<ActionResult> {
    try {
      switch (followUp.action) {
        case "CLOSE": {
          const result = await this.positions.closeExecution(executionId);
          return { applied: result.closed, note: result.closed ? "closing at market" : (result.reason ?? "not open") };
        }
        case "CANCEL":
          return await this.positions.cancelEntries(executionId);
        case "BREAKEVEN":
          return await this.positions.moveStopLoss(executionId, "breakeven");
        case "MOVE_SL":
          return await this.positions.moveStopLoss(executionId, followUp.price ?? 0);
      }
    } catch (error) {
      return { applied: false, note: `failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private async findTargets(signal: SignalRecord, followUp: FollowUp): Promise<OpenTrade[]> {
    const executions = await TradeExecutionModel.find({
      userId: signal.userId,
      status: { $in: MANAGED_STATUSES }
    })
      .select("_id symbol signalId")
      .lean();
    const origins = await SignalModel.find({ _id: { $in: executions.map((execution) => execution.signalId) } })
      .select("_id telegramSourceId telegramMessageId")
      .lean();
    const originById = new Map(origins.map((origin) => [origin._id.toString(), origin]));

    const sameSource: OpenTrade[] = executions
      .filter((execution) =>
        originById.get(execution.signalId.toString())?.telegramSourceId.equals(signal.telegramSourceId)
      )
      .map((execution) => ({
        executionId: execution._id.toString(),
        symbol: execution.symbol,
        telegramMessageId: originById.get(execution.signalId.toString())?.telegramMessageId
      }));

    // 1. A Telegram reply to the original signal is unambiguous.
    if (signal.replyToMessageId) {
      return sameSource.filter((trade) => trade.telegramMessageId === signal.replyToMessageId);
    }

    // 2. The coin is named in the message.
    const named = sameSource.filter((trade) => followUp.symbols.includes(trade.symbol.replace(/USDT$/, "")));
    if (named.length > 0) {
      return named;
    }

    // 3. "Move SL to entry" with a single open trade from this group only reduces risk.
    if (followUp.action === "BREAKEVEN" && followUp.explicitSymbols.length === 0 && sameSource.length === 1) {
      return sameSource;
    }

    return [];
  }

  private async record(
    signal: SignalRecord,
    followUp: FollowUp,
    executionIds: string[],
    notes: string[]
  ): Promise<void> {
    await SignalModel.updateOne(
      { _id: signal._id },
      { $set: { followUp: { action: followUp.action, executionIds, notes } } }
    );
  }
}
