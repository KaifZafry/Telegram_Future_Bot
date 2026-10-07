"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from "react";

import { API_URL } from "./api";
import type { LogEntry } from "./types";

type ConnectionState = "connecting" | "live" | "offline";

interface LiveContextValue {
  connection: ConnectionState;
  /** Log entries received over the stream since the page loaded, newest first. */
  recent: LogEntry[];
}

const LiveContext = createContext<LiveContextValue>({ connection: "connecting", recent: [] });

const MAX_RECENT = 100;

/**
 * Subscribes to the backend's Server-Sent Events stream and keeps cached
 * queries fresh: any trade/signal log refreshes the affected views, and the
 * position manager's ticks refresh open positions (live PnL).
 */
export const LiveProvider = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient();
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [recent, setRecent] = useState<LogEntry[]>([]);
  const pendingRefresh = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const source = new EventSource(`${API_URL}/api/events`, { withCredentials: true });

    // Several events usually arrive together (orders placed, trade opened…);
    // refresh once after the burst instead of once per event.
    const refreshSoon = (keys: string[][]) => {
      if (pendingRefresh.current) clearTimeout(pendingRefresh.current);
      pendingRefresh.current = setTimeout(() => {
        keys.forEach((queryKey) => void queryClient.invalidateQueries({ queryKey }));
      }, 400);
    };

    source.onopen = () => setConnection("live");
    source.onerror = () => setConnection(source.readyState === EventSource.CLOSED ? "offline" : "connecting");

    source.addEventListener("log", (event) => {
      const entry = JSON.parse((event as MessageEvent<string>).data) as LogEntry;
      setRecent((current) => [entry, ...current].slice(0, MAX_RECENT));
      refreshSoon([["summary"], ["signals"], ["signal"], ["positions"], ["trades"], ["daily"], ["logs"]]);
    });

    source.addEventListener("positions", () => {
      void queryClient.invalidateQueries({ queryKey: ["positions"] });
      void queryClient.invalidateQueries({ queryKey: ["summary"] });
    });

    source.addEventListener("settings", () => {
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
      void queryClient.invalidateQueries({ queryKey: ["summary"] });
    });

    return () => {
      source.close();
      if (pendingRefresh.current) clearTimeout(pendingRefresh.current);
    };
  }, [queryClient]);

  return <LiveContext.Provider value={{ connection, recent }}>{children}</LiveContext.Provider>;
};

export const useLive = (): LiveContextValue => useContext(LiveContext);
