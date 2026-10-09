import type { Types } from "mongoose";

import {
  BinanceAccountModel,
  BinanceEnvironment,
  BotSettingsModel,
  MarginType,
  SignalModel,
  SignalStatus,
  SystemLogCategory,
  SystemLogLevel,
  TradeExecutionModel,
  TradeExecutionStatus,
  TradeModel,
  type BinanceAccount,
  type BotSettings
} from "../../models/index.js";
import { writeSystemLog } from "../../services/systemLogService.js";
import { refreshTradeAggregate } from "../../services/tradeAggregateService.js";
import {
  getTodayNetPnL,
  recordSignalOutcome
} from "../../services/tradingStatsService.js";
import {
  getPublicClient,
  type BinanceAccountClientRegistry
} from "../binance/binance.accounts.js";
import type { BinanceFuturesClient } from "../binance/binance.client.js";
import { executeOnAccount } from "../binance/binance.executor.js";
import type { TradeApprovalDecision, TradeApprover } from "./trading.approval.js";
import type { FollowUpHandler } from "./trading.follow-up.js";
import { buildExecutionPlan, type ExecutionPlan } from "../binance/binance.planner.js";
import {
  createSignalParserService,
  type NormalizedSignal,
  type SignalParserService
} from "../signal-parser/index.js";

export interface SignalPipelineLogger {
  info(data: Record<string, unknown>, message: string): void;
  warn(data: Record<string, unknown>, message: string): void;
  error(data: Record<string, unknown>, message: string): void;
}

export interface SignalPipelineOptions {
  logger: SignalPipelineLogger;
  registry: BinanceAccountClientRegistry;
  maxSignalAgeSeconds: number;
  allowLiveTrading: boolean;
  parser?: SignalParserService;
  /** Market data source for sizing; defaults to Binance public endpoints. */
  getMarketClient?: (environment: BinanceEnvironment) => BinanceFuturesClient;
  /** Used when the owner has turned on "approve each trade". */
  approver?: TradeApprover;
  /** Acts on follow-up messages ("close RLC", "move SL to entry"). */
  followUps?: FollowUpHandler;
}

type AccountRecord = BinanceAccount & { _id: Types.ObjectId };

const OPEN_EXECUTION_STATUSES = [
  TradeExecutionStatus.Pending,
  TradeExecutionStatus.Executing,
  TradeExecutionStatus.Open,
  TradeExecutionStatus.PartiallyClosed
];

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Signal -> trades. Runs after a Telegram message is stored: parses it, applies
 * the user's risk rules, sizes the trade, and opens it on every active Binance
 * account. Any rule failure rejects the signal with a recorded reason; nothing
 * is ever traded from a message that did not fully parse and validate.
 */
export class SignalPipeline {
  private readonly logger: SignalPipelineLogger;
  private readonly registry: BinanceAccountClientRegistry;
  private readonly parser: SignalParserService;
  private readonly maxSignalAgeSeconds: number;
  private readonly allowLiveTrading: boolean;
  private readonly getMarketClient: (environment: BinanceEnvironment) => BinanceFuturesClient;
  private readonly approver?: TradeApprover;
  private readonly followUps?: FollowUpHandler;

  public constructor(options: SignalPipelineOptions) {
    this.logger = options.logger;
    this.registry = options.registry;
    this.parser = options.parser ?? createSignalParserService();
    this.maxSignalAgeSeconds = options.maxSignalAgeSeconds;
    this.allowLiveTrading = options.allowLiveTrading;
    this.getMarketClient = options.getMarketClient ?? getPublicClient;
    this.approver = options.approver;
    this.followUps = options.followUps;
  }

  /**
   * The group edited a message. Never-traded messages are processed again
   * (an incomplete post may now be a full signal); for a signal already being
   * traded, new take profits are applied and a new stop only if it is tighter.
   */
  public async processEdit(signalId: string): Promise<void> {
    const signal = await SignalModel.findById(signalId).lean();

    if (!signal || signal.followUp) {
      return;
    }

    if (!(await TradeExecutionModel.exists({ signalId: signal._id }))) {
      await this.process(signalId, { reparse: true });
      return;
    }

    const parsed = this.parser.parseSignalText(signal.rawText);

    if (!parsed.success || !this.followUps) {
      return;
    }

    const notes = await this.followUps.applyEditedLevels(signal._id, {
      stopLoss: parsed.data.stopLoss,
      takeProfits: parsed.data.takeProfits
    });

    await writeSystemLog({
      level: SystemLogLevel.Info,
      category: SystemLogCategory.Signal,
      userId: signal.userId,
      message: `${parsed.data.symbol} signal edited by the group: ${notes.length > 0 ? notes.join("; ") : "no change to apply"}`,
      metadata: { signalId }
    });
  }

  public async process(signalId: string, options: { reparse?: boolean } = {}): Promise<void> {
    const parsed = await this.parser.parseAndUpdateSignal(signalId, { force: options.reparse });

    if (!parsed.parsed || !parsed.result?.success) {
      const message = await SignalModel.findById(signalId).lean();

      // Not a full signal: it may be an instruction about an open trade.
      if (message && this.followUps && (await this.followUps.handle(message))) {
        return;
      }

      const failure = parsed.result && !parsed.result.success ? parsed.result : undefined;
      await writeSystemLog({
        level: SystemLogLevel.Debug,
        category: SystemLogCategory.Signal,
        message: `Message is not a tradable signal${failure ? `: ${failure.errorMessage}` : ""}`,
        metadata: { signalId, reason: parsed.reason, errorCode: failure?.errorCode }
      });
      return;
    }

    const signal = await SignalModel.findById(signalId).lean();

    if (!signal) {
      return;
    }

    const data = parsed.result.data;
    const reject = (reason: string): Promise<void> =>
      this.rejectSignal(signal._id, signal.userId, data, reason);

    // An edited message counts from its edit, so a quick correction can still trade.
    const ageSeconds = (Date.now() - new Date(signal.editedAt ?? signal.receivedAt).getTime()) / 1000;
    if (ageSeconds > this.maxSignalAgeSeconds) {
      return reject(`Signal is ${Math.round(ageSeconds)}s old (max ${this.maxSignalAgeSeconds}s)`);
    }

    const settings = await BotSettingsModel.findOne({ userId: signal.userId }).lean();
    if (!settings) {
      return reject("Bot settings are not configured; run `npm run setup`");
    }

    const riskRejection = await this.checkRiskRules(signal.userId, data, settings);
    if (riskRejection) {
      return reject(riskRejection);
    }

    const accounts = await this.getTradableAccounts(signal.userId, data.symbol, settings);
    if (accounts.length === 0) {
      return reject("No Binance account is available to trade this signal");
    }

    const leverage = Math.min(data.leverage ?? settings.defaultLeverage, settings.maxLeverage);
    let planning = await this.buildPlans(accounts, data, settings, leverage);

    if (!planning.ok) {
      return reject(planning.reason);
    }

    if (settings.requireApproval) {
      const decision = await this.requestApproval(signal._id, data, accounts, planning.plans, settings);

      if (!decision.approved) {
        return reject(decision.reason ?? "Not approved");
      }

      // Prices moved while waiting; size and route the trade again before placing it.
      planning = await this.buildPlans(accounts, data, settings, leverage);

      if (!planning.ok) {
        return reject(`Approved, but no longer tradable: ${planning.reason}`);
      }
    }

    const plans = planning.plans;
    const firstPlan = [...plans.values()][0] as ExecutionPlan;
    const trade = await TradeModel.create({
      userId: signal.userId,
      signalId: signal._id,
      symbol: data.symbol,
      side: data.side,
      requestedEntry: data.entry,
      totalQuantity: accounts.reduce(
        (total, account) => total + (plans.get(account.environment)?.totalQuantity ?? 0),
        0
      ),
      leverage,
      stopLoss: Number(firstPlan.stopLoss),
      takeProfits: data.takeProfits
    });

    await SignalModel.updateOne(
      { _id: signal._id },
      { $set: { status: SignalStatus.Executing, validatedAt: new Date() } }
    );

    const results = await Promise.all(
      accounts.map(async (account) => {
        const plan = plans.get(account.environment) as ExecutionPlan;

        try {
          const result = await executeOnAccount({
            signal: {
              _id: signal._id,
              userId: signal.userId,
              side: data.side,
              entry: data.entry
            },
            tradeId: trade._id,
            account,
            plan,
            marginType: data.marginType ?? MarginType.Cross,
            entryTimeoutMinutes: settings.entryTimeoutMinutes,
            client: await this.registry.get(account._id.toString())
          });

          await writeSystemLog({
            level: result.status === "placed" ? SystemLogLevel.Info : SystemLogLevel.Warn,
            category: SystemLogCategory.Binance,
            userId: signal.userId,
            message:
              result.status === "placed"
                ? `${data.symbol} ${data.side} orders placed on "${account.name}"`
                : `${data.symbol} not traded on "${account.name}": ${result.reason}`,
            metadata: {
              signalId,
              account: account.name,
              environment: account.environment,
              legs: plan.legs,
              ...(result.status === "placed" && result.warnings.length > 0
                ? { warnings: result.warnings }
                : {})
            }
          });

          return {
            status: result.status,
            reason: result.status === "placed" ? undefined : `${account.name}: ${result.reason}`
          };
        } catch (error) {
          await writeSystemLog({
            level: SystemLogLevel.Error,
            category: SystemLogCategory.Binance,
            userId: signal.userId,
            message: `${data.symbol} execution error on "${account.name}": ${errorMessage(error)}`,
            metadata: { signalId }
          });
          return {
            status: "failed" as const,
            reason: `${account.name}: ${errorMessage(error)}`
          };
        }
      })
    );

    const placedCount = results.filter((result) => result.status === "placed").length;

    if (placedCount > 0) {
      await SignalModel.updateOne(
        { _id: signal._id },
        { $set: { status: SignalStatus.Executed } }
      );
      await recordSignalOutcome(signal.userId, "executed");
      await refreshTradeAggregate(trade._id);
      return;
    }

    // Nothing was opened anywhere: drop the Trade unless an execution record
    // (e.g. a failed attempt) still references it.
    if ((await TradeExecutionModel.countDocuments({ tradeId: trade._id })) === 0) {
      await TradeModel.deleteOne({ _id: trade._id });
    } else {
      await refreshTradeAggregate(trade._id);
    }

    const reason = results.map((result) => result.reason).join("; ");

    if (results.some((result) => result.status === "failed")) {
      await SignalModel.updateOne(
        { _id: signal._id },
        { $set: { status: SignalStatus.Failed, rejectionReason: reason } }
      );
      await recordSignalOutcome(signal.userId, "rejected");
      return;
    }

    await this.rejectSignal(signal._id, signal.userId, data, reason);
  }

  private async buildPlans(
    accounts: AccountRecord[],
    signal: NormalizedSignal,
    settings: BotSettings,
    leverage: number
  ): Promise<{ ok: true; plans: Map<BinanceEnvironment, ExecutionPlan> } | { ok: false; reason: string }> {
    const plans = new Map<BinanceEnvironment, ExecutionPlan>();

    for (const environment of new Set(accounts.map((account) => account.environment))) {
      const planResult = await this.buildPlan(environment, signal, settings, leverage);

      if (!planResult.ok) {
        return planResult;
      }

      plans.set(environment, planResult.plan);
    }

    return { ok: true, plans };
  }

  private async requestApproval(
    signalId: Types.ObjectId,
    signal: NormalizedSignal,
    accounts: AccountRecord[],
    plans: Map<BinanceEnvironment, ExecutionPlan>,
    settings: BotSettings
  ): Promise<TradeApprovalDecision> {
    if (!this.approver?.isAvailable()) {
      return {
        approved: false,
        reason: "Trade approval is on, but the Telegram control bot is not connected"
      };
    }

    const plan = [...plans.values()][0] as ExecutionPlan;
    await SignalModel.updateOne({ _id: signalId }, { $set: { status: SignalStatus.Validated } });

    return this.approver.requestApproval({
      signalId: signalId.toString(),
      symbol: signal.symbol,
      side: signal.side,
      marginType: signal.marginType ?? MarginType.Cross,
      plan,
      lossAtStopUsdt: Math.abs(plan.averageEntryPrice - Number(plan.stopLoss)) * plan.totalQuantity,
      accountNames: accounts.map((account) => account.name),
      timeoutSeconds: settings.approvalTimeoutSeconds
    });
  }

  private async checkRiskRules(
    userId: Types.ObjectId,
    signal: NormalizedSignal,
    settings: BotSettings
  ): Promise<string | undefined> {
    if (!settings.isEnabled) {
      return "Bot trading is disabled in settings";
    }

    if (settings.blockedSymbols.includes(signal.symbol)) {
      return `${signal.symbol} is in the blocked symbol list`;
    }

    if (settings.allowedSymbols.length > 0 && !settings.allowedSymbols.includes(signal.symbol)) {
      return `${signal.symbol} is not in the allowed symbol list`;
    }

    if (settings.maxDailyLoss > 0) {
      const todayNetPnL = await getTodayNetPnL(userId);

      if (todayNetPnL <= -settings.maxDailyLoss) {
        return `Daily loss limit reached (${todayNetPnL.toFixed(2)} / -${settings.maxDailyLoss} USDT)`;
      }
    }

    return undefined;
  }

  private async getTradableAccounts(
    userId: Types.ObjectId,
    symbol: string,
    settings: BotSettings
  ): Promise<AccountRecord[]> {
    const accounts = await BinanceAccountModel.find({ userId, isActive: true }).lean<
      AccountRecord[]
    >();
    const tradable: AccountRecord[] = [];

    for (const account of accounts) {
      if (account.environment === BinanceEnvironment.Live && !this.allowLiveTrading) {
        this.logger.warn(
          { account: account.name },
          "Skipping LIVE account because BINANCE_ALLOW_LIVE is not true"
        );
        continue;
      }

      const openExecutions = await TradeExecutionModel.countDocuments({
        binanceAccountId: account._id,
        status: { $in: OPEN_EXECUTION_STATUSES }
      });

      if (openExecutions >= settings.maxOpenTrades) {
        this.logger.warn(
          { account: account.name, symbol, openExecutions, maxOpenTrades: settings.maxOpenTrades },
          "Skipping account: max open trades reached"
        );
        continue;
      }

      tradable.push(account);
    }

    return tradable;
  }

  private async buildPlan(
    environment: BinanceEnvironment,
    signal: NormalizedSignal,
    settings: BotSettings,
    leverage: number
  ): Promise<ReturnType<typeof buildExecutionPlan>> {
    const client = this.getMarketClient(environment);
    const rules = await client.getSymbolRules(signal.symbol);

    if (!rules) {
      return { ok: false, reason: `${signal.symbol} is not listed on Binance Futures (${environment})` };
    }

    return buildExecutionPlan({
      symbol: signal.symbol,
      side: signal.side,
      entry: signal.entry,
      stopLoss: signal.stopLoss,
      takeProfits: signal.takeProfits,
      markPrice: await client.getMarkPrice(signal.symbol),
      marginUsdt: settings.defaultMargin,
      leverage,
      entryOrderCount: settings.entryOrderCount,
      rules
    });
  }

  private async rejectSignal(
    signalId: Types.ObjectId,
    userId: Types.ObjectId,
    signal: NormalizedSignal,
    reason: string
  ): Promise<void> {
    await SignalModel.updateOne(
      { _id: signalId },
      { $set: { status: SignalStatus.Rejected, rejectionReason: reason } }
    );
    await recordSignalOutcome(userId, "rejected");
    await writeSystemLog({
      level: SystemLogLevel.Warn,
      category: SystemLogCategory.Signal,
      userId,
      message: `${signal.symbol} ${signal.side} signal rejected: ${reason}`,
      metadata: { signalId: signalId.toString() }
    });
  }
}
