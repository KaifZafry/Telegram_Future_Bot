import { GramJsUserTelegramClient, GrammyTelegramClient } from "./telegram.client.js";
import { getTelegramConfig } from "./telegram.config.js";
import {
  createTelegramUpdateHandler,
  type SignalStoredHandler
} from "./telegram.handlers.js";
import {
  createTelegramService
} from "./telegram.service.js";
import type {
  TelegramChatInfo,
  TelegramClient,
  TelegramClientFactory,
  TelegramConfig,
  TelegramLogger,
  TelegramRuntimeStatus,
  TelegramUpdateIngestionService
} from "./telegram.types.js";

export interface TelegramModuleOptions {
  config?: TelegramConfig;
  clientFactory?: TelegramClientFactory;
  service?: TelegramUpdateIngestionService;
  onSignalStored?: SignalStoredHandler;
  logger: TelegramLogger;
}

const defaultClientFactory: TelegramClientFactory = (config) =>
  config.mode === "bot"
    ? new GrammyTelegramClient(config.botToken as string)
    : new GramJsUserTelegramClient(
        config.apiId as number,
        config.apiHash as string,
        config.session as string
      );

/** Returns the names of settings the configured mode still needs. */
const getMissingSettings = (config: TelegramConfig): string[] => {
  if (config.mode === "bot") {
    return config.botToken ? [] : ["TELEGRAM_BOT_TOKEN"];
  }

  return [
    ...(config.apiId ? [] : ["TELEGRAM_API_ID"]),
    ...(config.apiHash ? [] : ["TELEGRAM_API_HASH"]),
    ...(config.session ? [] : ["TELEGRAM_SESSION"])
  ];
};

export class TelegramModule {
  private readonly config: TelegramConfig;
  private readonly clientFactory: TelegramClientFactory;
  private readonly service: TelegramUpdateIngestionService;
  private readonly onSignalStored?: SignalStoredHandler;
  private readonly logger: TelegramLogger;
  private client?: TelegramClient;
  private running = false;

  public constructor(options: TelegramModuleOptions) {
    this.config = options.config ?? getTelegramConfig();
    this.clientFactory = options.clientFactory ?? defaultClientFactory;
    this.logger = options.logger;
    this.service = options.service ?? createTelegramService(this.logger);
    this.onSignalStored = options.onSignalStored;
  }

  public async initialize(): Promise<void> {
    const missingSettings = getMissingSettings(this.config);

    if (missingSettings.length > 0) {
      this.logger.warn(
        {
          mode: this.config.mode,
          missingSettings
        },
        "Telegram is not configured; listener disabled"
      );
      return;
    }

    this.client = this.clientFactory(this.config);
    await this.client.start(
      createTelegramUpdateHandler(this.service, this.logger, this.onSignalStored)
    );
    this.running = true;

    this.logger.info(
      {
        mode: this.config.mode
      },
      "Telegram listener started"
    );
  }

  public async shutdown(): Promise<void> {
    if (!this.client || !this.running) {
      return;
    }

    await this.client.stop();
    this.running = false;
    this.logger.info(
      {
        mode: this.config.mode
      },
      "Telegram listener stopped"
    );
  }

  public async listChats(): Promise<TelegramChatInfo[]> {
    if (!this.client?.listChats || !this.running) {
      return [];
    }

    return this.client.listChats();
  }

  public getStatus(): TelegramRuntimeStatus {
    return {
      enabled: getMissingSettings(this.config).length === 0,
      running: this.running,
      mode: this.config.mode
    };
  }
}

export const createTelegramModule = (
  options: TelegramModuleOptions
): TelegramModule => new TelegramModule(options);
