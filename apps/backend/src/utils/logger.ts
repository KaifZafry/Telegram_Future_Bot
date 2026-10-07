import pino from "pino";

import { env } from "../config/env.js";

export const logger = pino({
  level: env.LOG_LEVEL,
  base: {
    service: "trading-engine"
  },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "password",
      "apiKey",
      "apiSecret",
      "telegramBotToken",
      "TELEGRAM_BOT_TOKEN",
      "secret"
    ],
    censor: "[REDACTED]"
  }
});
