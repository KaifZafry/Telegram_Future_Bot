import type { HealthResponse } from "../types/api.js";
import type { TelegramRuntimeStatus } from "../modules/telegram/index.js";

let telegramStatusProvider:
  | (() => TelegramRuntimeStatus | undefined)
  | undefined;

export const setTelegramStatusProvider = (
  provider: () => TelegramRuntimeStatus | undefined
): void => {
  telegramStatusProvider = provider;
};

export const healthService = {
  getHealthStatus(): HealthResponse {
    return {
      success: true,
      service: "trading-engine",
      status: "healthy",
      telegram: telegramStatusProvider?.(),
      timestamp: new Date().toISOString()
    };
  }
};
