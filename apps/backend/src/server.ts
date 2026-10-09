import type { Server } from "node:http";

import { app } from "./app.js";
import { env } from "./config/env.js";
import { disconnectMongo, initializeDatabase } from "./config/mongodb.js";
import {
  BinanceAccountClientRegistry,
  PositionManager,
  UserStreamManager
} from "./modules/binance/index.js";
import { createControlBot, type ControlBot } from "./modules/control-bot/index.js";
import { createTelegramModule, type TelegramModule } from "./modules/telegram/index.js";
import { FollowUpHandler, SignalPipeline } from "./modules/trading/index.js";
import { setTelegramStatusProvider } from "./services/healthService.js";
import { runtime } from "./services/runtime.js";
import { logger } from "./utils/logger.js";

let server: Server | undefined;
let telegramModule: TelegramModule | undefined;
let positionManager: PositionManager | undefined;
let userStreams: UserStreamManager | undefined;
let controlBot: ControlBot | undefined;
let isShuttingDown = false;

const shutdown = async (signal: NodeJS.Signals, exitCode = 0): Promise<void> => {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  logger.info({ signal }, "Graceful shutdown started");

  if (server) {
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  if (telegramModule) {
    await telegramModule.shutdown();
  }

  await controlBot?.stop();

  userStreams?.stop();

  if (positionManager) {
    await positionManager.stop();
  }

  await disconnectMongo();
  logger.info("Graceful shutdown completed");
  process.exit(exitCode);
};

const start = async (): Promise<void> => {
  await initializeDatabase();

  const registry = new BinanceAccountClientRegistry();

  positionManager = new PositionManager({
    registry,
    logger,
    intervalMs: env.POSITION_SYNC_INTERVAL_MS
  });
  positionManager.start();
  runtime.positionManager = positionManager;
  runtime.registry = registry;

  // Real-time order events from Binance trigger immediate syncs; polling remains the fallback.
  userStreams = new UserStreamManager({ registry, target: positionManager, logger });
  runtime.userStreams = userStreams;
  void userStreams.start();

  if (env.TELEGRAM_CONTROL_BOT_TOKEN) {
    if (env.TELEGRAM_CONTROL_BOT_TOKEN === env.TELEGRAM_BOT_TOKEN) {
      logger.error("TELEGRAM_CONTROL_BOT_TOKEN must differ from TELEGRAM_BOT_TOKEN; control bot disabled");
    } else {
      const streams = userStreams;
      controlBot = createControlBot({
        token: env.TELEGRAM_CONTROL_BOT_TOKEN,
        ownerChatId: env.TELEGRAM_CONTROL_CHAT_ID,
        logger,
        trading: positionManager,
        describeConnections: () => {
          const listener = telegramModule?.getStatus();
          const stream = streams.getStatus();
          return [
            `<b>Signal listener:</b> ${listener?.running ? "🟢 connected" : "🔴 offline"}`,
            `<b>Binance stream:</b> ${stream.connected}/${stream.accounts} connected`
          ];
        }
      });
      runtime.controlBot = controlBot;
    }
  }

  const pipeline = new SignalPipeline({
    logger,
    registry,
    maxSignalAgeSeconds: env.SIGNAL_MAX_AGE_SECONDS,
    allowLiveTrading: env.BINANCE_ALLOW_LIVE,
    approver: controlBot,
    followUps: new FollowUpHandler(positionManager)
  });

  telegramModule = createTelegramModule({
    logger,
    onSignalStored: (signalId) => pipeline.process(signalId),
    onSignalEdited: (signalId) => pipeline.processEdit(signalId)
  });
  setTelegramStatusProvider(() => telegramModule?.getStatus());
  runtime.telegram = telegramModule;

  if (!env.AUTH_SECRET) {
    logger.warn("AUTH_SECRET is not set; dashboard logins reset when the server restarts");
  }

  server = app.listen(env.PORT, () => {
    logger.info(
      {
        environment: env.NODE_ENV,
        port: env.PORT,
        liveTradingAllowed: env.BINANCE_ALLOW_LIVE
      },
      "Backend service started"
    );
  });

  // A Telegram failure must not stop the process: open positions still need
  // their stop losses and take profits managed.
  await telegramModule.initialize().catch((error: unknown) => {
    logger.error({ error }, "Telegram listener failed to start; open trades are still managed");
  });

  await controlBot?.start().catch((error: unknown) => {
    logger.error({ error }, "Telegram control bot failed to start");
  });
};

process.on("SIGINT", (signal) => {
  void shutdown(signal);
});

process.on("SIGTERM", (signal) => {
  void shutdown(signal);
});

process.on("uncaughtException", (error) => {
  logger.fatal({ error }, "Uncaught exception");
  void shutdown("SIGTERM", 1);
});

process.on("unhandledRejection", (reason) => {
  logger.fatal({ reason }, "Unhandled promise rejection");
  void shutdown("SIGTERM", 1);
});

void start().catch((error: unknown) => {
  logger.fatal({ error }, "Failed to start backend service");
  process.exit(1);
});
