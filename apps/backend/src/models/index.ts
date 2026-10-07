import { BinanceAccountModel } from "./BinanceAccount.js";
import { BotSettingsModel } from "./BotSettings.js";
import { DailyStatisticsModel } from "./DailyStatistics.js";
import { OrderModel } from "./Order.js";
import { OrderEventModel } from "./OrderEvent.js";
import { SignalModel } from "./Signal.js";
import { SystemLogModel } from "./SystemLog.js";
import { TelegramSourceModel } from "./TelegramSource.js";
import { TradeModel } from "./Trade.js";
import { TradeExecutionModel } from "./TradeExecution.js";
import { UserModel } from "./User.js";

export interface DatabaseModelIndexSynchronizer {
  modelName: string;
  syncIndexes(): Promise<unknown>;
}

export * from "./BinanceAccount.js";
export * from "./BotSettings.js";
export * from "./DailyStatistics.js";
export * from "./Order.js";
export * from "./OrderEvent.js";
export * from "./Signal.js";
export * from "./SystemLog.js";
export * from "./TelegramSource.js";
export * from "./Trade.js";
export * from "./TradeExecution.js";
export * from "./User.js";
export * from "./enums.js";
export * from "./shared/schemas.js";

export const databaseModels: DatabaseModelIndexSynchronizer[] = [
  UserModel,
  BinanceAccountModel,
  TelegramSourceModel,
  SignalModel,
  TradeModel,
  TradeExecutionModel,
  OrderModel,
  OrderEventModel,
  BotSettingsModel,
  DailyStatisticsModel,
  SystemLogModel
];
