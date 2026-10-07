"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { CloseReasonBadge, ExecutionStatusBadge } from "@/components/status";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  SideBadge,
  Skeleton,
  cn
} from "@/components/ui";
import { api } from "@/lib/api";
import { formatDateTime, formatPnl, formatPrice, pnlTone } from "@/lib/format";
import type { Execution } from "@/lib/types";

const OUTCOMES = [
  { value: "all", label: "All" },
  { value: "closed", label: "Closed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "failed", label: "Failed" }
] as const;

type Outcome = (typeof OUTCOMES)[number]["value"];

const toCsv = (rows: Execution[]): string => {
  const header = ["closedAt", "symbol", "side", "account", "status", "closeReason", "entry", "leverage", "realizedPnL", "fees", "netPnL"];
  const lines = rows.map((row) =>
    [
      row.closedAt ?? "",
      row.symbol,
      row.side,
      row.accountName,
      row.status,
      row.closeReason ?? "",
      row.actualEntry ?? "",
      row.leverage,
      row.realizedPnL,
      row.fees,
      row.netPnL
    ]
      .map((value) => `"${String(value).replace(/"/g, '""')}"`)
      .join(",")
  );
  return [header.join(","), ...lines].join("\n");
};

export default function HistoryPage() {
  const [outcome, setOutcome] = useState<Outcome>("all");
  const trades = useInfiniteQuery({
    queryKey: ["trades", outcome],
    queryFn: ({ pageParam }) =>
      api.page<Execution[]>(`/trades?limit=50&outcome=${outcome}${pageParam ? `&before=${pageParam}` : ""}`),
    initialPageParam: "",
    getNextPageParam: (lastPage) => lastPage.nextCursor
  });
  const rows = trades.data?.pages.flatMap((page) => page.items) ?? [];
  const closed = rows.filter((row) => row.status === "CLOSED");
  const net = closed.reduce((total, row) => total + row.netPnL, 0);

  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `trades-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader
        title="Trade history"
        description={
          closed.length > 0 ? undefined : "Finished, cancelled and failed trades"
        }
        action={
          <div className="flex items-center gap-4">
            {closed.length > 0 && (
              <p className="text-sm text-text-2">
                {closed.length} closed shown · net{" "}
                <span className={cn("num font-semibold", pnlTone(net))}>{formatPnl(net)} USDT</span>
              </p>
            )}
            <Button size="sm" disabled={rows.length === 0} onClick={exportCsv}>
              Export CSV
            </Button>
          </div>
        }
      />

      <Card
        bodyClassName="p-0"
        title={
          <div role="tablist" aria-label="Filter by outcome" className="flex gap-1">
            {OUTCOMES.map((option) => (
              <button
                key={option.value}
                type="button"
                role="tab"
                aria-selected={outcome === option.value}
                onClick={() => setOutcome(option.value)}
                className={cn(
                  "cursor-pointer rounded-md px-3 py-1 text-xs font-medium",
                  outcome === option.value ? "bg-surface-3 text-text" : "text-muted hover:text-text"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        }
      >
        {trades.isPending ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-11" />
            ))}
          </div>
        ) : trades.error ? (
          <ErrorState error={trades.error} onRetry={() => void trades.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<History className="size-5" />} title="No trades here yet">
            Trades move here once they close, are cancelled, or fail.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="border-b border-border text-xs text-muted">
                <tr>
                  <th className="px-5 py-3 font-medium">Closed</th>
                  <th className="px-3 py-3 font-medium">Symbol</th>
                  <th className="px-3 py-3 font-medium">Side</th>
                  <th className="px-3 py-3 font-medium">Account</th>
                  <th className="px-3 py-3 font-medium">Avg entry</th>
                  <th className="px-3 py-3 font-medium">Result</th>
                  <th className="px-3 py-3 text-right font-medium">Fees</th>
                  <th className="px-5 py-3 text-right font-medium">Net PnL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr key={row._id} className="hover:bg-surface-2">
                    <td className="whitespace-nowrap px-5 py-3 text-text-2">{formatDateTime(row.closedAt ?? row.createdAt)}</td>
                    <td className="px-3 py-3 font-medium">
                      <Link href={`/signals?id=${row.signalId}`} className="hover:text-accent-text hover:underline">
                        {row.symbol}
                      </Link>
                      <span className="ml-1.5 text-xs text-muted">{row.leverage}x</span>
                    </td>
                    <td className="px-3 py-3"><SideBadge side={row.side} /></td>
                    <td className="px-3 py-3 text-text-2">{row.accountName}</td>
                    <td className="num px-3 py-3">{formatPrice(row.actualEntry)}</td>
                    <td className="px-3 py-3">
                      {row.status === "CLOSED" ? (
                        <CloseReasonBadge reason={row.closeReason} />
                      ) : (
                        <span className="flex flex-col gap-1">
                          <ExecutionStatusBadge status={row.status} />
                          {row.errorMessage && (
                            <span className="max-w-60 truncate text-xs text-muted" title={row.errorMessage}>
                              {row.errorMessage}
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="num px-3 py-3 text-right text-text-2">{row.fees ? row.fees.toFixed(4) : "—"}</td>
                    <td className={cn("num px-5 py-3 text-right font-semibold", pnlTone(row.netPnL))}>
                      {row.status === "CLOSED" ? formatPnl(row.netPnL) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {trades.hasNextPage && (
              <div className="border-t border-border p-4 text-center">
                <Button size="sm" loading={trades.isFetchingNextPage} onClick={() => void trades.fetchNextPage()}>
                  Load older
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>
    </>
  );
}
