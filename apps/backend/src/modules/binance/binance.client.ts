import { createHmac } from "node:crypto";

import type {
  BinanceAlgoOrderResponse,
  BinanceCredentials,
  BinanceOrderResponse,
  BinancePosition,
  BinanceUserTrade,
  NewOrderParams,
  NewStopLossParams,
  SymbolRules
} from "./binance.types.js";

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";
type QueryValue = string | number | boolean | undefined;

export const BINANCE_ERROR_CODES = {
  timestampOutsideRecvWindow: -1021,
  unknownOrder: -2011,
  orderDoesNotExist: -2013,
  orderWouldImmediatelyTrigger: -2021,
  noNeedToChangeMarginType: -4046
} as const;

export class BinanceApiError extends Error {
  public constructor(
    message: string,
    public readonly code: number,
    public readonly httpStatus: number
  ) {
    super(message);
    this.name = "BinanceApiError";
  }
}

export const isBinanceError = (error: unknown, code: number): boolean =>
  error instanceof BinanceApiError && error.code === code;

interface ExchangeInfoFilter {
  filterType: string;
  tickSize?: string;
  stepSize?: string;
  minQty?: string;
  notional?: string;
}

interface ExchangeInfoSymbol {
  symbol: string;
  status: string;
  filters: ExchangeInfoFilter[];
}

export interface BinanceFuturesClientOptions {
  baseUrl: string;
  credentials?: BinanceCredentials;
  recvWindow?: number;
  fetchFn?: typeof fetch;
}

const TIME_SYNC_INTERVAL_MS = 30 * 60 * 1000;
const EXCHANGE_INFO_TTL_MS = 10 * 60 * 1000;

const exchangeInfoCache = new Map<
  string,
  { fetchedAt: number; rules: Map<string, SymbolRules> }
>();

const toSymbolRules = (symbol: ExchangeInfoSymbol): SymbolRules => {
  const filter = (type: string): ExchangeInfoFilter | undefined =>
    symbol.filters.find((candidate) => candidate.filterType === type);
  const priceFilter = filter("PRICE_FILTER");
  const lotSize = filter("LOT_SIZE");
  const marketLotSize = filter("MARKET_LOT_SIZE") ?? lotSize;
  const minNotional = filter("MIN_NOTIONAL");

  return {
    symbol: symbol.symbol,
    status: symbol.status,
    tickSize: priceFilter?.tickSize ?? "0.0001",
    stepSize: lotSize?.stepSize ?? "1",
    minQty: Number(lotSize?.minQty ?? 0),
    marketStepSize: marketLotSize?.stepSize ?? lotSize?.stepSize ?? "1",
    marketMinQty: Number(marketLotSize?.minQty ?? lotSize?.minQty ?? 0),
    minNotional: Number(minNotional?.notional ?? 0)
  };
};

/**
 * Minimal Binance USDⓈ-M Futures REST client. Conditional orders (stop loss)
 * use the Algo Order API, which replaced STOP_MARKET on /fapi/v1/order on
 * 2025-12-09.
 */
export class BinanceFuturesClient {
  private readonly baseUrl: string;
  private readonly credentials?: BinanceCredentials;
  private readonly recvWindow: number;
  private readonly fetchFn: typeof fetch;
  private timeOffsetMs = 0;
  private lastTimeSyncAt = 0;

  public constructor(options: BinanceFuturesClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.credentials = options.credentials;
    this.recvWindow = options.recvWindow ?? 5000;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  public async getSymbolRules(symbol: string): Promise<SymbolRules | undefined> {
    const cached = exchangeInfoCache.get(this.baseUrl);

    if (cached && Date.now() - cached.fetchedAt < EXCHANGE_INFO_TTL_MS) {
      return cached.rules.get(symbol);
    }

    const response = await this.request<{ symbols: ExchangeInfoSymbol[] }>(
      "GET",
      "/fapi/v1/exchangeInfo",
      {},
      false
    );
    const rules = new Map(
      response.symbols.map((entry) => [entry.symbol, toSymbolRules(entry)])
    );
    exchangeInfoCache.set(this.baseUrl, { fetchedAt: Date.now(), rules });

    return rules.get(symbol);
  }

  public async getMarkPrice(symbol: string): Promise<number> {
    const response = await this.request<{ markPrice: string }>(
      "GET",
      "/fapi/v1/premiumIndex",
      { symbol },
      false
    );

    return Number(response.markPrice);
  }

  public async isHedgeMode(): Promise<boolean> {
    const response = await this.request<{ dualSidePosition: boolean }>(
      "GET",
      "/fapi/v1/positionSide/dual"
    );

    return response.dualSidePosition;
  }

  public async getAvailableBalance(asset = "USDT"): Promise<number> {
    const balances = await this.request<{ asset: string; availableBalance: string }[]>(
      "GET",
      "/fapi/v3/balance"
    );

    return Number(balances.find((balance) => balance.asset === asset)?.availableBalance ?? 0);
  }

  public async setLeverage(symbol: string, leverage: number): Promise<void> {
    await this.request("POST", "/fapi/v1/leverage", { symbol, leverage });
  }

  public async setMarginType(symbol: string, marginType: string): Promise<void> {
    try {
      await this.request("POST", "/fapi/v1/marginType", { symbol, marginType });
    } catch (error) {
      if (!isBinanceError(error, BINANCE_ERROR_CODES.noNeedToChangeMarginType)) {
        throw error;
      }
    }
  }

  public placeOrder(params: NewOrderParams): Promise<BinanceOrderResponse> {
    return this.request<BinanceOrderResponse>("POST", "/fapi/v1/order", {
      ...params,
      newOrderRespType: "RESULT"
    });
  }

  public placeStopLoss(params: NewStopLossParams): Promise<BinanceAlgoOrderResponse> {
    return this.request<BinanceAlgoOrderResponse>("POST", "/fapi/v1/algoOrder", {
      algoType: "CONDITIONAL",
      symbol: params.symbol,
      side: params.side,
      type: "STOP_MARKET",
      triggerPrice: params.triggerPrice,
      closePosition: "true",
      workingType: "MARK_PRICE",
      priceProtect: "true",
      clientAlgoId: params.clientAlgoId
    });
  }

  public getOrder(symbol: string, clientOrderId: string): Promise<BinanceOrderResponse> {
    return this.request<BinanceOrderResponse>("GET", "/fapi/v1/order", {
      symbol,
      origClientOrderId: clientOrderId
    });
  }

  public cancelOrder(symbol: string, clientOrderId: string): Promise<BinanceOrderResponse> {
    return this.request<BinanceOrderResponse>("DELETE", "/fapi/v1/order", {
      symbol,
      origClientOrderId: clientOrderId
    });
  }

  public getAlgoOrder(clientAlgoId: string): Promise<BinanceAlgoOrderResponse> {
    return this.request<BinanceAlgoOrderResponse>("GET", "/fapi/v1/algoOrder", {
      clientAlgoId
    });
  }

  public async cancelAlgoOrder(clientAlgoId: string): Promise<void> {
    await this.request("DELETE", "/fapi/v1/algoOrder", { clientAlgoId });
  }

  public getOpenOrders(symbol: string): Promise<BinanceOrderResponse[]> {
    return this.request<BinanceOrderResponse[]>("GET", "/fapi/v1/openOrders", { symbol });
  }

  public async getOpenAlgoOrders(symbol: string): Promise<BinanceAlgoOrderResponse[]> {
    // Binance wraps the list: { total: number, orders: [...] }
    const response = await this.request<{ total: number; orders: BinanceAlgoOrderResponse[] }>(
      "GET",
      "/fapi/v1/openAlgoOrders",
      { symbol }
    );
    return response.orders ?? [];
  }

  public async getPosition(symbol: string): Promise<BinancePosition | undefined> {
    const positions = await this.request<BinancePosition[]>(
      "GET",
      "/fapi/v3/positionRisk",
      { symbol }
    );

    return positions.find((position) => position.positionSide === "BOTH") ?? positions[0];
  }

  /** Binance limits each userTrades query to a 7-day window, so longer ranges are paged. */
  public async getUserTrades(
    symbol: string,
    startTime: number,
    endTime = Date.now()
  ): Promise<BinanceUserTrade[]> {
    const windowMs = 7 * 24 * 60 * 60 * 1000 - 1;
    const trades: BinanceUserTrade[] = [];

    for (let windowStart = startTime; windowStart < endTime; windowStart += windowMs + 1) {
      trades.push(
        ...(await this.request<BinanceUserTrade[]>("GET", "/fapi/v1/userTrades", {
          symbol,
          startTime: windowStart,
          endTime: Math.min(windowStart + windowMs, endTime),
          limit: 1000
        }))
      );
    }

    return trades;
  }

  /** Creates (or extends) the account's user data stream key; valid 60 minutes. */
  public async createListenKey(): Promise<string> {
    const response = await this.request<{ listenKey: string }>(
      "POST",
      "/fapi/v1/listenKey",
      {},
      "apiKey"
    );
    return response.listenKey;
  }

  public async keepAliveListenKey(): Promise<void> {
    await this.request("PUT", "/fapi/v1/listenKey", {}, "apiKey");
  }

  private async syncTime(): Promise<void> {
    const response = await this.request<{ serverTime: number }>(
      "GET",
      "/fapi/v1/time",
      {},
      false
    );
    this.timeOffsetMs = response.serverTime - Date.now();
    this.lastTimeSyncAt = Date.now();
  }

  private async request<T>(
    method: HttpMethod,
    path: string,
    params: Record<string, QueryValue> = {},
    /** true = HMAC-signed; "apiKey" = API key header only (user data streams). */
    signed: boolean | "apiKey" = true,
    isRetry = false
  ): Promise<T> {
    const query = new URLSearchParams();

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        query.append(key, String(value));
      }
    }

    const headers: Record<string, string> = {};

    if (signed && !this.credentials) {
      throw new Error("Binance credentials are required for signed requests");
    }

    if (signed === "apiKey" && this.credentials) {
      headers["X-MBX-APIKEY"] = this.credentials.apiKey;
    }

    if (signed === true && this.credentials) {

      if (Date.now() - this.lastTimeSyncAt > TIME_SYNC_INTERVAL_MS) {
        await this.syncTime();
      }

      query.append("recvWindow", String(this.recvWindow));
      query.append("timestamp", String(Date.now() + this.timeOffsetMs));
      query.append(
        "signature",
        createHmac("sha256", this.credentials.apiSecret)
          .update(query.toString())
          .digest("hex")
      );
      headers["X-MBX-APIKEY"] = this.credentials.apiKey;
    }

    const queryString = query.toString();
    const response = await this.fetchFn(
      `${this.baseUrl}${path}${queryString ? `?${queryString}` : ""}`,
      { method, headers }
    );
    const body = (await response.json().catch(() => ({}))) as {
      code?: number;
      msg?: string;
    };

    if (!response.ok || (typeof body.code === "number" && body.code < 0)) {
      const error = new BinanceApiError(
        body.msg ?? `Binance request failed with HTTP ${response.status}`,
        body.code ?? response.status,
        response.status
      );

      if (
        signed === true &&
        !isRetry &&
        error.code === BINANCE_ERROR_CODES.timestampOutsideRecvWindow
      ) {
        await this.syncTime();
        return this.request<T>(method, path, params, signed, true);
      }

      throw error;
    }

    return body as T;
  }
}
