"use client";

import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { FlaskConical, Radio } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { CloseReasonBadge, ExecutionStatusBadge, SignalStatusBadge } from "@/components/status";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Modal,
  PageHeader,
  SideBadge,
  Skeleton,
  cn
} from "@/components/ui";
import { api } from "@/lib/api";
import {
  describeEntry,
  formatDateTime,
  formatPnl,
  formatPrice,
  formatQty,
  humanize,
  pnlTone,
  timeAgo
} from "@/lib/format";
import type { Preview, Signal, SignalDetail } from "@/lib/types";

type View = "signals" | "all";

export default function SignalsPage() {
  return (
    <Suspense>
      <SignalsView />
    </Suspense>
  );
}

const SignalsView = () => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("id");
  const [view, setView] = useState<View>("signals");
  const [previewOpen, setPreviewOpen] = useState(false);

  const signals = useInfiniteQuery({
    queryKey: ["signals", view],
    queryFn: ({ pageParam }) =>
      api.page<Signal[]>(`/signals?limit=50&view=${view}${pageParam ? `&before=${pageParam}` : ""}`),
    initialPageParam: "",
    getNextPageParam: (lastPage) => lastPage.nextCursor
  });
  const rows = signals.data?.pages.flatMap((page) => page.items) ?? [];

  const openSignal = (id: string | null) =>
    router.replace(id ? `${pathname}?id=${id}` : pathname, { scroll: false });

  return (
    <>
      <PageHeader
        title="Signals"
        description="Every message from your Telegram sources and what the bot did with it"
        action={
          <Button icon={<FlaskConical className="size-4" aria-hidden />} onClick={() => setPreviewOpen(true)}>
            Test a signal
          </Button>
        }
      />

      <Card
        bodyClassName="p-0"
        title={
          <div role="tablist" aria-label="Filter messages" className="flex gap-1">
            {(["signals", "all"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={view === option}
                onClick={() => setView(option)}
                className={cn(
                  "cursor-pointer rounded-md px-3 py-1 text-xs font-medium",
                  view === option ? "bg-surface-3 text-text" : "text-muted hover:text-text"
                )}
              >
                {option === "signals" ? "Trade signals" : "All messages"}
              </button>
            ))}
          </div>
        }
      >
        {signals.isPending ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-11" />
            ))}
          </div>
        ) : signals.error ? (
          <ErrorState error={signals.error} onRetry={() => void signals.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<Radio className="size-5" />} title="No messages yet">
            Messages from your active Telegram sources appear here as they arrive.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-border text-xs text-muted">
                <tr>
                  <th className="px-5 py-3 font-medium">Received</th>
                  <th className="px-3 py-3 font-medium">Symbol</th>
                  <th className="px-3 py-3 font-medium">Side</th>
                  <th className="px-3 py-3 font-medium">Entry</th>
                  <th className="px-3 py-3 font-medium">SL</th>
                  <th className="px-3 py-3 font-medium">TPs</th>
                  <th className="px-3 py-3 font-medium">Outcome</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((signal) => (
                  <tr
                    key={signal._id}
                    tabIndex={0}
                    onClick={() => openSignal(signal._id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openSignal(signal._id);
                      }
                    }}
                    className="cursor-pointer hover:bg-surface-2 focus-visible:bg-surface-2"
                    aria-label={`Open ${signal.symbol ?? "message"} from ${signal.sourceName}`}
                  >
                    <td className="whitespace-nowrap px-5 py-3">
                      <span className="text-text">{timeAgo(signal.receivedAt)}</span>
                      <span className="block text-xs text-muted">{signal.sourceName}</span>
                    </td>
                    <td className="px-3 py-3 font-medium">
                      {signal.symbol ?? (
                        <span className="block max-w-56 truncate font-normal text-muted">{signal.rawText}</span>
                      )}
                    </td>
                    <td className="px-3 py-3">{signal.symbol ? <SideBadge side={signal.side} /> : null}</td>
                    <td className="num whitespace-nowrap px-3 py-3">{signal.symbol ? describeEntry(signal.entry) : ""}</td>
                    <td className="num px-3 py-3">{signal.symbol ? formatPrice(signal.stopLoss) : ""}</td>
                    <td className="num px-3 py-3">{signal.symbol ? signal.takeProfits.length : ""}</td>
                    <td className="px-3 py-3">
                      <SignalStatusBadge signal={signal} />
                      {(signal.followUp?.notes[0] ?? signal.rejectionReason) && (
                        <span className="mt-1 block max-w-64 truncate text-xs text-muted" title={signal.followUp?.notes.join("; ") ?? signal.rejectionReason}>
                          {signal.followUp?.notes[0] ?? signal.rejectionReason}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {signals.hasNextPage && (
              <div className="border-t border-border p-4 text-center">
                <Button size="sm" loading={signals.isFetchingNextPage} onClick={() => void signals.fetchNextPage()}>
                  Load older
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>

      <SignalDetailModal id={selectedId} onClose={() => openSignal(null)} />
      <PreviewModal open={previewOpen} onClose={() => setPreviewOpen(false)} />
    </>
  );
};

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex justify-between gap-4 py-1.5 text-sm">
    <dt className="text-muted">{label}</dt>
    <dd className="num text-right">{children}</dd>
  </div>
);

const SignalDetailModal = ({ id, onClose }: { id: string | null; onClose: () => void }) => {
  const detail = useQuery({
    queryKey: ["signal", id],
    queryFn: () => api.get<SignalDetail>(`/signals/${id}`),
    enabled: Boolean(id)
  });
  const signal = detail.data?.signal;

  return (
    <Modal open={Boolean(id)} onClose={onClose} title={signal?.symbol ? `${signal.symbol} signal` : "Message"} wide>
      {detail.isPending ? (
        <Skeleton className="h-64" />
      ) : detail.error ? (
        <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
      ) : signal ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <SignalStatusBadge signal={signal} />
            <span>
              {detail.data.source?.name ?? "Unknown source"} · {formatDateTime(signal.receivedAt)}
            </span>
          </div>

          {signal.followUp && (
            <div className="rounded-lg border border-accent/30 bg-accent/10 p-3 text-sm text-text-2">
              <p className="mb-1 font-medium text-accent-text">What the bot did with this follow-up</p>
              <ul className="list-inside list-disc space-y-0.5">
                {signal.followUp.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          )}

          {!signal.followUp && (signal.rejectionReason ?? signal.parseError) && (
            <p className="rounded-lg border border-warn/30 bg-warn/10 p-3 text-sm text-warn">
              {signal.rejectionReason ?? signal.parseError?.message}
            </p>
          )}

          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <h3 className="mb-2 text-xs font-medium text-muted">Original message</h3>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-bg p-3 font-sans text-sm text-text-2">
                {signal.rawText}
              </pre>
            </div>
            {signal.symbol && (
              <div>
                <h3 className="mb-2 text-xs font-medium text-muted">Understood as</h3>
                <dl className="divide-y divide-border rounded-lg border border-border px-3">
                  <Row label="Pair">{signal.symbol}</Row>
                  <Row label="Side"><SideBadge side={signal.side} /></Row>
                  <Row label="Leverage">
                    {signal.leverage ? `${signal.marginType === "ISOLATED" ? "Isolated" : "Cross"} ${signal.leverage}x` : "Default"}
                  </Row>
                  <Row label="Entry">{describeEntry(signal.entry)}</Row>
                  <Row label="Stop loss">{formatPrice(signal.stopLoss)}</Row>
                  {signal.takeProfits.map((target, index) => (
                    <Row key={target.price} label={`TP${index + 1}`}>
                      {formatPrice(target.price)} <span className="text-muted">({target.allocationPercentage}%)</span>
                    </Row>
                  ))}
                </dl>
              </div>
            )}
          </div>

          {detail.data.executions.map((execution) => (
            <section key={execution._id} className="rounded-lg border border-border">
              <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
                <span className="text-sm font-medium">{execution.accountName}</span>
                <ExecutionStatusBadge status={execution.status} />
                {execution.closeReason && <CloseReasonBadge reason={execution.closeReason} />}
                {["CLOSED"].includes(execution.status) && (
                  <span className={cn("num ml-auto text-sm font-semibold", pnlTone(execution.netPnL))}>
                    {formatPnl(execution.netPnL)} USDT
                  </span>
                )}
              </header>
              {execution.errorMessage && (
                <p className="border-b border-border px-4 py-2 text-xs text-muted">{execution.errorMessage}</p>
              )}
              <div className="overflow-x-auto px-4 py-2">
                <table className="w-full text-left text-xs">
                  <thead className="text-muted">
                    <tr>
                      <th className="py-1.5 pr-3 font-medium">Order</th>
                      <th className="py-1.5 pr-3 font-medium">Price</th>
                      <th className="py-1.5 pr-3 font-medium">Qty</th>
                      <th className="py-1.5 pr-3 font-medium">Filled</th>
                      <th className="py-1.5 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {execution.orders.map((order) => (
                      <tr key={order._id}>
                        <td className="py-1.5 pr-3">
                          {order.role === "TAKE_PROFIT" ? `TP${(order.targetIndex ?? 0) + 1}` : humanize(order.role)}{" "}
                          <span className="text-muted">{humanize(order.orderType)}</span>
                        </td>
                        <td className="num py-1.5 pr-3">{formatPrice(order.stopPrice ?? order.price ?? order.averageFillPrice)}</td>
                        <td className="num py-1.5 pr-3">{order.closePosition ? "All" : formatQty(order.quantity)}</td>
                        <td className="num py-1.5 pr-3">{order.filledQuantity > 0 ? formatQty(order.filledQuantity) : "—"}</td>
                        <td className="py-1.5">{humanize(order.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      ) : null}
    </Modal>
  );
};

const SAMPLE = `Coin #RLC/USDT

Position: LONG

Leverage:  Cross 20×

Entries:  0.8250 - 0.7900

Targets: 🎯 0.8650, 0.9150, 0.9750

Stop Loss: 0.7550`;

const PreviewModal = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const [text, setText] = useState("");
  const preview = useMutation({ mutationFn: () => api.post<Preview>("/tools/preview", { text }) });
  const result = preview.data;

  return (
    <Modal open={open} onClose={onClose} title="Test a signal" wide>
      <p className="mb-3 text-sm text-text-2">
        Paste a message to see exactly what the bot would trade with your current settings and live prices.
        Nothing is sent to Binance.
      </p>
      <label htmlFor="preview-text" className="mb-1.5 block text-xs font-medium text-text-2">
        Signal message
      </label>
      <textarea
        id="preview-text"
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={8}
        placeholder={SAMPLE}
        className="w-full rounded-lg border border-border-strong bg-bg p-3 text-sm text-text placeholder:text-muted/60 focus:border-accent focus:outline-none"
      />
      <div className="mt-3 flex gap-2">
        <Button variant="primary" loading={preview.isPending} disabled={!text.trim()} onClick={() => preview.mutate()}>
          Preview orders
        </Button>
        {!text && (
          <Button variant="ghost" onClick={() => setText(SAMPLE)}>
            Use example
          </Button>
        )}
      </div>

      {preview.error && <p className="mt-4 text-sm text-loss-text">{preview.error.message}</p>}

      {result && (
        <div className="mt-6 space-y-4" aria-live="polite">
          {result.market && (
            <p className="num text-xs text-muted">
              {result.parsed.success ? result.parsed.data.symbol : ""} mark price {formatPrice(result.market.markPrice)} ·{" "}
              {result.environment === "LIVE" ? "Binance" : "Testnet"} prices
            </p>
          )}
          {result.plan ? (
            <>
              <div className="flex flex-wrap gap-2">
                <Badge tone="accent">
                  {result.plan.marginUsdt} USDT × {result.plan.leverage}x = {result.plan.notionalUsdt} USDT
                </Badge>
                {result.lossAtStopUsdt !== undefined && (
                  <Badge tone="loss">Loss at SL if fully filled ≈ −{result.lossAtStopUsdt.toFixed(2)} USDT</Badge>
                )}
              </div>
              <ol className="num space-y-1.5 rounded-lg border border-border bg-bg p-4 text-sm">
                <li>
                  <span className="text-loss-text">Stop loss</span> · STOP_MARKET {result.plan.exitSide} whole position @{" "}
                  {formatPrice(result.plan.stopLoss)}
                </li>
                {result.plan.legs.map((leg, index) => (
                  <li key={index}>
                    <span className="text-text-2">Entry {index + 1}</span> · {leg.type} {result.plan?.entrySide} {leg.quantity}{" "}
                    {leg.type === "LIMIT" ? `@ ${formatPrice(leg.price)}` : `now (~${formatPrice(leg.referencePrice)})`}
                  </li>
                ))}
                {result.plan.takeProfits.map((target, index) => (
                  <li key={target.price}>
                    <span className="text-gain-text">TP{index + 1}</span> · {result.plan?.exitSide} {target.allocationPercentage}% @{" "}
                    {formatPrice(target.price)} <span className="text-muted">(placed as entries fill)</span>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="rounded-lg border border-warn/30 bg-warn/10 p-3 text-sm text-warn">
              Would not trade: {result.rejection}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
};
