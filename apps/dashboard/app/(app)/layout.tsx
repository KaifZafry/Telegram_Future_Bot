"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  History,
  LayoutDashboard,
  LogOut,
  OctagonX,
  Radio,
  Settings,
  Wallet
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { Badge, Button, ConfirmDialog, Skeleton, Toggle, cn } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { LiveProvider, useLive } from "@/lib/live";
import type { Summary } from "@/lib/types";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/signals", label: "Signals", icon: Radio },
  { href: "/positions", label: "Positions", icon: Wallet },
  { href: "/history", label: "History", icon: History },
  { href: "/settings", label: "Settings", icon: Settings }
] as const;

const isActive = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname.startsWith(href);

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<{ name: string; email: string }>("/auth/me")
  });

  const unauthenticated = me.error instanceof ApiError && me.error.status === 401;

  useEffect(() => {
    if (unauthenticated) router.replace("/login");
  }, [unauthenticated, router]);

  if (me.isPending || unauthenticated) {
    return (
      <div className="flex min-h-dvh items-center justify-center" aria-busy="true">
        <Skeleton className="h-8 w-40" />
      </div>
    );
  }

  if (me.error) {
    return (
      <div role="alert" className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-loss-text">{me.error.message}</p>
        <Button size="sm" onClick={() => void me.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <LiveProvider>
      <Shell>{children}</Shell>
    </LiveProvider>
  );
}

const Shell = ({ children }: { children: ReactNode }) => {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const summary = useQuery({ queryKey: ["summary"], queryFn: () => api.get<Summary>("/dashboard/summary") });
  const openCount = (summary.data?.open.count ?? 0) + (summary.data?.open.pendingEntries ?? 0);

  const logout = useMutation({
    mutationFn: () => api.post("/auth/logout"),
    onSuccess: () => {
      queryClient.clear();
      router.replace("/login");
    }
  });

  return (
    <div className="min-h-dvh lg:pl-60">
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-border bg-surface lg:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="rounded-lg bg-accent/15 p-1.5 text-accent-text">
            <Activity className="size-4" aria-hidden />
          </div>
          <span className="font-semibold tracking-tight">Signal Desk</span>
        </div>
        <nav aria-label="Main" className="flex-1 space-y-1 px-3">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={isActive(pathname, href) ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                isActive(pathname, href)
                  ? "bg-surface-3 text-text"
                  : "text-text-2 hover:bg-surface-2 hover:text-text"
              )}
            >
              <Icon className="size-4" aria-hidden />
              <span className="flex-1">{label}</span>
              {href === "/positions" && openCount > 0 && (
                <span className="num rounded-full bg-accent/20 px-2 text-xs text-accent-text">{openCount}</span>
              )}
            </Link>
          ))}
        </nav>
        <div className="border-t border-border p-3">
          <button
            type="button"
            onClick={() => logout.mutate()}
            className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-text-2 hover:bg-surface-2 hover:text-text"
          >
            <LogOut className="size-4" aria-hidden />
            Sign out
          </button>
        </div>
      </aside>

      <TopBar summary={summary.data} />

      <main className="mx-auto max-w-7xl px-4 pb-28 pt-6 sm:px-6 lg:pb-12">{children}</main>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(pathname, href) ? "page" : undefined}
            className={cn(
              "flex min-h-14 flex-col items-center justify-center gap-1 text-[11px]",
              isActive(pathname, href) ? "text-accent-text" : "text-muted"
            )}
          >
            <Icon className="size-5" aria-hidden />
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
};

const TopBar = ({ summary }: { summary?: Summary }) => {
  const queryClient = useQueryClient();
  const { connection } = useLive();
  const [confirmEnable, setConfirmEnable] = useState(false);
  const [confirmCloseAll, setConfirmCloseAll] = useState(false);

  const setTrading = useMutation({
    mutationFn: (isEnabled: boolean) => api.put("/settings", { isEnabled }),
    onSuccess: () => {
      setConfirmEnable(false);
      void queryClient.invalidateQueries({ queryKey: ["summary"] });
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    }
  });

  const closeAll = useMutation({
    mutationFn: () => api.post<{ closed: number }>("/positions/close-all", { confirm: true }),
    onSuccess: () => {
      setConfirmCloseAll(false);
      void queryClient.invalidateQueries({ queryKey: ["positions"] });
    }
  });

  const enabled = summary?.trading.enabled ?? false;
  const liveAccounts = summary?.accounts.filter((account) => account.isActive && account.environment === "LIVE") ?? [];
  const activeAccounts = summary?.accounts.filter((account) => account.isActive) ?? [];
  const openCount = (summary?.open.count ?? 0) + (summary?.open.pendingEntries ?? 0);

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-bg/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2.5 lg:hidden">
          <Activity className="size-4 text-accent-text" aria-hidden />
          <span className="text-sm font-semibold">Signal Desk</span>
        </div>

        <div className="flex items-center gap-3">
          <Toggle
            label="Automatic trading"
            tone="gain"
            checked={enabled}
            disabled={!summary || setTrading.isPending}
            onChange={(next) => (next ? setConfirmEnable(true) : setTrading.mutate(false))}
          />
          <span className="text-sm">
            Auto-trading <strong className={enabled ? "text-gain-text" : "text-text-2"}>{enabled ? "on" : "off"}</strong>
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <ConnectionPill connection={connection} />
          {summary && (
            <Badge tone={summary.telegram.running ? "neutral" : "warn"} className="hidden sm:inline-flex">
              Telegram {summary.telegram.running ? "connected" : "offline"}
            </Badge>
          )}
          {summary && summary.realtime.accounts > 0 && (
            <Badge
              tone={summary.realtime.connected === summary.realtime.accounts ? "neutral" : "warn"}
              className="hidden md:inline-flex"
            >
              <span title="Real-time order updates from Binance; positions are also re-checked every few seconds">
                Binance {summary.realtime.connected === summary.realtime.accounts ? "live" : `${summary.realtime.connected}/${summary.realtime.accounts}`}
              </span>
            </Badge>
          )}
          {openCount > 0 && (
            <Button
              size="sm"
              variant="danger"
              icon={<OctagonX className="size-4" aria-hidden />}
              onClick={() => setConfirmCloseAll(true)}
            >
              Close all
            </Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmEnable}
        title="Turn on automatic trading?"
        confirmLabel="Turn on"
        loading={setTrading.isPending}
        onConfirm={() => setTrading.mutate(true)}
        onCancel={() => setConfirmEnable(false)}
      >
        <p>
          New signals from your Telegram sources will place orders on{" "}
          <strong className="text-text">
            {activeAccounts.length} account{activeAccounts.length === 1 ? "" : "s"}
          </strong>
          .
        </p>
        {liveAccounts.length > 0 && (
          <p className="mt-3 rounded-lg border border-loss/40 bg-loss/10 p-3 text-loss-text">
            {liveAccounts.map((account) => account.name).join(", ")} {liveAccounts.length === 1 ? "is a" : "are"} LIVE
            account{liveAccounts.length === 1 ? "" : "s"} — real money.
            {!summary?.trading.liveTradingAllowed && " (Skipped until BINANCE_ALLOW_LIVE=true.)"}
          </p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmCloseAll}
        title="Close every position now?"
        confirmLabel={`Close ${openCount} trade${openCount === 1 ? "" : "s"}`}
        loading={closeAll.isPending}
        onConfirm={() => closeAll.mutate()}
        onCancel={() => setConfirmCloseAll(false)}
      >
        <p>
          Cancels all bot orders and market-closes every open bot position. Auto-trading stays as it is —
          turn it off first if you want to stop new trades too.
        </p>
        {closeAll.error && <p className="mt-3 text-loss-text">{closeAll.error.message}</p>}
      </ConfirmDialog>
    </header>
  );
};

const ConnectionPill = ({ connection }: { connection: "connecting" | "live" | "offline" }) => (
  <span
    className="inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-0.5 text-xs text-text-2"
    title={connection === "live" ? "Receiving live updates" : "Live updates paused; data refreshes when reconnected"}
  >
    <span
      aria-hidden
      className={cn(
        "size-1.5 rounded-full",
        connection === "live" ? "bg-gain-text" : connection === "connecting" ? "animate-pulse bg-warn" : "bg-loss-text"
      )}
    />
    {connection === "live" ? "Live" : connection === "connecting" ? "Connecting" : "Offline"}
  </span>
);
