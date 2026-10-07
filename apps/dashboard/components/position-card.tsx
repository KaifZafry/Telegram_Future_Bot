"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { api } from "@/lib/api";
import {
  formatDateTime,
  formatPnl,
  formatPrice,
  formatQty,
  humanize,
  pnlTone,
  timeAgo
} from "@/lib/format";
import type { Execution, Order } from "@/lib/types";

import { ExecutionStatusBadge } from "./status";
import { Badge, Button, ConfirmDialog, SideBadge, cn } from "./ui";

interface Level {
  price: number;
  kind: "stop" | "entry" | "target" | "average" | "mark";
  label: string;
  done?: boolean;
}

const entryOrders = (orders: Order[]) => orders.filter((order) => order.role === "ENTRY");

const buildLevels = (execution: Execution, orders: Order[]): Level[] => {
  const hitTargets = new Set(
    orders
      .filter((order) => order.role === "TAKE_PROFIT" && order.status === "FILLED")
      .map((order) => order.targetIndex)
  );
  const levels: Level[] = [
    {
      price: execution.currentStopLoss,
      kind: "stop",
      label: execution.slMovedToBreakeven ? "SL (breakeven)" : "SL"
    },
    ...entryOrders(orders)
      .filter((order) => order.price !== undefined || order.averageFillPrice !== undefined)
      .map((order, index) => ({
        price: order.price ?? order.averageFillPrice ?? 0,
        kind: "entry" as const,
        label: order.orderType === "MARKET" ? "Market entry" : `Entry ${index + 1}`,
        done: order.filledQuantity > 0
      })),
    ...execution.takeProfits.map((target, index) => ({
      price: target.price,
      kind: "target" as const,
      label: `TP${index + 1}`,
      done: hitTargets.has(index)
    }))
  ];

  if (execution.actualEntry) {
    levels.push({ price: execution.actualEntry, kind: "average", label: "Avg entry" });
  }

  if (execution.markPrice) {
    levels.push({ price: execution.markPrice, kind: "mark", label: "Mark" });
  }

  return levels.filter((level) => level.price > 0);
};

const markerStyle: Record<Level["kind"], string> = {
  stop: "bg-loss",
  entry: "bg-text-2",
  target: "bg-gain",
  average: "bg-text",
  mark: "bg-accent"
};

/** Price ladder from lowest to highest level, with the live mark price. */
const PriceLadder = ({ levels }: { levels: Level[] }) => {
  const prices = levels.map((level) => level.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const position = (price: number) => 3 + ((price - min) / span) * 94;
  const mark = levels.find((level) => level.kind === "mark");

  return (
    <div aria-hidden className="relative h-12 select-none">
      <div className="absolute inset-x-0 top-5 h-1 rounded-full bg-surface-3" />
      {levels
        .filter((level) => level.kind !== "mark")
        .map((level) => (
          <span
            key={`${level.kind}-${level.label}-${level.price}`}
            title={`${level.label} ${formatPrice(level.price)}`}
            className={cn(
              "absolute top-3.5 h-4 w-1 -translate-x-1/2 rounded-full",
              markerStyle[level.kind],
              level.kind === "entry" && !level.done && "opacity-40",
              level.kind === "target" && !level.done && "opacity-60"
            )}
            style={{ left: `${position(level.price)}%` }}
          />
        ))}
      {mark && (
        <span
          className="absolute top-0 -translate-x-1/2 text-[10px] font-medium text-accent-text"
          style={{ left: `${position(mark.price)}%` }}
        >
          ▼
        </span>
      )}
      <span className="num absolute left-0 top-8 text-[11px] text-muted">{formatPrice(min)}</span>
      <span className="num absolute right-0 top-8 text-[11px] text-muted">{formatPrice(max)}</span>
    </div>
  );
};

const LevelList = ({ levels }: { levels: Level[] }) => (
  <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
    {levels
      .filter((level) => level.kind !== "mark")
      .sort((a, b) => a.price - b.price)
      .map((level) => (
        <li key={`${level.kind}-${level.label}-${level.price}`} className="flex items-center gap-1.5">
          <span aria-hidden className={cn("size-2 rounded-full", markerStyle[level.kind])} />
          <span className="text-text-2">{level.label}</span>
          <span className="num text-text">{formatPrice(level.price)}</span>
          {level.done && (
            <span className="text-gain-text">
              <Check className="inline size-3" aria-hidden />
              <span className="sr-only">{level.kind === "target" ? "hit" : "filled"}</span>
            </span>
          )}
        </li>
      ))}
  </ul>
);

const OrdersTable = ({ orders }: { orders: Order[] }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-left text-xs">
      <thead className="text-muted">
        <tr>
          <th className="py-2 pr-3 font-medium">Role</th>
          <th className="py-2 pr-3 font-medium">Type</th>
          <th className="py-2 pr-3 font-medium">Price</th>
          <th className="py-2 pr-3 font-medium">Qty</th>
          <th className="py-2 pr-3 font-medium">Filled</th>
          <th className="py-2 font-medium">Status</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {orders.map((order) => (
          <tr key={order._id} className={cn(["CANCELED", "EXPIRED"].includes(order.status) && "text-muted")}>
            <td className="py-2 pr-3">
              {order.role === "TAKE_PROFIT" ? `TP${(order.targetIndex ?? 0) + 1}` : humanize(order.role)}
            </td>
            <td className="py-2 pr-3">{humanize(order.orderType)}</td>
            <td className="num py-2 pr-3">{formatPrice(order.stopPrice ?? order.price ?? order.averageFillPrice)}</td>
            <td className="num py-2 pr-3">{order.closePosition ? "Whole position" : formatQty(order.quantity)}</td>
            <td className="num py-2 pr-3">{order.filledQuantity > 0 ? formatQty(order.filledQuantity) : "—"}</td>
            <td className="py-2">{humanize(order.status)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export const PositionCard = ({ execution }: { execution: Execution }) => {
  const queryClient = useQueryClient();
  const [confirmClose, setConfirmClose] = useState(false);
  const [showOrders, setShowOrders] = useState(false);
  const orders = execution.orders ?? [];
  const levels = buildLevels(execution, orders);
  const waiting = execution.status === "EXECUTING";

  const close = useMutation({
    mutationFn: () => api.post(`/positions/${execution._id}/close`),
    onSuccess: () => {
      setConfirmClose(false);
      void queryClient.invalidateQueries({ queryKey: ["positions"] });
      void queryClient.invalidateQueries({ queryKey: ["summary"] });
    }
  });

  return (
    <article className="rounded-xl border border-border bg-surface">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-5 py-4">
        <h3 className="text-base font-semibold">{execution.symbol}</h3>
        <SideBadge side={execution.side} />
        <Badge>
          {execution.marginType === "CROSSED" ? "Cross" : "Isolated"} {execution.leverage}x
        </Badge>
        <ExecutionStatusBadge status={execution.status} />
        {execution.slMovedToBreakeven && (
          <Badge tone="gain" icon={<ShieldCheck className="size-3" aria-hidden />}>
            Risk-free
          </Badge>
        )}
        <span className="text-xs text-muted">{execution.accountName}</span>
        <div className="ml-auto">
          <Button
            size="sm"
            variant="danger"
            icon={<X className="size-3.5" aria-hidden />}
            onClick={() => setConfirmClose(true)}
          >
            {waiting ? "Cancel" : "Close"}
          </Button>
        </div>
      </header>

      <div className="grid gap-5 p-5 md:grid-cols-[minmax(0,14rem)_1fr]">
        <dl className="grid content-start grid-cols-2 gap-x-4 gap-y-3 text-sm md:grid-cols-1">
          <div>
            <dt className="text-xs text-muted">{waiting ? "Status" : "Unrealized PnL"}</dt>
            <dd className={cn("num font-semibold", waiting ? "text-base text-text-2" : cn("text-xl", pnlTone(execution.unrealizedPnL)))}>
              {waiting ? "Waiting for entry" : `${formatPnl(execution.unrealizedPnL)} USDT`}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Size</dt>
            <dd className="num">
              {waiting ? `${formatQty(execution.quantity)} planned` : formatQty(execution.positionQuantity)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Avg entry / Mark</dt>
            <dd className="num">
              {formatPrice(execution.actualEntry)} / <span className="text-accent-text">{formatPrice(execution.markPrice)}</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">{waiting ? "Entry expires" : "Opened"}</dt>
            <dd>
              {waiting
                ? formatDateTime(execution.entryExpiresAt)
                : timeAgo(execution.executedAt ?? execution.createdAt)}
            </dd>
          </div>
        </dl>

        <div className="min-w-0 space-y-3">
          {levels.length > 1 && <PriceLadder levels={levels} />}
          <LevelList levels={levels} />
          <button
            type="button"
            aria-expanded={showOrders}
            onClick={() => setShowOrders((value) => !value)}
            className="inline-flex cursor-pointer items-center gap-1 text-xs text-text-2 hover:text-text"
          >
            <ChevronDown className={cn("size-3.5 transition-transform", showOrders && "rotate-180")} aria-hidden />
            {orders.length} orders
          </button>
          {showOrders && <OrdersTable orders={orders} />}
          <Link href={`/signals?id=${execution.signalId}`} className="block text-xs text-accent-text hover:underline">
            View original signal
          </Link>
        </div>
      </div>

      <ConfirmDialog
        open={confirmClose}
        title={waiting ? `Cancel ${execution.symbol} entry?` : `Close ${execution.symbol} now?`}
        confirmLabel={waiting ? "Cancel entry" : "Close at market"}
        loading={close.isPending}
        onConfirm={() => close.mutate()}
        onCancel={() => setConfirmClose(false)}
      >
        <p>
          {waiting
            ? "Cancels the unfilled entry orders and the stop loss on Binance."
            : `Cancels the remaining entries, take profits and stop loss, then closes ${formatQty(execution.positionQuantity)} ${execution.symbol} at market.`}
        </p>
        {close.error && <p className="mt-3 text-loss-text">{close.error.message}</p>}
      </ConfirmDialog>
    </article>
  );
};
