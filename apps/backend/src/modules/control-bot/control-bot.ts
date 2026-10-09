import { Bot, InlineKeyboard, type Context } from "grammy";
import type { Types } from "mongoose";

import {
  BotSettingsModel,
  DailyStatisticsModel,
  SystemLogCategory,
  SystemLogLevel,
  TradeExecutionModel,
  TradeExecutionStatus,
  UserModel,
  BinanceAccountModel
} from "../../models/index.js";
import { eventBus, type DashboardEvent } from "../../services/eventBus.js";
import { writeSystemLog } from "../../services/systemLogService.js";
import type {
  TradeApprovalDecision,
  TradeApprovalRequest,
  TradeApprover
} from "../trading/trading.approval.js";
import {
  HELP_TEXT,
  escapeHtml,
  formatAlert,
  formatApprovalRequest,
  formatPosition,
  signed
} from "./control-bot.format.js";

export interface ControlBotLogger {
  info(data: Record<string, unknown>, message: string): void;
  warn(data: Record<string, unknown>, message: string): void;
  error(data: Record<string, unknown>, message: string): void;
}

export interface ControlBotOptions {
  /** Prebuilt bot (tests pass one with botInfo and a stubbed API). */
  bot: Bot;
  ownerChatId?: string;
  logger: ControlBotLogger;
  trading: {
    closeExecution(executionId: string): Promise<{ closed: boolean; reason?: string }>;
    closeAll(): Promise<number>;
  };
  /** Extra lines for /status (Telegram listener, Binance stream…). */
  describeConnections?: () => string[];
}

interface PendingApproval {
  resolve: (decision: TradeApprovalDecision) => void;
  timer: NodeJS.Timeout;
  messageId?: number;
  text: string;
}

const OPEN_STATUSES = [
  TradeExecutionStatus.Executing,
  TradeExecutionStatus.Open,
  TradeExecutionStatus.PartiallyClosed
];

const utcDay = (offsetDays = 0): Date => {
  const date = new Date(Date.now() - offsetDays * 86_400_000);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

/**
 * Your private Telegram bot: pushes trade alerts, answers /status, /positions,
 * /pnl, can pause or panic-close, and (optionally) asks you to approve each
 * trade. It only ever talks to the configured owner chat.
 */
export class ControlBot implements TradeApprover {
  private readonly bot: Bot;
  private readonly ownerChatId?: string;
  private readonly logger: ControlBotLogger;
  private readonly trading: ControlBotOptions["trading"];
  private readonly describeConnections: () => string[];
  private readonly approvals = new Map<string, PendingApproval>();
  private sendChain: Promise<unknown> = Promise.resolve();
  private unsubscribe?: () => void;
  private running = false;

  public constructor(options: ControlBotOptions) {
    this.bot = options.bot;
    this.ownerChatId = options.ownerChatId;
    this.logger = options.logger;
    this.trading = options.trading;
    this.describeConnections = options.describeConnections ?? (() => []);
    this.registerHandlers();
  }

  /** Starts long polling and alert forwarding. Resolves once polling is running. */
  public async start(): Promise<void> {
    this.attachAlerts();

    await new Promise<void>((resolve, reject) => {
      this.bot
        .start({
          drop_pending_updates: true,
          allowed_updates: ["message", "callback_query"],
          onStart: () => resolve()
        })
        .catch(reject);
    });
    this.running = true;

    if (this.ownerChatId) {
      this.send("✅ Signal Desk is online. Send /help for commands.").catch(() => undefined);
    } else {
      this.logger.warn({}, "Control bot started without TELEGRAM_CONTROL_CHAT_ID; send /start to it to get your chat ID");
    }
  }

  /** Forwards trading audit logs to the owner. Public so tests can attach without polling. */
  public attachAlerts(): void {
    this.unsubscribe ??= eventBus.subscribe((event) => this.onEvent(event));
  }

  public async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    [...this.approvals.keys()].forEach((id) => this.settleApproval(id, { approved: false, reason: "Bot shutting down" }));

    if (this.running) {
      this.running = false;
      await this.bot.stop();
    }
  }

  public getStatus(): { configured: boolean; running: boolean } {
    return { configured: Boolean(this.ownerChatId), running: this.running };
  }

  public isAvailable(): boolean {
    return this.running && Boolean(this.ownerChatId);
  }

  public requestApproval(request: TradeApprovalRequest): Promise<TradeApprovalDecision> {
    const id = request.signalId;
    const text = formatApprovalRequest(request);

    return new Promise<TradeApprovalDecision>((resolve) => {
      const timer = setTimeout(
        () => this.settleApproval(id, { approved: false, reason: `No answer within ${request.timeoutSeconds}s` }),
        request.timeoutSeconds * 1000
      );
      this.approvals.set(id, { resolve, timer, text });

      this.send(text, new InlineKeyboard().text("✅ Approve", `ap:${id}:y`).text("❌ Reject", `ap:${id}:n`))
        .then((messageId) => {
          const pending = this.approvals.get(id);
          if (pending) pending.messageId = messageId;
        })
        .catch(() => this.settleApproval(id, { approved: false, reason: "Could not reach you on Telegram" }));
    });
  }

  // ------------------------------------------------------------------ internals

  private settleApproval(id: string, decision: TradeApprovalDecision): void {
    const pending = this.approvals.get(id);

    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    this.approvals.delete(id);
    pending.resolve(decision);

    if (pending.messageId && this.ownerChatId) {
      const outcome = decision.approved ? "✅ <b>Approved</b> — placing orders" : `❌ <b>Not traded</b> — ${escapeHtml(decision.reason ?? "rejected")}`;
      this.bot.api
        .editMessageText(this.ownerChatId, pending.messageId, `${pending.text}\n\n${outcome}`, { parse_mode: "HTML" })
        .catch(() => undefined);
    }
  }

  private onEvent(event: DashboardEvent): void {
    if (event.type !== "log" || !this.ownerChatId) {
      return;
    }

    const { level, category, message } = event.data;

    // Chatter and per-tick noise stay on the dashboard only.
    if (level === String(SystemLogLevel.Debug) || category === String(SystemLogCategory.Auth)) {
      return;
    }

    this.send(formatAlert({ level, category, message })).catch(() => undefined);
  }

  /** Sends to the owner in order (Telegram rate-limits bursts). Resolves with the message id. */
  private send(text: string, keyboard?: InlineKeyboard): Promise<number> {
    const chatId = this.ownerChatId;

    if (!chatId) {
      return Promise.reject(new Error("No owner chat configured"));
    }

    const result = this.sendChain.then(() =>
      this.bot.api.sendMessage(chatId, text, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        ...(keyboard ? { reply_markup: keyboard } : {})
      })
    );
    this.sendChain = result.catch((error: unknown) => {
      this.logger.error({ error }, "Telegram control bot could not send a message");
    });

    return result.then((message) => message.message_id);
  }

  private isOwner(context: Context): boolean {
    const chatId = context.chat?.id ?? context.from?.id;
    return Boolean(this.ownerChatId) && String(chatId) === this.ownerChatId;
  }

  private async ownerUserId(): Promise<Types.ObjectId | undefined> {
    return (await UserModel.findOne({ isActive: true }).sort({ createdAt: 1 }).select("_id").lean())?._id;
  }

  private registerHandlers(): void {
    // Strangers get nothing except their own chat ID on /start, so the owner can configure it.
    this.bot.use(async (context, next) => {
      if (this.isOwner(context)) {
        await next();
        return;
      }

      if (context.message?.text?.startsWith("/start")) {
        await context.reply(
          `Your chat ID is <code>${context.chat?.id ?? ""}</code>.\nSet <code>TELEGRAM_CONTROL_CHAT_ID=${context.chat?.id ?? ""}</code> in apps/backend/.env and restart the bot.`,
          { parse_mode: "HTML" }
        );
      }
    });

    this.bot.command(["start", "help"], (context) => context.reply(HELP_TEXT, { parse_mode: "HTML" }));
    this.bot.command("status", async (context) => context.reply(await this.statusText(), { parse_mode: "HTML" }));
    this.bot.command("pnl", async (context) => context.reply(await this.pnlText(), { parse_mode: "HTML" }));
    this.bot.command("positions", (context) => this.replyPositions(context));

    this.bot.command("pause", async (context) => {
      await this.setTrading(false);
      await context.reply("⏸ Auto-trading <b>paused</b>. Open trades are still managed. /resume to start again.", { parse_mode: "HTML" });
    });

    this.bot.command("resume", (context) =>
      context.reply("Turn auto-trading back on? New signals will place orders.", {
        reply_markup: new InlineKeyboard().text("▶️ Turn on", "resume:y").text("Cancel", "x")
      })
    );

    this.bot.command("panic", (context) =>
      context.reply("🚨 <b>Close every position at market and pause trading?</b>", {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard().text("🚨 Close everything", "panic:y").text("Cancel", "x")
      })
    );

    this.bot.callbackQuery(/^ap:([0-9a-f]{24}):([yn])$/, async (context) => {
      const [, id, answer] = context.match;
      const known = id ? this.approvals.has(id) : false;

      if (id) {
        this.settleApproval(id, answer === "y" ? { approved: true } : { approved: false, reason: "Rejected by you" });
      }

      await context.answerCallbackQuery(known ? (answer === "y" ? "Approved" : "Rejected") : "This request already expired");
    });

    this.bot.callbackQuery(/^cl:([0-9a-f]{24})$/, async (context) => {
      const id = context.match[1] as string;
      const execution = await TradeExecutionModel.findById(id).select("symbol").lean();
      await context.answerCallbackQuery();
      await context.reply(`Close <b>${escapeHtml(execution?.symbol ?? "this trade")}</b> at market now?`, {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard().text("Close at market", `clc:${id}`).text("Cancel", "x")
      });
    });

    this.bot.callbackQuery(/^clc:([0-9a-f]{24})$/, async (context) => {
      const result = await this.trading.closeExecution(context.match[1] as string);
      await context.answerCallbackQuery(result.closed ? "Closing…" : "Not open anymore");
      await context.editMessageText(result.closed ? "✅ Close sent. You'll get the result here." : `Nothing to close: ${escapeHtml(result.reason ?? "")}`, { parse_mode: "HTML" });
    });

    this.bot.callbackQuery("resume:y", async (context) => {
      await this.setTrading(true);
      await context.answerCallbackQuery("Auto-trading on");
      await context.editMessageText("▶️ Auto-trading is <b>on</b>.", { parse_mode: "HTML" });
    });

    this.bot.callbackQuery("panic:y", async (context) => {
      await context.answerCallbackQuery("Closing everything");
      await this.setTrading(false);
      const closed = await this.trading.closeAll();
      await context.editMessageText(`🚨 Trading paused. Close sent for ${closed} trade${closed === 1 ? "" : "s"}.`);
    });

    this.bot.callbackQuery("x", async (context) => {
      await context.answerCallbackQuery("Cancelled");
      await context.editMessageText("Cancelled.");
    });

    this.bot.catch((error) => {
      this.logger.error({ error: error.error }, "Telegram control bot handler failed");
    });
  }

  private async setTrading(isEnabled: boolean): Promise<void> {
    const userId = await this.ownerUserId();

    if (!userId) {
      return;
    }

    await BotSettingsModel.updateOne({ userId }, { $set: { isEnabled } }, { upsert: true });
    eventBus.publish({ type: "settings" });
    await writeSystemLog({
      level: SystemLogLevel.Warn,
      category: SystemLogCategory.System,
      userId,
      message: `Automatic trading ${isEnabled ? "enabled" : "disabled"} from Telegram`
    });
  }

  private async statusText(): Promise<string> {
    const userId = await this.ownerUserId();
    const [settings, accounts, open, today] = await Promise.all([
      BotSettingsModel.findOne({ userId }).lean(),
      BinanceAccountModel.find({ userId, isActive: true }).select("name environment").lean(),
      TradeExecutionModel.find({ userId, status: { $in: OPEN_STATUSES } }).select("status unrealizedPnL").lean(),
      DailyStatisticsModel.findOne({ userId, date: utcDay() }).lean()
    ]);
    const unrealized = open.reduce((total, execution) => total + execution.unrealizedPnL, 0);
    const waiting = open.filter((execution) => execution.status === TradeExecutionStatus.Executing).length;

    return [
      `<b>Auto-trading:</b> ${settings?.isEnabled ? "🟢 on" : "⏸ off"}${settings?.requireApproval ? " (asks you first)" : ""}`,
      `<b>Accounts:</b> ${accounts.length === 0 ? "none active" : escapeHtml(accounts.map((account) => `${account.name} (${account.environment.toLowerCase()})`).join(", "))}`,
      ...this.describeConnections(),
      `<b>Open:</b> ${open.length - waiting} · waiting for entry ${waiting} · unrealized ${signed(unrealized)} USDT`,
      `<b>Today:</b> ${signed(today?.netPnL ?? 0)} USDT · ${today?.winningTrades ?? 0}W ${today?.losingTrades ?? 0}L`
    ].join("\n");
  }

  private async pnlText(): Promise<string> {
    const userId = await this.ownerUserId();
    const rows = await DailyStatisticsModel.find({ userId }).select("date netPnL winningTrades losingTrades").lean();
    const since = (days: number) => rows.filter((row) => row.date >= utcDay(days));
    const sum = (list: typeof rows) => ({
      net: list.reduce((total, row) => total + row.netPnL, 0),
      wins: list.reduce((total, row) => total + row.winningTrades, 0),
      losses: list.reduce((total, row) => total + row.losingTrades, 0)
    });
    const line = (label: string, list: typeof rows) => {
      const totals = sum(list);
      return `<b>${label}:</b> ${signed(totals.net)} USDT · ${totals.wins}W ${totals.losses}L`;
    };

    return [line("Today", since(0)), line("7 days", since(6)), line("30 days", since(29)), line("All time", rows)].join("\n");
  }

  private async replyPositions(context: Context): Promise<void> {
    const userId = await this.ownerUserId();
    const executions = await TradeExecutionModel.find({ userId, status: { $in: OPEN_STATUSES } })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    if (executions.length === 0) {
      await context.reply("No open positions.");
      return;
    }

    const accounts = await BinanceAccountModel.find({ userId }).select("name").lean();
    const names = new Map(accounts.map((account) => [account._id.toString(), account.name]));

    for (const execution of executions) {
      await context.reply(
        formatPosition({ ...execution, accountName: names.get(execution.binanceAccountId.toString()) ?? "account" }),
        {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard().text(
            execution.status === TradeExecutionStatus.Executing ? "Cancel entry" : `Close ${execution.symbol}`,
            `cl:${execution._id.toString()}`
          )
        }
      );
    }
  }
}

export const createControlBot = (
  options: Omit<ControlBotOptions, "bot"> & { token: string }
): ControlBot => new ControlBot({ ...options, bot: new Bot(options.token) });
