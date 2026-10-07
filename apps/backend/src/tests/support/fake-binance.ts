/**
 * In-memory Binance USDⓈ-M Futures exchange for tests, exposed as a `fetch`
 * implementation. Supports one-way mode with a single symbol: limit/market
 * orders, reduce-only, close-position STOP_MARKET algo orders, positions with
 * average entry, realized PnL, and fees. Moving the price with `setPrice`
 * fills resting orders and triggers stops the way the real matching engine
 * would for these order types.
 */

interface FakeOrder {
  orderId: number;
  clientOrderId: string;
  side: "BUY" | "SELL";
  type: "LIMIT" | "MARKET";
  price: number;
  origQty: number;
  executedQty: number;
  avgPrice: number;
  reduceOnly: boolean;
  status: "NEW" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "EXPIRED";
}

interface FakeAlgoOrder {
  algoId: number;
  clientAlgoId: string;
  side: "BUY" | "SELL";
  triggerPrice: number;
  algoStatus: "NEW" | "CANCELED" | "FINISHED";
}

interface FakeTrade {
  orderId: number;
  side: "BUY" | "SELL";
  price: string;
  qty: string;
  realizedPnl: string;
  commission: string;
  commissionAsset: string;
  time: number;
}

const FEE_RATE = 0.0004;

const round = (value: number): number => Number(value.toFixed(8));

export class FakeBinance {
  public markPrice: number;
  public positionAmt = 0;
  public entryPrice = 0;
  public hedgeMode = false;
  public readonly orders: FakeOrder[] = [];
  public readonly algoOrders: FakeAlgoOrder[] = [];
  public readonly trades: FakeTrade[] = [];
  private nextId = 1000;

  public constructor(
    public readonly symbol: string,
    initialPrice: number,
    private readonly rules = { tickSize: "0.0001", stepSize: "0.1", minQty: "0.1", notional: "5" }
  ) {
    this.markPrice = initialPrice;
  }

  public readonly fetch: typeof fetch = (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    );
    const method = init?.method ?? "GET";
    const params = Object.fromEntries(url.searchParams.entries());

    try {
      return Promise.resolve(this.json(200, this.route(method, url.pathname, params)));
    } catch (error) {
      const { code, msg } = error as { code: number; msg: string };
      return Promise.resolve(this.json(400, { code, msg }));
    }
  };

  public openOrders(): FakeOrder[] {
    return this.orders.filter((order) => order.status === "NEW" || order.status === "PARTIALLY_FILLED");
  }

  public openAlgoOrders(): FakeAlgoOrder[] {
    return this.algoOrders.filter((order) => order.algoStatus === "NEW");
  }

  /** Moves the market, filling crossed limit orders and triggering stops. */
  public setPrice(price: number): void {
    this.markPrice = price;

    for (const order of this.openOrders()) {
      if (order.type === "LIMIT" && this.isCrossed(order.side, order.price)) {
        this.fill(order, order.price);
      }
    }

    for (const stop of this.openAlgoOrders()) {
      const triggered = stop.side === "SELL" ? price <= stop.triggerPrice : price >= stop.triggerPrice;

      if (triggered && this.positionAmt !== 0) {
        stop.algoStatus = "FINISHED";
        const closeOrder = this.createOrder({
          side: stop.side,
          type: "MARKET",
          price: stop.triggerPrice,
          origQty: Math.abs(this.positionAmt),
          reduceOnly: true,
          clientOrderId: `stop-${stop.algoId}`
        });
        this.fill(closeOrder, stop.triggerPrice);
      }
    }
  }

  private json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" }
    });
  }

  private fail(code: number, msg: string): never {
    throw Object.assign(new Error(msg), { code, msg });
  }

  private isCrossed(side: "BUY" | "SELL", price: number): boolean {
    return side === "BUY" ? price >= this.markPrice : price <= this.markPrice;
  }

  private route(method: string, path: string, params: Record<string, string>): unknown {
    switch (`${method} ${path}`) {
      case "GET /fapi/v1/time":
        return { serverTime: Date.now() };
      case "GET /fapi/v1/exchangeInfo":
        return {
          symbols: [
            {
              symbol: this.symbol,
              status: "TRADING",
              filters: [
                { filterType: "PRICE_FILTER", tickSize: this.rules.tickSize },
                { filterType: "LOT_SIZE", stepSize: this.rules.stepSize, minQty: this.rules.minQty },
                { filterType: "MARKET_LOT_SIZE", stepSize: this.rules.stepSize, minQty: this.rules.minQty },
                { filterType: "MIN_NOTIONAL", notional: this.rules.notional }
              ]
            }
          ]
        };
      case "GET /fapi/v1/premiumIndex":
        return { symbol: this.symbol, markPrice: String(this.markPrice) };
      case "GET /fapi/v1/positionSide/dual":
        return { dualSidePosition: this.hedgeMode };
      case "POST /fapi/v1/marginType":
      case "POST /fapi/v1/leverage":
        return {};
      case "GET /fapi/v3/positionRisk":
        return [
          {
            symbol: this.symbol,
            positionSide: "BOTH",
            positionAmt: String(this.positionAmt),
            entryPrice: String(this.entryPrice),
            markPrice: String(this.markPrice),
            unRealizedProfit: "0"
          }
        ];
      case "POST /fapi/v1/order":
        return this.placeOrder(params);
      case "GET /fapi/v1/order":
        return this.toResponse(this.findOrder(params.origClientOrderId, -2013));
      case "DELETE /fapi/v1/order": {
        const order = this.findOrder(params.origClientOrderId, -2011);
        if (order.status !== "NEW" && order.status !== "PARTIALLY_FILLED") {
          this.fail(-2011, "Unknown order sent.");
        }
        order.status = "CANCELED";
        return this.toResponse(order);
      }
      case "GET /fapi/v1/openOrders":
        return this.openOrders().map((order) => this.toResponse(order));
      case "POST /fapi/v1/algoOrder":
        return this.placeStop(params);
      case "GET /fapi/v1/algoOrder":
        return this.toAlgoResponse(this.findAlgo(params.clientAlgoId));
      case "DELETE /fapi/v1/algoOrder": {
        const stop = this.findAlgo(params.clientAlgoId);
        if (stop.algoStatus !== "NEW") {
          this.fail(-2011, "Unknown order sent.");
        }
        stop.algoStatus = "CANCELED";
        return { code: "200", msg: "success" };
      }
      case "GET /fapi/v1/openAlgoOrders":
        return this.openAlgoOrders().map((stop) => this.toAlgoResponse(stop));
      case "GET /fapi/v1/userTrades":
        return this.trades.filter(
          (trade) => trade.time >= Number(params.startTime) && trade.time <= Number(params.endTime)
        );
      default:
        return this.fail(-1000, `Fake exchange has no route for ${method} ${path}`);
    }
  }

  private placeOrder(params: Record<string, string>): unknown {
    if (this.orders.some((order) => order.clientOrderId === params.newClientOrderId)) {
      this.fail(-4116, "ClientOrderId is duplicated.");
    }

    const reduceOnly = params.reduceOnly === "true";
    const side = params.side as "BUY" | "SELL";

    if (reduceOnly && (this.positionAmt === 0 || (side === "BUY") === this.positionAmt > 0)) {
      this.fail(-2022, "ReduceOnly Order is rejected.");
    }

    const order = this.createOrder({
      side,
      type: params.type as "LIMIT" | "MARKET",
      price: Number(params.price ?? this.markPrice),
      origQty: Number(params.quantity),
      reduceOnly,
      clientOrderId: params.newClientOrderId ?? `auto-${this.nextId}`
    });

    if (order.type === "MARKET") {
      this.fill(order, this.markPrice);
    } else if (this.isCrossed(order.side, order.price)) {
      this.fill(order, order.price);
    }

    return this.toResponse(order);
  }

  private placeStop(params: Record<string, string>): unknown {
    const triggerPrice = Number(params.triggerPrice);
    const side = params.side as "BUY" | "SELL";
    const wouldTrigger = side === "SELL" ? triggerPrice >= this.markPrice : triggerPrice <= this.markPrice;

    if (wouldTrigger) {
      this.fail(-2021, "Order would immediately trigger.");
    }

    if (this.openAlgoOrders().some((stop) => stop.side === side)) {
      this.fail(-4130, "An open stop or take profit order with GTE and closePosition in the direction is existing.");
    }

    const stop: FakeAlgoOrder = {
      algoId: this.nextId++,
      clientAlgoId: params.clientAlgoId ?? `algo-${this.nextId}`,
      side,
      triggerPrice,
      algoStatus: "NEW"
    };
    this.algoOrders.push(stop);
    return this.toAlgoResponse(stop);
  }

  private createOrder(details: Omit<FakeOrder, "orderId" | "executedQty" | "avgPrice" | "status">): FakeOrder {
    const order: FakeOrder = {
      ...details,
      orderId: this.nextId++,
      executedQty: 0,
      avgPrice: 0,
      status: "NEW"
    };
    this.orders.push(order);
    return order;
  }

  private fill(order: FakeOrder, price: number): void {
    let quantity = order.origQty - order.executedQty;

    if (order.reduceOnly) {
      quantity = Math.min(quantity, Math.abs(this.positionAmt));

      if (quantity <= 0) {
        order.status = "EXPIRED";
        return;
      }
    }

    const signed = order.side === "BUY" ? quantity : -quantity;
    let realizedPnl = 0;

    if (this.positionAmt === 0 || Math.sign(signed) === Math.sign(this.positionAmt)) {
      const size = Math.abs(this.positionAmt);
      this.entryPrice = (size * this.entryPrice + quantity * price) / (size + quantity);
    } else {
      realizedPnl = quantity * (price - this.entryPrice) * Math.sign(this.positionAmt);
    }

    this.positionAmt = round(this.positionAmt + signed);
    if (this.positionAmt === 0) {
      this.entryPrice = 0;
    }

    order.avgPrice = price;
    order.executedQty = round(order.executedQty + quantity);
    order.status = order.executedQty >= order.origQty || order.reduceOnly ? "FILLED" : "PARTIALLY_FILLED";
    this.trades.push({
      orderId: order.orderId,
      side: order.side,
      price: String(price),
      qty: String(quantity),
      realizedPnl: String(round(realizedPnl)),
      commission: String(round(quantity * price * FEE_RATE)),
      commissionAsset: "USDT",
      time: Date.now()
    });
  }

  private findOrder(clientOrderId: string | undefined, code: number): FakeOrder {
    return (
      this.orders.find((order) => order.clientOrderId === clientOrderId) ??
      this.fail(code, "Order does not exist.")
    );
  }

  private findAlgo(clientAlgoId: string | undefined): FakeAlgoOrder {
    return (
      this.algoOrders.find((stop) => stop.clientAlgoId === clientAlgoId) ??
      this.fail(-2013, "Order does not exist.")
    );
  }

  private toResponse(order: FakeOrder): unknown {
    return {
      orderId: order.orderId,
      clientOrderId: order.clientOrderId,
      symbol: this.symbol,
      status: order.status,
      type: order.type,
      side: order.side,
      price: String(order.type === "LIMIT" ? order.price : 0),
      avgPrice: String(order.avgPrice),
      origQty: String(order.origQty),
      executedQty: String(order.executedQty),
      reduceOnly: order.reduceOnly,
      updateTime: Date.now()
    };
  }

  private toAlgoResponse(stop: FakeAlgoOrder): unknown {
    return {
      algoId: stop.algoId,
      clientAlgoId: stop.clientAlgoId,
      symbol: this.symbol,
      side: stop.side,
      orderType: "STOP_MARKET",
      algoStatus: stop.algoStatus,
      triggerPrice: String(stop.triggerPrice)
    };
  }
}
