import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const blankAsUndefined = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalString = z.preprocess(blankAsUndefined, z.string().trim().optional());

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  TELEGRAM_MODE: z.enum(["user", "bot"]).default("user"),
  TELEGRAM_BOT_TOKEN: optionalString,
  TELEGRAM_WEBHOOK_SECRET: optionalString,
  TELEGRAM_API_ID: z.preprocess(
    blankAsUndefined,
    z.coerce.number().int().positive().optional()
  ),
  TELEGRAM_API_HASH: optionalString,
  TELEGRAM_SESSION: optionalString,
  TELEGRAM_CONTROL_BOT_TOKEN: optionalString,
  TELEGRAM_CONTROL_CHAT_ID: z.preprocess(
    blankAsUndefined,
    z.string().trim().regex(/^-?\d+$/, "TELEGRAM_CONTROL_CHAT_ID must be a numeric chat ID").optional()
  ),
  CREDENTIALS_ENCRYPTION_KEY: optionalString,
  BINANCE_ALLOW_LIVE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  AUTH_SECRET: optionalString,
  DASHBOARD_ORIGIN: z.string().default("http://localhost:3000"),
  SIGNAL_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(120),
  POSITION_SYNC_INTERVAL_MS: z.coerce.number().int().min(1000).default(5000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info")
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const details = parsedEnv.error.flatten().fieldErrors;
  throw new Error(`Invalid environment configuration: ${JSON.stringify(details)}`);
}

export const env = parsedEnv.data;
