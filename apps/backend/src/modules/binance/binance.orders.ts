import type { Types } from "mongoose";

import type { OrderRole, OrderType } from "../../models/index.js";
import {
  OrderEventModel,
  OrderEventType,
  OrderModel,
  OrderSide,
  OrderStatus,
  PositionSide,
  type OrderDocument
} from "../../models/index.js";
import type {
  BinanceAlgoOrderResponse,
  BinanceAlgoStatus,
  BinanceOrderResponse,
  BinanceOrderStatus
} from "./binance.types.js";

export const ACTIVE_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.New,
  OrderStatus.PartiallyFilled
];

export const isActiveOrder = (order: { status: OrderStatus }): boolean =>
  ACTIVE_ORDER_STATUSES.includes(order.status);

export const mapOrderStatus = (status: BinanceOrderStatus): OrderStatus => {
  switch (status) {
    case "NEW":
      return OrderStatus.New;
    case "PARTIALLY_FILLED":
      return OrderStatus.PartiallyFilled;
    case "FILLED":
      return OrderStatus.Filled;
    case "CANCELED":
      return OrderStatus.Canceled;
    case "REJECTED":
      return OrderStatus.Rejected;
    case "EXPIRED":
    case "EXPIRED_IN_MATCH":
      return OrderStatus.Expired;
  }
};

/** A triggered stop loss is treated as filled: it has fired and closed the position. */
export const mapAlgoStatus = (status: BinanceAlgoStatus): OrderStatus => {
  switch (status) {
    case "NEW":
      return OrderStatus.New;
    case "TRIGGERING":
    case "TRIGGERED":
    case "FINISHED":
      return OrderStatus.Filled;
    case "CANCELED":
      return OrderStatus.Canceled;
    case "REJECTED":
      return OrderStatus.Rejected;
    case "EXPIRED":
      return OrderStatus.Expired;
  }
};

const eventTypeForStatus = (status: OrderStatus): OrderEventType => {
  switch (status) {
    case OrderStatus.Filled:
      return OrderEventType.Filled;
    case OrderStatus.PartiallyFilled:
      return OrderEventType.PartiallyFilled;
    case OrderStatus.Canceled:
      return OrderEventType.Canceled;
    case OrderStatus.Rejected:
      return OrderEventType.Rejected;
    case OrderStatus.Expired:
      return OrderEventType.Expired;
    case OrderStatus.New:
      return OrderEventType.StatusChanged;
  }
};

export interface OrderOwner {
  userId: Types.ObjectId;
  tradeExecutionId: Types.ObjectId;
  binanceAccountId: Types.ObjectId;
  symbol: string;
}

export const recordOrder = async (
  owner: OrderOwner,
  details: {
    role: OrderRole;
    targetIndex?: number;
    orderType: OrderType;
    side: "BUY" | "SELL";
    reduceOnly?: boolean;
    closePosition?: boolean;
  },
  response: BinanceOrderResponse | BinanceAlgoOrderResponse
): Promise<OrderDocument> => {
  const isAlgo = "algoId" in response;
  const status = isAlgo ? mapAlgoStatus(response.algoStatus) : mapOrderStatus(response.status);
  const price = isAlgo ? undefined : Number(response.price) || undefined;
  const stopPrice = isAlgo ? Number(response.triggerPrice) || undefined : undefined;

  const order = await OrderModel.create({
    ...owner,
    orderId: String(isAlgo ? response.algoId : response.orderId),
    clientOrderId: isAlgo ? response.clientAlgoId : response.clientOrderId,
    orderType: details.orderType,
    side: details.side === "BUY" ? OrderSide.Buy : OrderSide.Sell,
    positionSide: PositionSide.Both,
    role: details.role,
    targetIndex: details.targetIndex,
    isAlgo,
    closePosition: details.closePosition ?? false,
    quantity: isAlgo ? undefined : Number(response.origQty) || undefined,
    price,
    stopPrice,
    reduceOnly: details.reduceOnly ?? false,
    status,
    filledQuantity: isAlgo ? 0 : Number(response.executedQty),
    averageFillPrice: isAlgo ? undefined : Number(response.avgPrice) || undefined
  });

  await OrderEventModel.create({
    orderId: order.orderId,
    tradeExecutionId: owner.tradeExecutionId,
    eventType: OrderEventType.Created,
    newStatus: status,
    rawEvent: response as unknown as Record<string, unknown>,
    eventTime: new Date()
  });

  return order;
};

/** Applies the latest exchange state to a stored order and audits status changes. */
export const applyExchangeState = async (
  order: OrderDocument,
  response: BinanceOrderResponse | BinanceAlgoOrderResponse
): Promise<void> => {
  const isAlgo = "algoId" in response;
  const newStatus = isAlgo ? mapAlgoStatus(response.algoStatus) : mapOrderStatus(response.status);
  const filledQuantity = isAlgo ? order.filledQuantity : Number(response.executedQty);
  const averageFillPrice = isAlgo ? order.averageFillPrice : Number(response.avgPrice) || undefined;

  if (newStatus === order.status && filledQuantity === order.filledQuantity) {
    return;
  }

  const previousStatus = order.status;
  order.status = newStatus;
  order.filledQuantity = filledQuantity;
  order.averageFillPrice = averageFillPrice;
  await order.save();

  await OrderEventModel.create({
    orderId: order.orderId,
    tradeExecutionId: order.tradeExecutionId,
    eventType: eventTypeForStatus(newStatus),
    previousStatus,
    newStatus,
    rawEvent: response as unknown as Record<string, unknown>,
    eventTime: new Date()
  });
};
