"use client";

import { useQuery } from "@tanstack/react-query";
import { Wallet } from "lucide-react";

import { PositionCard } from "@/components/position-card";
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { formatPnl, pnlTone } from "@/lib/format";
import type { Execution } from "@/lib/types";

export default function PositionsPage() {
  const positions = useQuery({ queryKey: ["positions"], queryFn: () => api.get<Execution[]>("/positions") });
  const open = positions.data?.filter((execution) => execution.status !== "EXECUTING") ?? [];
  const waiting = positions.data?.filter((execution) => execution.status === "EXECUTING") ?? [];
  const unrealized = open.reduce((total, execution) => total + execution.unrealizedPnL, 0);

  return (
    <>
      <PageHeader
        title="Positions"
        description="Live trades managed by the bot. Updates every few seconds."
        action={
          open.length > 0 ? (
            <p className="text-sm text-text-2">
              Unrealized <span className={`num font-semibold ${pnlTone(unrealized)}`}>{formatPnl(unrealized)} USDT</span>
            </p>
          ) : undefined
        }
      />

      {positions.isPending ? (
        <div className="space-y-4">
          <Skeleton className="h-56 rounded-xl" />
          <Skeleton className="h-56 rounded-xl" />
        </div>
      ) : positions.error ? (
        <Card>
          <ErrorState error={positions.error} onRetry={() => void positions.refetch()} />
        </Card>
      ) : positions.data.length === 0 ? (
        <Card>
          <EmptyState icon={<Wallet className="size-5" />} title="No open positions">
            When a signal arrives, its orders and live PnL show up here, with a button to close it at any time.
          </EmptyState>
        </Card>
      ) : (
        <div className="space-y-8">
          {open.length > 0 && (
            <section aria-labelledby="open-heading" className="space-y-4">
              <h2 id="open-heading" className="text-sm font-medium text-text-2">
                Open ({open.length})
              </h2>
              {open.map((execution) => (
                <PositionCard key={execution._id} execution={execution} />
              ))}
            </section>
          )}
          {waiting.length > 0 && (
            <section aria-labelledby="waiting-heading" className="space-y-4">
              <h2 id="waiting-heading" className="text-sm font-medium text-text-2">
                Waiting for entry ({waiting.length})
              </h2>
              {waiting.map((execution) => (
                <PositionCard key={execution._id} execution={execution} />
              ))}
            </section>
          )}
        </div>
      )}
    </>
  );
}
