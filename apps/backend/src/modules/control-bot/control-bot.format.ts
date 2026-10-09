import { MarginType, SignalSide } from "../../models/index.js";
import type { TradeApprovalRequest } from "../trading/trading.approval.js";

export const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const signed = (value: number): string =>
  `${value > 0.005 ? "+" : value < -0.005 ? "−" : ""}${Math.abs(value).toFixed(2)}`;

const LEVEL_ICON: Record<string, string> = {
  INFO: "🔵",
  WARN: "⚠️",
  ERROR: "❌",
  FATAL: "❌"
};

/** A trading audit entry as a phone notification. */
export const formatAlert = (log: { level: string; category: string; message: string }): string => {
  const icon = /position closed/i.test(log.message)
    ? /net PnL -/.test(log.message)
      ? "🔴"
      : "🟢"
    : /TP\d? hit/i.test(log.message)
      ? "🎯"
      : (LEVEL_ICON[log.level] ?? "🔵");

  return `${icon} ${escapeHtml(log.message)}`;
};

const price = (value: string | number): string => {
  const numeric = Number(value);
  return numeric >= 1000 ? numeric.toFixed(2) : String(Number(numeric.toPrecision(6)));
};

export const formatApprovalRequest = (request: TradeApprovalRequest): string => {
  const { plan } = request;
  const legs = plan.legs
    .map((leg, index) =>
      leg.type === "MARKET"
        ? `  ${index + 1}. Market ${plan.entrySide} ${leg.quantity} (~${price(leg.referencePrice)})`
        : `  ${index + 1}. Limit ${plan.entrySide} ${leg.quantity} @ ${price(leg.price ?? 0)}`
    )
    .join("\n");
  const targets = plan.takeProfits
    .map((target, index) => `TP${index + 1} ${price(target.price)}`)
    .join(" · ");

  return [
    `🛎 <b>Approve this trade?</b>`,
    ``,
    `<b>${escapeHtml(request.symbol)}</b> ${request.side === SignalSide.Long ? "🟢 LONG" : "🔴 SHORT"} · ${request.marginType === MarginType.Isolated ? "Isolated" : "Cross"} ${plan.leverage}x`,
    `Margin ${plan.marginUsdt} USDT → ${plan.notionalUsdt} USDT position`,
    `Entries:\n${legs}`,
    `SL ${price(plan.stopLoss)} · ${targets}`,
    `Max loss at SL ≈ −${request.lossAtStopUsdt.toFixed(2)} USDT per account`,
    `Accounts: ${escapeHtml(request.accountNames.join(", "))}`,
    ``,
    `<i>Rejected automatically in ${request.timeoutSeconds}s if you don't answer.</i>`
  ].join("\n");
};

export interface PositionLine {
  symbol: string;
  side: string;
  status: string;
  accountName: string;
  unrealizedPnL: number;
  positionQuantity: number;
  actualEntry?: number;
  markPrice?: number;
  slMovedToBreakeven: boolean;
}

export const formatPosition = (position: PositionLine): string => {
  const waiting = position.status === "EXECUTING";
  const head = `<b>${escapeHtml(position.symbol)}</b> ${position.side === "LONG" ? "🟢 LONG" : "🔴 SHORT"} · ${escapeHtml(position.accountName)}`;

  if (waiting) {
    return `${head}\n⏳ Waiting for entry · mark ${position.markPrice ? price(position.markPrice) : "—"}`;
  }

  return [
    head,
    `${signed(position.unrealizedPnL)} USDT · size ${position.positionQuantity}`,
    `entry ${position.actualEntry ? price(position.actualEntry) : "—"} · mark ${position.markPrice ? price(position.markPrice) : "—"}${position.slMovedToBreakeven ? " · 🛡 risk-free" : ""}`
  ].join("\n");
};

export const HELP_TEXT = [
  "<b>Signal Desk</b> — your trading bot",
  "",
  "/status — trading switch, connections, open trades",
  "/positions — open trades, with a close button each",
  "/pnl — profit today, this week, all time",
  "/pause — stop taking new signals",
  "/resume — start taking signals again",
  "/panic — close every position and pause"
].join("\n");
