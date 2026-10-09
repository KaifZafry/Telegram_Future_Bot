import { BinanceAccountModel, type BinanceEnvironment } from "../../models/index.js";
import type { BinanceAccountClientRegistry } from "./binance.accounts.js";
import type { BinanceFuturesClient } from "./binance.client.js";
import { BINANCE_USER_STREAM_URLS } from "./binance.types.js";

/** The subset of the WebSocket API used here, so tests can supply a fake. */
export interface StreamSocket {
  addEventListener(type: "open" | "close" | "error", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  close(): void;
}

export type StreamSocketFactory = (url: string) => StreamSocket;

export interface StreamSyncTarget {
  syncById(executionId: string): Promise<void>;
  syncAccount(binanceAccountId: string): Promise<void>;
}

export interface UserStreamLogger {
  info(data: Record<string, unknown>, message: string): void;
  warn(data: Record<string, unknown>, message: string): void;
  error(data: Record<string, unknown>, message: string): void;
}

export interface UserStreamManagerOptions {
  registry: Pick<BinanceAccountClientRegistry, "get">;
  target: StreamSyncTarget;
  logger: UserStreamLogger;
  socketFactory?: StreamSocketFactory;
  /** How often the set of streamed accounts is refreshed. */
  refreshMs?: number;
}

const KEEPALIVE_MS = 30 * 60 * 1000;
// Binance closes user data connections after 24h; reconnect a little earlier.
const ROTATE_MS = 23 * 60 * 60 * 1000;
const MAX_BACKOFF_MS = 60_000;
const SYNC_DEBOUNCE_MS = 250;
// Every bot order id is `tfb-<executionId>-<role>`, in any event type.
const EXECUTION_ID_PATTERN = /tfb-([0-9a-f]{24})-/g;

const defaultSocketFactory: StreamSocketFactory = (url) => new WebSocket(url);

/** One account's user data stream: listen key upkeep, connection, reconnects. */
class AccountStream {
  public connected = false;
  public lastEventAt?: Date;
  private socket?: StreamSocket;
  private keepAliveTimer?: NodeJS.Timeout;
  private rotateTimer?: NodeJS.Timeout;
  private reconnectTimer?: NodeJS.Timeout;
  private attempts = 0;
  private stopped = false;

  public constructor(
    private readonly accountId: string,
    private readonly environment: BinanceEnvironment,
    private readonly client: BinanceFuturesClient,
    private readonly socketFactory: StreamSocketFactory,
    private readonly onMessage: (accountId: string, raw: string) => void,
    private readonly logger: UserStreamLogger
  ) {}

  public start(): void {
    void this.connect();
  }

  public stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.socket?.close();
    this.connected = false;
  }

  public reconnect(): void {
    this.socket?.close();
  }

  private clearTimers(): void {
    clearInterval(this.keepAliveTimer);
    clearTimeout(this.rotateTimer);
    clearTimeout(this.reconnectTimer);
  }

  private async connect(): Promise<void> {
    if (this.stopped) {
      return;
    }

    this.clearTimers();
    let listenKey: string;

    try {
      listenKey = await this.client.createListenKey();
    } catch (error) {
      this.logger.warn(
        { accountId: this.accountId, error: error instanceof Error ? error.message : String(error) },
        "Could not open Binance user data stream; retrying"
      );
      this.scheduleReconnect();
      return;
    }

    const socket = this.socketFactory(`${BINANCE_USER_STREAM_URLS[this.environment]}/${listenKey}`);
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.connected = true;
      this.attempts = 0;
      this.logger.info({ accountId: this.accountId }, "Binance user data stream connected");
    });

    socket.addEventListener("message", (event) => {
      this.lastEventAt = new Date();
      this.onMessage(this.accountId, String(event.data));
    });

    const onDown = () => {
      if (this.socket !== socket) {
        return;
      }

      this.connected = false;
      this.socket = undefined;
      this.scheduleReconnect();
    };
    socket.addEventListener("close", onDown);
    socket.addEventListener("error", onDown);

    this.keepAliveTimer = setInterval(() => {
      this.client.keepAliveListenKey().catch(() => this.reconnect());
    }, KEEPALIVE_MS);
    this.rotateTimer = setTimeout(() => this.reconnect(), ROTATE_MS);
  }

  private scheduleReconnect(): void {
    if (this.stopped) {
      return;
    }

    clearTimeout(this.reconnectTimer);
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.attempts);
    this.attempts += 1;
    this.reconnectTimer = setTimeout(() => void this.connect(), delay);
  }
}

/**
 * Keeps a Binance user data stream open for every active account and turns
 * order/position events into immediate position syncs. The stream only
 * triggers work: the sync itself still reads Binance state, and the polling
 * loop keeps running, so a missed or malformed event can only delay a sync.
 */
export class UserStreamManager {
  private readonly streams = new Map<string, AccountStream>();
  private readonly pendingSyncs = new Map<string, NodeJS.Timeout>();
  private readonly registry: Pick<BinanceAccountClientRegistry, "get">;
  private readonly target: StreamSyncTarget;
  private readonly logger: UserStreamLogger;
  private readonly socketFactory: StreamSocketFactory;
  private readonly refreshMs: number;
  private refreshTimer?: NodeJS.Timeout;

  public constructor(options: UserStreamManagerOptions) {
    this.registry = options.registry;
    this.target = options.target;
    this.logger = options.logger;
    this.socketFactory = options.socketFactory ?? defaultSocketFactory;
    this.refreshMs = options.refreshMs ?? 60_000;
  }

  public async start(): Promise<void> {
    await this.refresh();
    this.refreshTimer = setInterval(() => void this.refresh(), this.refreshMs);
  }

  public stop(): void {
    clearInterval(this.refreshTimer);
    this.pendingSyncs.forEach((timer) => clearTimeout(timer));
    this.pendingSyncs.clear();
    this.streams.forEach((stream) => stream.stop());
    this.streams.clear();
  }

  public getStatus(): { accounts: number; connected: number; lastEventAt?: string } {
    const streams = [...this.streams.values()];
    const lastEventAt = streams
      .map((stream) => stream.lastEventAt?.getTime() ?? 0)
      .reduce((latest, time) => Math.max(latest, time), 0);

    return {
      accounts: streams.length,
      connected: streams.filter((stream) => stream.connected).length,
      lastEventAt: lastEventAt > 0 ? new Date(lastEventAt).toISOString() : undefined
    };
  }

  /** Starts streams for newly active accounts and stops removed or paused ones. */
  public async refresh(): Promise<void> {
    try {
      const accounts = await BinanceAccountModel.find({ isActive: true })
        .select("_id environment")
        .lean();
      const activeIds = new Set(accounts.map((account) => account._id.toString()));

      for (const [accountId, stream] of this.streams) {
        if (!activeIds.has(accountId)) {
          stream.stop();
          this.streams.delete(accountId);
        }
      }

      for (const account of accounts) {
        const accountId = account._id.toString();

        if (this.streams.has(accountId)) {
          continue;
        }

        try {
          const stream = new AccountStream(
            accountId,
            account.environment,
            await this.registry.get(accountId),
            this.socketFactory,
            (id, raw) => this.handleMessage(id, raw),
            this.logger
          );
          this.streams.set(accountId, stream);
          stream.start();
        } catch (error) {
          this.logger.error({ accountId, error }, "Could not start user data stream for account");
        }
      }
    } catch (error) {
      this.logger.error({ error }, "User data stream refresh failed");
    }
  }

  private handleMessage(accountId: string, raw: string): void {
    const executionIds = new Set([...raw.matchAll(EXECUTION_ID_PATTERN)].map((match) => match[1] as string));
    executionIds.forEach((executionId) => this.scheduleSync(executionId, () => this.target.syncById(executionId)));

    let eventType: unknown;
    try {
      eventType = (JSON.parse(raw) as { e?: unknown }).e;
    } catch {
      return;
    }

    if (eventType === "ACCOUNT_UPDATE") {
      // Position changed (fill, liquidation, manual trade in the app).
      this.scheduleSync(`account:${accountId}`, () => this.target.syncAccount(accountId));
    } else if (eventType === "listenKeyExpired") {
      this.streams.get(accountId)?.reconnect();
    }
  }

  /** Collapses bursts of events (one fill emits several) into one sync. */
  private scheduleSync(key: string, run: () => Promise<void>): void {
    clearTimeout(this.pendingSyncs.get(key));
    this.pendingSyncs.set(
      key,
      setTimeout(() => {
        this.pendingSyncs.delete(key);
        run().catch((error: unknown) => {
          this.logger.error({ key, error }, "Stream-triggered position sync failed");
        });
      }, SYNC_DEBOUNCE_MS)
    );
  }
}
