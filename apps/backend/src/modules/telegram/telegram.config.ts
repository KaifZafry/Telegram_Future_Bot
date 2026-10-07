import type { TelegramConfig } from "./telegram.types.js";

const optionalEnvValue = (value: string | undefined): string | undefined => {
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue : undefined;
};

export const getTelegramConfig = (): TelegramConfig => {
  const apiId = Number(optionalEnvValue(process.env.TELEGRAM_API_ID));

  return {
    mode: process.env.TELEGRAM_MODE?.trim() === "bot" ? "bot" : "user",
    botToken: optionalEnvValue(process.env.TELEGRAM_BOT_TOKEN),
    webhookSecret: optionalEnvValue(process.env.TELEGRAM_WEBHOOK_SECRET),
    apiId: Number.isInteger(apiId) && apiId > 0 ? apiId : undefined,
    apiHash: optionalEnvValue(process.env.TELEGRAM_API_HASH),
    session: optionalEnvValue(process.env.TELEGRAM_SESSION)
  };
};
