import type { MarginType, SignalSide } from "../../models/index.js";
import type { ExecutionPlan } from "../binance/binance.planner.js";

export interface TradeApprovalRequest {
  signalId: string;
  symbol: string;
  side: SignalSide;
  marginType: MarginType;
  plan: ExecutionPlan;
  /** Loss if every entry fills and the stop loss is hit, per account, before fees. */
  lossAtStopUsdt: number;
  accountNames: string[];
  timeoutSeconds: number;
}

export interface TradeApprovalDecision {
  approved: boolean;
  reason?: string;
}

/** Asks the owner to confirm a trade before any order is placed. */
export interface TradeApprover {
  isAvailable(): boolean;
  requestApproval(request: TradeApprovalRequest): Promise<TradeApprovalDecision>;
}
