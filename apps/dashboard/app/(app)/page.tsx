"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, Circle, LineChart, Wallet } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import { ActivityFeed } from "@/components/activity-feed";
import { DailyPnlChart, EquityChart } from "@/components/charts";
import { ExecutionStatusBadge } from "@/components/status";
import {
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  SideBadge,
  Skeleton,
  cn
} from "@/components/ui";
import { api } from "@/lib/api";
import { formatPercent, formatPnl, formatPrice, pnlTone, timeAgo } from "@/lib/format";
import type { DailyPoint, Execution, Summary } from "@/lib/types";

const RANGES = [7, 30, 90] as const;

export default function OverviewPage() {
  const summary = useQuery({ queryKey: ["summary"], queryFn: () => api.get<Summary>("/dashboard/summary") });

  return (
    <>
      <PageHeader
        title="Overview"
        description={
          summary.data ? `Last signal ${timeAgo(summary.data.lastSignalAt)}` : "Your bot at a glance"
        }
      />

      {summary.error ? (
        <Card>
          <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
        </Card>
      ) : (
        <div className="space-y-6">
          {summary.data && <SetupChecklist summary={summary.data} />}
          <StatTiles summary={summary.data} />
          <PerformanceCard />
          <div className="grid gap-6 xl:grid-cols-2">
            <OpenPositionsCard />
            <Card title="Activity" description="Live from the bot" bodyClassName="p-0">
              <ActivityFeed />
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

const SetupChecklist = ({ summary }: { summary: Summary }) => {
  const steps = [
    { done: summary.telegram.running, label: "Telegram listener connected", hint: "Set TELEGRAM_* in .env (npm run telegram:login) and restart" },
    { done: summary.accounts.some((account) => account.isActive), label: "Binance account added", href: "/settings#accounts" },
    { done: summary.trading.configured, label: "Trade settings saved", href: "/settings" },
    { done: summary.trading.enabled, label: "Auto-trading turned on", hint: "Use the switch at the top" }
  ];

  if (steps.every((step) => step.done)) return null;

  return (
    <Card title="Finish setting up" description="The bot trades once every step is done">
      <ol className="grid gap-3 sm:grid-cols-2">
        {steps.map((step) => (
          <li key={step.label} className="flex items-start gap-2.5 text-sm">
            {step.done ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-gain-text" aria-label="Done" />
            ) : (
              <Circle className="mt-0.5 size-4 shrink-0 text-muted" aria-label="To do" />
            )}
            <div>
              {step.href && !step.done ? (
                <Link href={step.href} className="text-accent-text hover:underline">
                  {step.label}
                </Link>
              ) : (
                <span className={step.done ? "text-text-2" : "text-text"}>{step.label}</span>
              )}
              {!step.done && step.hint && <p className="text-xs text-muted">{step.hint}</p>}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
};

const Tile = ({ label, value, valueClass, detail }: { label: string; value: ReactNode; valueClass?: string; detail?: ReactNode }) => (
  <div className="rounded-xl border border-border bg-surface p-5">
    <p className="text-xs font-medium text-muted">{label}</p>
    <p className={cn("num mt-2 text-2xl font-semibold tracking-tight", valueClass)}>{value}</p>
    {detail && <p className="num mt-1 text-xs text-muted">{detail}</p>}
  </div>
);

const StatTiles = ({ summary }: { summary?: Summary }) => {
  if (!summary) {
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-[106px] rounded-xl" />
        ))}
      </div>
    );
  }

  const { today, allTime, open } = summary;

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <Tile
        label="Today net PnL"
        value={`${formatPnl(today.netPnL)}`}
        valueClass={pnlTone(today.netPnL)}
        detail={`${today.winningTrades}W · ${today.losingTrades}L · ${today.executedSignals}/${today.totalSignals} signals traded`}
      />
      <Tile
        label="Unrealized PnL"
        value={formatPnl(open.unrealizedPnL)}
        valueClass={pnlTone(open.unrealizedPnL)}
        detail={`${open.count} open · ${open.pendingEntries} waiting for entry`}
      />
      <Tile
        label="All-time net PnL"
        value={formatPnl(allTime.netPnL)}
        valueClass={pnlTone(allTime.netPnL)}
        detail={`after ${allTime.totalFees.toFixed(2)} USDT fees`}
      />
      <Tile
        label="Win rate"
        value={allTime.winningTrades + allTime.losingTrades === 0 ? "—" : formatPercent(allTime.winRate)}
        detail={`${allTime.winningTrades}W · ${allTime.losingTrades}L · ${allTime.breakevenTrades} BE`}
      />
    </div>
  );
};

const PerformanceCard = () => {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const daily = useQuery({
    queryKey: ["daily", days],
    queryFn: () => api.get<DailyPoint[]>(`/stats/daily?days=${days}`)
  });
  const hasTrades = daily.data?.some((point) => point.winningTrades + point.losingTrades > 0 || point.netPnL !== 0);
  const total = daily.data?.at(-1)?.cumulativePnL ?? 0;

  return (
    <Card
      title="Equity"
      description={hasTrades ? <span className="num">{`${formatPnl(total)} USDT net over ${days} days (UTC)`}</span> : `Cumulative net PnL, daily (UTC)`}
      action={
        <div role="radiogroup" aria-label="Time range" className="flex rounded-lg border border-border bg-bg p-0.5">
          {RANGES.map((range) => (
            <button
              key={range}
              type="button"
              role="radio"
              aria-checked={days === range}
              onClick={() => setDays(range)}
              className={cn(
                "cursor-pointer rounded-md px-2.5 py-1 text-xs",
                days === range ? "bg-surface-3 text-text" : "text-muted hover:text-text"
              )}
            >
              {range}D
            </button>
          ))}
        </div>
      }
    >
      {daily.isPending ? (
        <Skeleton className="h-[26rem]" />
      ) : daily.error ? (
        <ErrorState error={daily.error} onRetry={() => void daily.refetch()} />
      ) : !hasTrades ? (
        <EmptyState icon={<LineChart className="size-5" />} title="No closed trades yet">
          Your equity curve starts with the first closed trade.
        </EmptyState>
      ) : (
        <div className="space-y-6">
          <EquityChart data={daily.data} />
          <div>
            <p className="mb-2 text-xs font-medium text-muted">Net PnL per day</p>
            <DailyPnlChart data={daily.data} />
          </div>
        </div>
      )}
    </Card>
  );
};

const OpenPositionsCard = () => {
  const positions = useQuery({ queryKey: ["positions"], queryFn: () => api.get<Execution[]>("/positions") });

  return (
    <Card
      title="Open positions"
      action={
        <Link href="/positions" className="inline-flex items-center gap-1 text-xs text-accent-text hover:underline">
          Manage <ArrowRight className="size-3" aria-hidden />
        </Link>
      }
      bodyClassName="p-0"
    >
      {positions.isPending ? (
        <div className="space-y-3 p-5">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : positions.error ? (
        <ErrorState error={positions.error} onRetry={() => void positions.refetch()} />
      ) : positions.data.length === 0 ? (
        <EmptyState icon={<Wallet className="size-5" />} title="No open positions">
          New signals open positions automatically while auto-trading is on.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-border">
          {positions.data.map((execution) => (
            <li key={execution._id}>
              <Link href="/positions" className="flex flex-wrap items-center gap-3 px-5 py-3.5 hover:bg-surface-2">
                <span className="font-medium">{execution.symbol}</span>
                <SideBadge side={execution.side} />
                <ExecutionStatusBadge status={execution.status} />
                <span className="num ml-auto text-right text-sm">
                  {execution.status === "EXECUTING" ? (
                    <span className="text-muted">mark {formatPrice(execution.markPrice)}</span>
                  ) : (
                    <span className={pnlTone(execution.unrealizedPnL)}>{formatPnl(execution.unrealizedPnL)} USDT</span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
};
