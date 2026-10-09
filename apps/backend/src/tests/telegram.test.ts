import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Types } from "mongoose";

import {
  createTelegramModule,
  TelegramService,
  type RawSignalInput,
  type SignalRepository,
  type TelegramClient,
  type TelegramLogger,
  type TelegramSourceRecord,
  type TelegramSourceRepository,
  type TelegramUpdate
} from "../modules/telegram/index.js";

class MemoryLogger implements TelegramLogger {
  public readonly entries: Array<{
    level: "info" | "warn" | "error";
    data: Record<string, unknown>;
    message: string;
  }> = [];

  public info(data: Record<string, unknown>, message: string): void {
    this.entries.push({ level: "info", data, message });
  }

  public warn(data: Record<string, unknown>, message: string): void {
    this.entries.push({ level: "warn", data, message });
  }

  public error(data: Record<string, unknown>, message: string): void {
    this.entries.push({ level: "error", data, message });
  }
}

class MemoryTelegramSourceRepository implements TelegramSourceRepository {
  private readonly sources = new Map<string, TelegramSourceRecord>();

  public add(source: TelegramSourceRecord): void {
    this.sources.set(source.chatId, source);
  }

  public findActiveByChatId(
    chatId: string
  ): Promise<TelegramSourceRecord | null> {
    const source = this.sources.get(chatId);
    return Promise.resolve(source?.isActive ? source : null);
  }
}

class MemorySignalRepository implements SignalRepository {
  public readonly signals: RawSignalInput[] = [];
  private readonly uniqueKeys = new Set<string>();

  public createRawSignal(input: RawSignalInput): Promise<{ id: string }> {
    const uniqueKey = `${input.telegramSourceId.toString()}:${input.telegramMessageId}`;

    if (this.uniqueKeys.has(uniqueKey)) {
      const duplicateError = new Error("Duplicate key") as Error & { code: number };
      duplicateError.code = 11000;
      return Promise.reject(duplicateError);
    }

    this.uniqueKeys.add(uniqueKey);
    this.signals.push(input);

    return Promise.resolve({
      id: `signal-${this.signals.length}`
    });
  }

  public findByMessage(
    telegramSourceId: Types.ObjectId,
    telegramMessageId: string
  ): Promise<{ id: string; rawText: string } | null> {
    const index = this.signals.findIndex(
      (signal) =>
        signal.telegramSourceId.equals(telegramSourceId) &&
        signal.telegramMessageId === telegramMessageId
    );
    const signal = this.signals[index];
    return Promise.resolve(signal ? { id: `signal-${index + 1}`, rawText: signal.rawText } : null);
  }

  public updateEditedText(id: string, rawText: string): Promise<void> {
    const signal = this.signals[Number(id.replace("signal-", "")) - 1];
    if (signal) signal.rawText = rawText;
    return Promise.resolve();
  }
}

class MemoryTelegramClient implements TelegramClient {
  public started = false;
  public stopped = false;

  public start(_onUpdate: (update: TelegramUpdate) => Promise<void>): Promise<void> {
    this.started = true;
    return Promise.resolve();
  }

  public stop(): Promise<void> {
    this.stopped = true;
    return Promise.resolve();
  }
}

const createSource = (overrides: Partial<TelegramSourceRecord> = {}): TelegramSourceRecord => ({
  _id: new Types.ObjectId(),
  userId: new Types.ObjectId(),
  name: "Signals Channel",
  chatId: "-100123",
  isActive: true,
  ...overrides
});

const createTextUpdate = (
  overrides: Partial<TelegramUpdate["message"]> = {}
): TelegramUpdate => ({
  update_id: 1,
  message: {
    message_id: 42,
    date: 1_725_000_000,
    chat: {
      id: "-100123",
      type: "channel"
    },
    from: {
      id: 99,
      is_bot: false,
      first_name: "Signal",
      username: "signal_sender"
    },
    text: "BTCUSDT LONG entry 65000",
    ...overrides
  }
});

const createService = (
  sourceRepository: MemoryTelegramSourceRepository,
  signalRepository: MemorySignalRepository,
  logger = new MemoryLogger()
): TelegramService =>
  new TelegramService({
    sourceRepository,
    signalRepository,
    logger
  });

void describe("Phase 3 Telegram ingestion", () => {
  void it("creates a Signal from a valid Telegram text message", async () => {
    const sources = new MemoryTelegramSourceRepository();
    const signals = new MemorySignalRepository();
    const source = createSource();
    sources.add(source);

    const result = await createService(sources, signals).ingestUpdate(createTextUpdate());

    assert.equal(result.status, "stored");
    assert.equal(signals.signals.length, 1);
    assert.equal(signals.signals[0]?.rawText, "BTCUSDT LONG entry 65000");
    assert.equal(signals.signals[0]?.telegramMessageId, "42");
    assert.equal(signals.signals[0]?.telegramSourceId.toString(), source._id.toString());
    assert.equal(signals.signals[0]?.userId.toString(), source.userId.toString());
    assert.equal(signals.signals[0]?.telegramSender?.username, "signal_sender");
  });

  void it("creates a Signal from a valid Telegram media caption", async () => {
    const sources = new MemoryTelegramSourceRepository();
    const signals = new MemorySignalRepository();
    sources.add(createSource());

    const result = await createService(sources, signals).ingestUpdate(
      createTextUpdate({
        text: undefined,
        caption: "ETHUSDT SHORT entry 3000"
      })
    );

    assert.equal(result.status, "stored");
    assert.equal(signals.signals.length, 1);
    assert.equal(signals.signals[0]?.rawText, "ETHUSDT SHORT entry 3000");
  });

  void it("ignores a message from an unknown Telegram source", async () => {
    const signals = new MemorySignalRepository();

    const result = await createService(
      new MemoryTelegramSourceRepository(),
      signals
    ).ingestUpdate(createTextUpdate());

    assert.equal(result.status, "ignored");
    assert.equal(result.reason, "source_not_configured");
    assert.equal(signals.signals.length, 0);
  });

  void it("ignores a message from an inactive Telegram source", async () => {
    const sources = new MemoryTelegramSourceRepository();
    const signals = new MemorySignalRepository();
    sources.add(createSource({ isActive: false }));

    const result = await createService(sources, signals).ingestUpdate(createTextUpdate());

    assert.equal(result.status, "ignored");
    assert.equal(result.reason, "source_not_configured");
    assert.equal(signals.signals.length, 0);
  });

  void it("treats duplicate telegramSourceId and telegramMessageId as idempotent", async () => {
    const sources = new MemoryTelegramSourceRepository();
    const signals = new MemorySignalRepository();
    sources.add(createSource());
    const service = createService(sources, signals);

    const firstResult = await service.ingestUpdate(createTextUpdate());
    const secondResult = await service.ingestUpdate(createTextUpdate());

    assert.equal(firstResult.status, "stored");
    assert.equal(secondResult.status, "duplicate");
    assert.equal(signals.signals.length, 1);
  });

  void it("records which message a reply answers", async () => {
    const sources = new MemoryTelegramSourceRepository();
    const signals = new MemorySignalRepository();
    sources.add(createSource());

    await createService(sources, signals).ingestUpdate(
      createTextUpdate({ text: "Move SL to entry", reply_to_message: { message_id: 7 } })
    );

    assert.equal(signals.signals[0]?.replyToMessageId, "7");
  });

  void it("updates the stored text when a message is edited", async () => {
    const sources = new MemoryTelegramSourceRepository();
    const signals = new MemorySignalRepository();
    sources.add(createSource());
    const service = createService(sources, signals);
    const original = createTextUpdate();

    await service.ingestUpdate(original);
    const edit = await service.ingestUpdate({
      update_id: 2,
      edited_message: { ...original.message!, text: "BTCUSDT LONG entry 64000", edit_date: 1_725_000_100 }
    });
    const sameText = await service.ingestUpdate({
      update_id: 3,
      edited_message: { ...original.message!, text: "BTCUSDT LONG entry 64000", edit_date: 1_725_000_200 }
    });

    assert.equal(edit.status, "edited");
    assert.equal(edit.previousText, "BTCUSDT LONG entry 65000");
    assert.equal(signals.signals.length, 1);
    assert.equal(signals.signals[0]?.rawText, "BTCUSDT LONG entry 64000");
    assert.equal(sameText.status, "ignored");
  });

  void it("ignores messages without text or caption", async () => {
    const sources = new MemoryTelegramSourceRepository();
    const signals = new MemorySignalRepository();
    sources.add(createSource());

    const result = await createService(sources, signals).ingestUpdate(
      createTextUpdate({
        text: undefined,
        caption: undefined
      })
    );

    assert.equal(result.status, "ignored");
    assert.equal(result.reason, "unsupported_update");
    assert.equal(signals.signals.length, 0);
  });

  void it("does not crash development startup when the Telegram token is missing", async () => {
    const logger = new MemoryLogger();
    let clientFactoryCalled = false;
    const module = createTelegramModule({
      config: {
        botToken: undefined,
        webhookSecret: undefined,
        mode: "bot"
      },
      logger,
      service: {
        ingestUpdate(): Promise<never> {
          return Promise.reject(
            new Error("Listener should not start without a token")
          );
        }
      },
      clientFactory: () => {
        clientFactoryCalled = true;
        return new MemoryTelegramClient();
      }
    });

    await module.initialize();

    assert.equal(clientFactoryCalled, false);
    assert.deepEqual(module.getStatus(), {
      enabled: false,
      running: false,
      mode: "bot"
    });
    assert.equal(logger.entries[0]?.level, "warn");
  });

  void it("never includes the Telegram token in logs", async () => {
    const logger = new MemoryLogger();
    const token = "super-secret-telegram-token";
    const client = new MemoryTelegramClient();
    const module = createTelegramModule({
      config: {
        botToken: token,
        webhookSecret: "webhook-secret",
        mode: "bot"
      },
      logger,
      service: {
        ingestUpdate() {
          return Promise.resolve({
            status: "ignored" as const,
            reason: "test"
          });
        }
      },
      clientFactory: () => client
    });

    await module.initialize();

    assert.equal(client.started, true);
    assert.equal(JSON.stringify(logger.entries).includes(token), false);
  });
});
