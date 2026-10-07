// Shapes returned by the backend API (apps/backend/src/controllers).

export type Side = "LONG" | "SHORT";

export type SignalStatus =
  | "RECEIVED"
  | "PARSED"
  | "VALIDATED"
  | "REJECTED"
  | "EXECUTING"
  | "EXECUTED"
  | "FAILED"
  | "COMPLETED";

export type ExecutionStatus =
  | "PENDING"
  | "EXECUTING"
  | "OPEN"
  | "PARTIALLY_CLOSED"
  | "CLOSED"
  | "CANCELLED"
  | "FAILED";

export type CloseReason =
  | "TAKE_PROFIT"
  | "STOP_LOSS"
  | "MANUAL"
  | "LIQUIDATION"
  | "CANCELLED"
  | "ERROR";

export type OrderRole = "ENTRY" | "TAKE_PROFIT" | "STOP_LOSS" | "CLOSE";
export type OrderStatus =
  | "NEW"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELED"
  | "EXPIRED"
  | "REJECTED";
export type Environment = "TESTNET" | "LIVE";

export interface TradeEntry {
  type: "MARKET" | "LIMIT" | "ENTRY_RANGE";
  price?: number;
  minPrice?: number;
  maxPrice?: number;
}

export interface TakeProfit {
  price: number;
  allocationPercentage: number;
}

export interface Summary {
  trading: { enabled: boolean; configured: boolean; liveTradingAllowed: boolean };
  telegram: { enabled: boolean; running: boolean; mode: "user" | "bot" };
  accounts: { _id: string; name: string; environment: Environment; isActive: boolean }[];
  today: {
    totalSignals: number;
    executedSignals: number;
    rejectedSignals: number;
    winningTrades: number;
    losingTrades: number;
    netPnL: number;
    winRate: number;
  };
  allTime: {
    totalSignals: number;
    executedSignals: number;
    winningTrades: number;
    losingTrades: number;
    breakevenTrades: number;
    netPnL: number;
    totalFees: number;
    winRate: number;
  };
  open: { count: number; pendingEntries: number; unrealizedPnL: number };
  lastSignalAt?: string;
}

export interface DailyPoint {
  date: string;
  netPnL: number;
  cumulativePnL: number;
  winningTrades: number;
  losingTrades: number;
  totalSignals: number;
}

export interface LogEntry {
  _id?: string;
  level: "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL";
  category: string;
  message: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface Signal {
  _id: string;
  telegramSourceId: string;
  sourceName: string;
  telegramMessageId: string;
  rawText: string;
  symbol?: string;
  side?: Side;
  entry?: TradeEntry;
  leverage?: number;
  marginType?: "CROSSED" | "ISOLATED";
  stopLoss?: number;
  takeProfits: TakeProfit[];
  status: SignalStatus;
  parseStatus: "PENDING" | "PARSED" | "FAILED";
  parseError?: { code: string; message: string };
  rejectionReason?: string;
  receivedAt: string;
}

export interface Order {
  _id: string;
  clientOrderId: string;
  role: OrderRole;
  targetIndex?: number;
  orderType: string;
  side: "BUY" | "SELL";
  quantity?: number;
  price?: number;
  stopPrice?: number;
  status: OrderStatus;
  filledQuantity: number;
  averageFillPrice?: number;
  closePosition: boolean;
  createdAt: string;
}

export interface Execution {
  _id: string;
  signalId: string;
  accountName: string;
  symbol: string;
  side: Side;
  status: ExecutionStatus;
  requestedEntry: TradeEntry;
  actualEntry?: number;
  quantity: number;
  leverage: number;
  marginType: "CROSSED" | "ISOLATED";
  stopLoss: number;
  currentStopLoss: number;
  takeProfits: TakeProfit[];
  slMovedToBreakeven: boolean;
  positionQuantity: number;
  markPrice?: number;
  unrealizedPnL: number;
  realizedPnL: number;
  fees: number;
  netPnL: number;
  closeReason?: CloseReason;
  errorMessage?: string;
  entryExpiresAt: string;
  executedAt?: string;
  closedAt?: string;
  createdAt: string;
  orders?: Order[];
}

export interface SignalDetail {
  signal: Signal;
  source?: { name: string; chatId: string };
  executions: (Execution & { orders: Order[] })[];
}

export interface Settings {
  isEnabled: boolean;
  defaultMargin: number;
  defaultLeverage: number;
  maxLeverage: number;
  entryOrderCount: number;
  entryTimeoutMinutes: number;
  maxOpenTrades: number;
  maxDailyLoss: number;
  moveStopToBreakeven: boolean;
  allowedSymbols: string[];
  blockedSymbols: string[];
}

export interface Source {
  _id: string;
  name: string;
  chatId: string;
  chatType: "CHANNEL" | "GROUP" | "SUPERGROUP" | "PRIVATE";
  isActive: boolean;
}

export interface Account {
  _id: string;
  name: string;
  environment: Environment;
  isActive: boolean;
  createdAt: string;
}

export interface TelegramChat {
  chatId: string;
  title: string;
  type: "CHANNEL" | "GROUP";
}

export interface EntryLeg {
  type: "MARKET" | "LIMIT";
  price?: string;
  quantity: string;
  referencePrice: number;
}

export interface Preview {
  parsed:
    | {
        success: true;
        data: {
          symbol: string;
          side: Side;
          entry: TradeEntry;
          leverage?: number;
          marginType?: string;
          stopLoss: number;
          takeProfits: TakeProfit[];
        };
      }
    | { success: false; errorCode: string; errorMessage: string };
  environment: Environment;
  market?: { markPrice: number; tickSize: string; stepSize: string; minNotional: number };
  plan?: {
    leverage: number;
    marginUsdt: number;
    notionalUsdt: number;
    averageEntryPrice: number;
    totalQuantity: number;
    entrySide: "BUY" | "SELL";
    exitSide: "BUY" | "SELL";
    legs: EntryLeg[];
    stopLoss: string;
    takeProfits: { price: string; allocationPercentage: number }[];
  };
  lossAtStopUsdt?: number;
  rejection?: string;
}
