import { randomBytes } from "node:crypto";

import { env } from "../config/env.js";
import type { BinanceAccountClientRegistry } from "../modules/binance/binance.accounts.js";
import type { PositionManager } from "../modules/binance/binance.position-manager.js";
import type { TelegramModule } from "../modules/telegram/telegram.module.js";

/**
 * Long-lived services the HTTP API needs. Populated by server.ts at startup so
 * routes never construct their own exchange or Telegram clients.
 */
export const runtime: {
  authSecret: string;
  positionManager?: PositionManager;
  registry?: BinanceAccountClientRegistry;
  telegram?: TelegramModule;
} = {
  authSecret: env.AUTH_SECRET ?? randomBytes(32).toString("base64")
};
