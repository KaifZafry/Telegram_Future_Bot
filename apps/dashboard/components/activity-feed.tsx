"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Info, MessageSquare, XCircle } from "lucide-react";
import { useState } from "react";

import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { useLive } from "@/lib/live";
import type { LogEntry } from "@/lib/types";

import { EmptyState, ErrorState, Skeleton, Toggle, cn } from "./ui";

const levelIcon = (level: LogEntry["level"]) => {
  switch (level) {
    case "ERROR":
    case "FATAL":
      return <XCircle className="size-4 text-loss-text" aria-label="Error" />;
    case "WARN":
      return <AlertTriangle className="size-4 text-warn" aria-label="Warning" />;
    case "DEBUG":
      return <MessageSquare className="size-4 text-muted" aria-label="Message" />;
    default:
      return <Info className="size-4 text-accent-text" aria-label="Info" />;
  }
};

const keyOf = (entry: LogEntry) => `${entry.createdAt}|${entry.message}`;

export const ActivityFeed = ({ limit = 30 }: { limit?: number }) => {
  const [showChatter, setShowChatter] = useState(false);
  const { recent } = useLive();
  const logs = useQuery({
    queryKey: ["logs", showChatter],
    queryFn: () => api.get<LogEntry[]>(`/logs?limit=${limit}&includeDebug=${showChatter}`)
  });

  // Live entries arrive before the next refetch; merge and de-duplicate.
  const seen = new Set<string>();
  const entries = [...recent.filter((entry) => showChatter || entry.level !== "DEBUG"), ...(logs.data ?? [])]
    .filter((entry) => {
      const key = keyOf(entry);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
  const liveKeys = new Set(recent.map(keyOf));

  return (
    <div>
      <div className="flex items-center justify-end gap-2 px-5 pt-3 text-xs text-muted">
        <span id="chatter-label">Show non-signal messages</span>
        <Toggle label="Show non-signal messages" checked={showChatter} onChange={setShowChatter} />
      </div>
      {logs.isPending ? (
        <div className="space-y-3 p-5">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-10" />
          ))}
        </div>
      ) : logs.error ? (
        <ErrorState error={logs.error} onRetry={() => void logs.refetch()} />
      ) : entries.length === 0 ? (
        <EmptyState icon={<Info className="size-5" />} title="No activity yet">
          Signals, orders and trade events will appear here the moment they happen.
        </EmptyState>
      ) : (
        <ol aria-live="polite" className="max-h-[28rem] divide-y divide-border overflow-y-auto">
          {entries.map((entry) => (
            <li
              key={keyOf(entry)}
              className={cn("flex gap-3 px-5 py-3", liveKeys.has(keyOf(entry)) && "flash-in")}
            >
              <span className="mt-0.5 shrink-0">{levelIcon(entry.level)}</span>
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm text-text">{entry.message}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {entry.category.toLowerCase()} · <time dateTime={entry.createdAt}>{timeAgo(entry.createdAt)}</time>
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};
