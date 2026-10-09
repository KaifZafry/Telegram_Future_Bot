"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus, Radio, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { EnvironmentBadge } from "@/components/status";
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  Modal,
  PageHeader,
  Skeleton,
  Toggle,
  cn
} from "@/components/ui";
import { api } from "@/lib/api";
import { formatUsd } from "@/lib/format";
import type { Account, Environment, Settings, Source, Summary, TelegramChat } from "@/lib/types";

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="How the bot sizes and manages trades, and where it listens and trades" />
      <div className="space-y-6">
        <TradeSettingsCard />
        <AutomationCard />
        <SourcesCard />
        <AccountsCard />
      </div>
    </>
  );
}

// ---------------------------------------------------------------- settings

type SettingsForm = Record<
  | "defaultMargin"
  | "defaultLeverage"
  | "maxLeverage"
  | "entryOrderCount"
  | "entryTimeoutMinutes"
  | "maxOpenTrades"
  | "maxDailyLoss",
  string
> & { moveStopToBreakeven: boolean; blockedSymbols: string; allowedSymbols: string };

const toForm = (settings: Settings): SettingsForm => ({
  defaultMargin: String(settings.defaultMargin),
  defaultLeverage: String(settings.defaultLeverage),
  maxLeverage: String(settings.maxLeverage),
  entryOrderCount: String(settings.entryOrderCount),
  entryTimeoutMinutes: String(settings.entryTimeoutMinutes),
  maxOpenTrades: String(settings.maxOpenTrades),
  maxDailyLoss: String(settings.maxDailyLoss),
  moveStopToBreakeven: settings.moveStopToBreakeven,
  blockedSymbols: settings.blockedSymbols.join(", "),
  allowedSymbols: settings.allowedSymbols.join(", ")
});

const symbolsOf = (value: string) =>
  value
    .split(/[\s,]+/)
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);

const validate = (form: SettingsForm): Partial<Record<keyof SettingsForm, string>> => {
  const errors: Partial<Record<keyof SettingsForm, string>> = {};
  const number = (key: keyof SettingsForm) => Number(form[key]);

  if (!(number("defaultMargin") > 0)) errors.defaultMargin = "Must be more than 0";
  if (!Number.isInteger(number("maxLeverage")) || number("maxLeverage") < 1 || number("maxLeverage") > 125)
    errors.maxLeverage = "Whole number from 1 to 125";
  if (!Number.isInteger(number("defaultLeverage")) || number("defaultLeverage") < 1)
    errors.defaultLeverage = "Whole number, at least 1";
  else if (number("defaultLeverage") > number("maxLeverage"))
    errors.defaultLeverage = "Cannot be above max leverage";
  if (!Number.isInteger(number("entryOrderCount")) || number("entryOrderCount") < 1 || number("entryOrderCount") > 10)
    errors.entryOrderCount = "Whole number from 1 to 10";
  if (!Number.isInteger(number("entryTimeoutMinutes")) || number("entryTimeoutMinutes") < 1)
    errors.entryTimeoutMinutes = "Whole number of minutes";
  if (!Number.isInteger(number("maxOpenTrades")) || number("maxOpenTrades") < 1)
    errors.maxOpenTrades = "At least 1";
  if (!(number("maxDailyLoss") >= 0)) errors.maxDailyLoss = "0 or more";

  for (const key of ["blockedSymbols", "allowedSymbols"] as const) {
    const invalid = symbolsOf(form[key]).find((symbol) => !/^[A-Z0-9]{2,15}USDT$/.test(symbol));
    if (invalid) errors[key] = `"${invalid}" is not a USDT pair like BTCUSDT`;
  }

  return errors;
};

const TradeSettingsCard = () => {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.get<Settings>("/settings") });
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (settings.data && !form) setForm(toForm(settings.data));
  }, [settings.data, form]);

  const save = useMutation({
    mutationFn: (values: SettingsForm) =>
      api.put<Settings>("/settings", {
        defaultMargin: Number(values.defaultMargin),
        defaultLeverage: Number(values.defaultLeverage),
        maxLeverage: Number(values.maxLeverage),
        entryOrderCount: Number(values.entryOrderCount),
        entryTimeoutMinutes: Number(values.entryTimeoutMinutes),
        maxOpenTrades: Number(values.maxOpenTrades),
        maxDailyLoss: Number(values.maxDailyLoss),
        moveStopToBreakeven: values.moveStopToBreakeven,
        blockedSymbols: symbolsOf(values.blockedSymbols),
        allowedSymbols: symbolsOf(values.allowedSymbols)
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(["settings"], saved);
      setForm(toForm(saved));
      setSubmitted(false);
      void queryClient.invalidateQueries({ queryKey: ["summary"] });
    }
  });

  if (settings.isPending || !form) {
    return settings.error ? (
      <Card title="Trading">
        <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
      </Card>
    ) : (
      <Skeleton className="h-96 rounded-xl" />
    );
  }

  const errors = submitted ? validate(form) : {};
  const dirty = settings.data ? JSON.stringify(toForm(settings.data)) !== JSON.stringify(form) : false;
  const set = (key: keyof SettingsForm) => (event: { target: { value: string } }) =>
    setForm({ ...form, [key]: event.target.value });
  const margin = Number(form.defaultMargin) || 0;
  const leverage = Math.min(Number(form.defaultLeverage) || 0, Number(form.maxLeverage) || 0);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (Object.keys(validate(form)).length === 0) save.mutate(form);
  };

  return (
    <Card title="Trading" description="Applies to the next signal; open trades keep their original plan">
      <form onSubmit={submit} noValidate className="space-y-6">
        <div className="rounded-lg border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-text-2">
          Each trade uses <strong className="num text-text">{formatUsd(margin)} USDT</strong> margin. At{" "}
          <span className="num">{leverage}x</span> that is a{" "}
          <strong className="num text-text">{formatUsd(margin * leverage)} USDT</strong> position. Signals that name a
          leverage use it, capped at {form.maxLeverage}x.
        </div>

        <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <legend className="sr-only">Position size</legend>
          <Field label="Margin per trade" type="number" inputMode="decimal" min="0" step="any" suffix="USDT"
            value={form.defaultMargin} onChange={set("defaultMargin")} error={errors.defaultMargin}
            help="Same amount on every account" />
          <Field label="Default leverage" type="number" inputMode="numeric" min="1" suffix="x"
            value={form.defaultLeverage} onChange={set("defaultLeverage")} error={errors.defaultLeverage}
            help="When the signal gives none" />
          <Field label="Max leverage" type="number" inputMode="numeric" min="1" max="125" suffix="x"
            value={form.maxLeverage} onChange={set("maxLeverage")} error={errors.maxLeverage}
            help="Caps the signal's leverage" />
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <legend className="sr-only">Entries and risk</legend>
          <Field label="Entry orders per range" type="number" inputMode="numeric" min="1" max="10"
            value={form.entryOrderCount} onChange={set("entryOrderCount")} error={errors.entryOrderCount}
            help="Limit orders spread across the entry zone" />
          <Field label="Cancel unfilled entries after" type="number" inputMode="numeric" min="1" suffix="min"
            value={form.entryTimeoutMinutes} onChange={set("entryTimeoutMinutes")} error={errors.entryTimeoutMinutes}
            help="1440 = one day" />
          <Field label="Max open trades per account" type="number" inputMode="numeric" min="1"
            value={form.maxOpenTrades} onChange={set("maxOpenTrades")} error={errors.maxOpenTrades} />
          <Field label="Daily loss limit" type="number" inputMode="decimal" min="0" step="any" suffix="USDT"
            value={form.maxDailyLoss} onChange={set("maxDailyLoss")} error={errors.maxDailyLoss}
            help="Stops new trades for the UTC day. 0 = no limit" />
          <Field label="Never trade" placeholder="e.g. DOGEUSDT, PEPEUSDT" className="sm:col-span-2 lg:col-span-1"
            value={form.blockedSymbols} onChange={set("blockedSymbols")} error={errors.blockedSymbols} />
          <Field label="Only trade (optional)" placeholder="Empty = all pairs" className="sm:col-span-2 lg:col-span-1"
            value={form.allowedSymbols} onChange={set("allowedSymbols")} error={errors.allowedSymbols} />
        </fieldset>

        <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
          <div>
            <p className="text-sm font-medium">Move stop loss to entry after TP1</p>
            <p className="text-xs text-muted">Also cancels entries that have not filled yet, so the trade can no longer lose.</p>
          </div>
          <Toggle
            label="Move stop loss to entry after TP1"
            checked={form.moveStopToBreakeven}
            onChange={(checked) => setForm({ ...form, moveStopToBreakeven: checked })}
          />
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" loading={save.isPending} disabled={!dirty}>
            Save settings
          </Button>
          {dirty && (
            <Button variant="ghost" onClick={() => settings.data && setForm(toForm(settings.data))}>
              Discard changes
            </Button>
          )}
          {save.isSuccess && !dirty && <span className="text-sm text-gain-text" role="status">Saved</span>}
          {save.error && <span className="text-sm text-loss-text" role="alert">{save.error.message}</span>}
        </div>
      </form>
    </Card>
  );
};

// ---------------------------------------------------------------- automation

const AutomationCard = () => {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.get<Settings>("/settings") });
  const summary = useQuery({ queryKey: ["summary"], queryFn: () => api.get<Summary>("/dashboard/summary") });
  const [timeout, setTimeoutValue] = useState("");
  const save = useMutation({
    mutationFn: (changes: Partial<Settings>) => api.put<Settings>("/settings", changes),
    onSuccess: (saved) => queryClient.setQueryData(["settings"], saved)
  });

  useEffect(() => {
    if (settings.data) setTimeoutValue(String(settings.data.approvalTimeoutSeconds));
  }, [settings.data]);

  if (!settings.data) {
    return settings.error ? null : <Skeleton className="h-48 rounded-xl" />;
  }

  const controlBot = summary.data?.controlBot;
  const timeoutNumber = Number(timeout);
  const timeoutError =
    !Number.isInteger(timeoutNumber) || timeoutNumber < 10 || timeoutNumber > 600 ? "Between 10 and 600 seconds" : undefined;

  return (
    <Card title="Automation" description="How much the bot does on its own">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
          <div>
            <p className="text-sm font-medium">Ask me on Telegram before each trade</p>
            <p className="text-xs text-muted">
              Your control bot sends the exact orders with Approve / Reject buttons. No answer means no trade.
            </p>
            {!controlBot?.running && (
              <p className="mt-1.5 text-xs text-warn">
                Control bot is not connected — set TELEGRAM_CONTROL_BOT_TOKEN and TELEGRAM_CONTROL_CHAT_ID. While
                it is offline, signals are rejected when this is on.
              </p>
            )}
            {settings.data.requireApproval && (
              <Field
                label="Reject automatically after"
                type="number"
                inputMode="numeric"
                min="10"
                max="600"
                suffix="sec"
                className="mt-3 max-w-48"
                value={timeout}
                error={timeoutError}
                onChange={(event) => setTimeoutValue(event.target.value)}
                onBlur={() => {
                  if (!timeoutError && timeoutNumber !== settings.data.approvalTimeoutSeconds) {
                    save.mutate({ approvalTimeoutSeconds: timeoutNumber });
                  }
                }}
              />
            )}
          </div>
          <Toggle
            label="Ask me on Telegram before each trade"
            checked={settings.data.requireApproval}
            disabled={save.isPending}
            onChange={(requireApproval) => save.mutate({ requireApproval })}
          />
        </div>

        <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
          <div>
            <p className="text-sm font-medium">Follow the group&apos;s follow-up messages</p>
            <p className="text-xs text-muted">
              Acts on &ldquo;close RLC&rdquo;, &ldquo;move SL to entry&rdquo;, &ldquo;cancel&rdquo; and tighter new stops,
              only for trades from the same group that the message names or replies to. A stop is never moved further away.
            </p>
          </div>
          <Toggle
            label="Follow the group's follow-up messages"
            checked={settings.data.followUpActions}
            disabled={save.isPending}
            onChange={(followUpActions) => save.mutate({ followUpActions })}
          />
        </div>

        {save.error && <p role="alert" className="text-sm text-loss-text">{save.error.message}</p>}
      </div>
    </Card>
  );
};

// ---------------------------------------------------------------- sources

const SourcesCard = () => {
  const queryClient = useQueryClient();
  const sources = useQuery({ queryKey: ["sources"], queryFn: () => api.get<Source[]>("/sources") });
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Source | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["sources"] });

  const toggle = useMutation({
    mutationFn: (source: Source) => api.patch(`/sources/${source._id}`, { isActive: !source.isActive }),
    onSuccess: refresh
  });
  const remove = useMutation({
    mutationFn: (source: Source) => api.delete(`/sources/${source._id}`),
    onSuccess: () => {
      setRemoving(null);
      refresh();
    }
  });

  return (
    <Card
      title="Telegram sources"
      description="Groups and channels the bot reads signals from"
      action={<Button size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => setAdding(true)}>Add</Button>}
      bodyClassName="p-0"
    >
      {sources.isPending ? (
        <div className="p-5"><Skeleton className="h-12" /></div>
      ) : sources.error ? (
        <ErrorState error={sources.error} onRetry={() => void sources.refetch()} />
      ) : sources.data.length === 0 ? (
        <EmptyState icon={<Radio className="size-5" />} title="No sources yet"
          action={<Button size="sm" variant="primary" onClick={() => setAdding(true)}>Add your signal group</Button>}>
          Add the group that posts your signals so the bot starts listening to it.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-border">
          {sources.data.map((source) => (
            <li key={source._id} className="flex items-center gap-4 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <p className={cn("text-sm font-medium", !source.isActive && "text-muted")}>{source.name}</p>
                <p className="num text-xs text-muted">{source.chatId}</p>
              </div>
              <span className="text-xs text-muted">{source.isActive ? "Listening" : "Paused"}</span>
              <Toggle label={`Listen to ${source.name}`} checked={source.isActive}
                disabled={toggle.isPending} onChange={() => toggle.mutate(source)} />
              <button type="button" onClick={() => setRemoving(source)} aria-label={`Remove ${source.name}`}
                className="cursor-pointer rounded-md p-2 text-muted hover:bg-surface-2 hover:text-loss-text">
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <AddSourceModal open={adding} onClose={() => setAdding(false)} onAdded={refresh} />
      <ConfirmDialog open={Boolean(removing)} title={`Remove ${removing?.name ?? "source"}?`} confirmLabel="Remove"
        loading={remove.isPending} onConfirm={() => removing && remove.mutate(removing)} onCancel={() => setRemoving(null)}>
        The bot stops reading this chat. Past signals stay in your history.
      </ConfirmDialog>
    </Card>
  );
};

const AddSourceModal = ({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) => {
  const [name, setName] = useState("");
  const [chatId, setChatId] = useState("");
  const [filter, setFilter] = useState("");
  const chats = useQuery({ queryKey: ["chats"], queryFn: () => api.get<TelegramChat[]>("/telegram/chats"), enabled: open });
  const create = useMutation({
    mutationFn: () => api.post("/sources", { name: name.trim(), chatId: chatId.trim() }),
    onSuccess: () => {
      onAdded();
      setName("");
      setChatId("");
      onClose();
    }
  });
  const visibleChats = (chats.data ?? []).filter((chat) => chat.title.toLowerCase().includes(filter.toLowerCase()));

  return (
    <Modal open={open} onClose={onClose} title="Add Telegram source">
      <div className="space-y-4">
        {chats.data && chats.data.length > 0 ? (
          <div>
            <Field label="Pick from your chats" placeholder="Search groups and channels" value={filter}
              onChange={(event) => setFilter(event.target.value)} />
            <ul className="mt-2 max-h-48 divide-y divide-border overflow-y-auto rounded-lg border border-border" role="listbox" aria-label="Your chats">
              {visibleChats.slice(0, 50).map((chat) => (
                <li key={chat.chatId} role="option" aria-selected={chatId === chat.chatId}>
                  <button type="button" onClick={() => { setChatId(chat.chatId); setName(chat.title); }}
                    className={cn("flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface-2",
                      chatId === chat.chatId && "bg-accent/10")}>
                    <span className="truncate">{chat.title}</span>
                    <span className="shrink-0 text-xs text-muted">{chat.type === "CHANNEL" ? "Channel" : "Group"}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-xs text-muted">
            {chats.isPending ? "Loading your chats…" : "Telegram is not connected, so enter the chat ID by hand. Find it with npm run telegram:chats."}
          </p>
        )}
        <Field label="Name" value={name} onChange={(event) => setName(event.target.value)} placeholder="VIP signals" />
        <Field label="Chat ID" value={chatId} onChange={(event) => setChatId(event.target.value)} placeholder="-1001234567890"
          help="Groups and channels start with -100" />
        {create.error && <p role="alert" className="text-sm text-loss-text">{create.error.message}</p>}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={create.isPending} disabled={!name.trim() || !chatId.trim()} onClick={() => create.mutate()}>
            Add source
          </Button>
        </div>
      </div>
    </Modal>
  );
};

// ---------------------------------------------------------------- accounts

const AccountsCard = () => {
  const queryClient = useQueryClient();
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: () => api.get<Account[]>("/accounts") });
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Account | null>(null);
  const [balances, setBalances] = useState<Record<string, string>>({});
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["accounts"] });
    void queryClient.invalidateQueries({ queryKey: ["summary"] });
  };

  const toggle = useMutation({
    mutationFn: (account: Account) => api.patch(`/accounts/${account._id}`, { isActive: !account.isActive }),
    onSuccess: refresh
  });
  const remove = useMutation({
    mutationFn: (account: Account) => api.delete(`/accounts/${account._id}`),
    onSuccess: () => {
      setRemoving(null);
      refresh();
    }
  });
  const checkBalance = useMutation({
    mutationFn: (account: Account) => api.get<{ availableBalance: number }>(`/accounts/${account._id}/balance`),
    onSuccess: (result, account) =>
      setBalances((current) => ({ ...current, [account._id]: `${formatUsd(result.availableBalance)} USDT available` })),
    onError: (error, account) => setBalances((current) => ({ ...current, [account._id]: error.message }))
  });

  return (
    <Card
      title={<span id="accounts">Binance accounts</span>}
      description="Every active account trades every signal. API keys are stored encrypted."
      action={<Button size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => setAdding(true)}>Add</Button>}
      bodyClassName="p-0"
    >
      {accounts.isPending ? (
        <div className="p-5"><Skeleton className="h-12" /></div>
      ) : accounts.error ? (
        <ErrorState error={accounts.error} onRetry={() => void accounts.refetch()} />
      ) : accounts.data.length === 0 ? (
        <EmptyState icon={<KeyRound className="size-5" />} title="No Binance account yet"
          action={<Button size="sm" variant="primary" onClick={() => setAdding(true)}>Add a testnet account</Button>}>
          Start with a testnet account to watch the bot trade without real money.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-border">
          {accounts.data.map((account) => (
            <li key={account._id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <p className={cn("flex items-center gap-2 text-sm font-medium", !account.isActive && "text-muted")}>
                  {account.name} <EnvironmentBadge environment={account.environment} />
                </p>
                <p className="num text-xs text-muted" role="status">{balances[account._id] ?? " "}</p>
              </div>
              <Button size="sm" variant="ghost" loading={checkBalance.isPending && checkBalance.variables?._id === account._id}
                onClick={() => checkBalance.mutate(account)}>
                Check balance
              </Button>
              <span className="text-xs text-muted">{account.isActive ? "Trading" : "Paused"}</span>
              <Toggle label={`Trade on ${account.name}`} checked={account.isActive}
                disabled={toggle.isPending} onChange={() => toggle.mutate(account)} />
              <button type="button" onClick={() => setRemoving(account)} aria-label={`Remove ${account.name}`}
                className="cursor-pointer rounded-md p-2 text-muted hover:bg-surface-2 hover:text-loss-text">
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <AddAccountModal open={adding} onClose={() => setAdding(false)} onAdded={refresh} />
      <ConfirmDialog open={Boolean(removing)} title={`Remove ${removing?.name ?? "account"}?`} confirmLabel="Remove account"
        loading={remove.isPending} onConfirm={() => removing && remove.mutate(removing)}
        onCancel={() => { setRemoving(null); remove.reset(); }}>
        <p>Deletes the stored API keys. Trade history stays.</p>
        {remove.error && <p className="mt-3 text-loss-text">{remove.error.message}</p>}
      </ConfirmDialog>
    </Card>
  );
};

const AddAccountModal = ({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) => {
  const [name, setName] = useState("Testnet");
  const [environment, setEnvironment] = useState<Environment>("TESTNET");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const create = useMutation({
    mutationFn: () =>
      api.post<{ availableBalance: number; hedgeMode: boolean }>("/accounts", { name: name.trim(), environment, apiKey, apiSecret })
  });

  const close = () => {
    setApiKey("");
    setApiSecret("");
    create.reset();
    onClose();
  };

  return (
    <Modal open={open} onClose={close} title="Add Binance account">
      {create.data ? (
        <div className="space-y-4 text-sm">
          <p className="text-gain-text">Connected. {formatUsd(create.data.availableBalance)} USDT available.</p>
          {create.data.hedgeMode && (
            <p className="rounded-lg border border-warn/30 bg-warn/10 p-3 text-warn">
              This account is in Hedge Mode. Switch Binance Futures to One-way Mode, or the bot will skip it.
            </p>
          )}
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => { onAdded(); close(); }}>Done</Button>
          </div>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
          <div role="radiogroup" aria-label="Environment" className="grid grid-cols-2 gap-2">
            {(["TESTNET", "LIVE"] as const).map((option) => (
              <button key={option} type="button" role="radio" aria-checked={environment === option}
                onClick={() => { setEnvironment(option); if (name === "Testnet" || name === "Main") setName(option === "LIVE" ? "Main" : "Testnet"); }}
                className={cn("cursor-pointer rounded-lg border px-3 py-2.5 text-left text-sm",
                  environment === option ? (option === "LIVE" ? "border-loss bg-loss/10" : "border-accent bg-accent/10") : "border-border-strong hover:bg-surface-2")}>
                <span className="block font-medium">{option === "LIVE" ? "Live" : "Testnet"}</span>
                <span className="text-xs text-muted">{option === "LIVE" ? "Real money" : "demo.binance.com keys"}</span>
              </button>
            ))}
          </div>
          {environment === "LIVE" && (
            <p className="rounded-lg border border-loss/40 bg-loss/10 p-3 text-xs text-loss-text">
              Use a key with Futures enabled, withdrawals disabled and an IP whitelist. Live accounts only trade when the
              server has BINANCE_ALLOW_LIVE=true.
            </p>
          )}
          <Field label="Account name" value={name} onChange={(event) => setName(event.target.value)} required />
          <Field label="API key" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" spellCheck={false} required />
          <Field label="API secret" type="password" value={apiSecret} onChange={(event) => setApiSecret(event.target.value)}
            autoComplete="new-password" required help="Checked against Binance, then stored encrypted. It is never shown again." />
          {create.error && <p role="alert" className="text-sm text-loss-text">{create.error.message}</p>}
          <div className="flex justify-end gap-2">
            <Button onClick={close}>Cancel</Button>
            <Button type="submit" variant="primary" loading={create.isPending} disabled={!name.trim() || !apiKey || !apiSecret}>
              Verify and save
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
};
