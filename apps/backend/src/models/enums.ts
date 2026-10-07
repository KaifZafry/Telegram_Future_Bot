export enum UserRole {
  Admin = "ADMIN",
  User = "USER"
}

export enum BinanceEnvironment {
  Testnet = "TESTNET",
  Live = "LIVE"
}

export enum BinancePermission {
  Read = "READ",
  Trade = "TRADE",
  Futures = "FUTURES"
}

export enum TelegramChatType {
  Channel = "CHANNEL",
  Group = "GROUP",
  Supergroup = "SUPERGROUP",
  Private = "PRIVATE"
}

export enum SignalSide {
  Long = "LONG",
  Short = "SHORT"
}

export enum EntryType {
  Market = "MARKET",
  Limit = "LIMIT",
  EntryRange = "ENTRY_RANGE"
}

export enum SignalStatus {
  Received = "RECEIVED",
  Parsed = "PARSED",
  Validated = "VALIDATED",
  Rejected = "REJECTED",
  Executing = "EXECUTING",
  Executed = "EXECUTED",
  Failed = "FAILED",
  Completed = "COMPLETED"
}

export enum ParseStatus {
  Pending = "PENDING",
  Parsed = "PARSED",
  Failed = "FAILED"
}

export enum ValidationStatus {
  Pending = "PENDING",
  Valid = "VALID",
  Invalid = "INVALID"
}

export enum TradeStatus {
  Pending = "PENDING",
  Open = "OPEN",
  PartiallyClosed = "PARTIALLY_CLOSED",
  Closed = "CLOSED",
  Cancelled = "CANCELLED",
  Failed = "FAILED"
}

export enum TradeCloseReason {
  TakeProfit = "TAKE_PROFIT",
  StopLoss = "STOP_LOSS",
  Manual = "MANUAL",
  Liquidation = "LIQUIDATION",
  Cancelled = "CANCELLED",
  Error = "ERROR"
}

export enum TradeExecutionStatus {
  Pending = "PENDING",
  Executing = "EXECUTING",
  Open = "OPEN",
  PartiallyClosed = "PARTIALLY_CLOSED",
  Closed = "CLOSED",
  Cancelled = "CANCELLED",
  Failed = "FAILED"
}

export enum OrderType {
  Market = "MARKET",
  Limit = "LIMIT",
  StopMarket = "STOP_MARKET",
  StopLimit = "STOP_LIMIT",
  TakeProfitMarket = "TAKE_PROFIT_MARKET",
  TakeProfitLimit = "TAKE_PROFIT_LIMIT"
}

export enum OrderSide {
  Buy = "BUY",
  Sell = "SELL"
}

export enum PositionSide {
  Both = "BOTH",
  Long = "LONG",
  Short = "SHORT"
}

export enum OrderStatus {
  New = "NEW",
  PartiallyFilled = "PARTIALLY_FILLED",
  Filled = "FILLED",
  Canceled = "CANCELED",
  Expired = "EXPIRED",
  Rejected = "REJECTED"
}

export enum OrderEventType {
  Created = "CREATED",
  StatusChanged = "STATUS_CHANGED",
  Filled = "FILLED",
  PartiallyFilled = "PARTIALLY_FILLED",
  Canceled = "CANCELED",
  Rejected = "REJECTED",
  Expired = "EXPIRED"
}

export enum SystemLogLevel {
  Debug = "DEBUG",
  Info = "INFO",
  Warn = "WARN",
  Error = "ERROR",
  Fatal = "FATAL"
}

export enum SystemLogCategory {
  Auth = "AUTH",
  Database = "DATABASE",
  Signal = "SIGNAL",
  Trade = "TRADE",
  Order = "ORDER",
  Binance = "BINANCE",
  Telegram = "TELEGRAM",
  System = "SYSTEM"
}

export enum MarginType {
  Cross = "CROSSED",
  Isolated = "ISOLATED"
}

export enum OrderRole {
  Entry = "ENTRY",
  TakeProfit = "TAKE_PROFIT",
  StopLoss = "STOP_LOSS",
  Close = "CLOSE"
}
