import { BinanceEnvironment } from "../../models/index.js";

export const BINANCE_BASE_URLS: Record<BinanceEnvironment, string> = {
  [BinanceEnvironment.Testnet]: "https://demo-fapi.binance.com",
  [BinanceEnvironment.Live]: "https://fapi.binance.com"
};

export interface BinanceCredentials {
  apiKey: string;
  apiSecret: string;
}

export type BinanceOrderSide = "BUY" | "SELL";

export type BinanceOrderStatus =
  | "NEW"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELED"
  | "REJECTED"
  | "EXPIRED"
  | "EXPIRED_IN_MATCH";

export type BinanceAlgoStatus =
  | "NEW"
  | "CANCELED"
  | "TRIGGERING"
  | "TRIGGERED"
  | "FINISHED"
  | "REJECTED"
  | "EXPIRED";

export interface SymbolRules {
  symbol: string;
  status: string;
  tickSize: string;
  stepSize: string;
  minQty: number;
  marketStepSize: string;
  marketMinQty: number;
  minNotional: number;
}

export interface BinanceOrderResponse {
  orderId: number;
  clientOrderId: string;
  symbol: string;
  status: BinanceOrderStatus;
  type: string;
  side: BinanceOrderSide;
  price: string;
  avgPrice: string;
  origQty: string;
  executedQty: string;
  reduceOnly: boolean;
  updateTime: number;
}

export interface BinanceAlgoOrderResponse {
  algoId: number;
  clientAlgoId: string;
  symbol: string;
  side: BinanceOrderSide;
  orderType: string;
  algoStatus: BinanceAlgoStatus;
  triggerPrice: string;
  actualOrderId?: string;
  actualPrice?: string;
}

export interface BinancePosition {
  symbol: string;
  positionSide: string;
  positionAmt: string;
  entryPrice: string;
  markPrice: string;
  unRealizedProfit: string;
}

export interface BinanceUserTrade {
  orderId: number;
  symbol: string;
  side: BinanceOrderSide;
  price: string;
  qty: string;
  realizedPnl: string;
  commission: string;
  commissionAsset: string;
  time: number;
}

export interface NewOrderParams {
  symbol: string;
  side: BinanceOrderSide;
  type: "MARKET" | "LIMIT";
  quantity: string;
  price?: string;
  timeInForce?: "GTC";
  reduceOnly?: boolean;
  newClientOrderId: string;
}

export interface NewStopLossParams {
  symbol: string;
  side: BinanceOrderSide;
  triggerPrice: string;
  clientAlgoId: string;
}
