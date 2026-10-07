import "dotenv/config";

import { TelegramClient } from "telegram";
import { LogLevel } from "telegram/extensions/Logger.js";
import { StringSession } from "telegram/sessions/index.js";

import { ask, closePrompt } from "./prompt.js";

/**
 * One-time login for TELEGRAM_MODE=user. Prints a session string that lets the
 * bot read your chats as you. Treat it like a password: anyone holding it has
 * full access to your Telegram account.
 */
const main = async (): Promise<void> => {
  console.log("Telegram user login. Get API ID/hash at https://my.telegram.org -> API development tools.\n");

  const apiId = Number(await ask("API ID", process.env.TELEGRAM_API_ID));
  const apiHash = await ask("API hash", process.env.TELEGRAM_API_HASH);

  if (!Number.isInteger(apiId) || apiId <= 0 || !apiHash) {
    throw new Error("A valid API ID and API hash are required");
  }

  const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
    connectionRetries: 5
  });
  client.setLogLevel(LogLevel.ERROR);

  await client.start({
    phoneNumber: () => ask("Phone number (international format, e.g. +91...)"),
    phoneCode: () => ask("Login code sent to your Telegram app"),
    password: () => ask("Two-step verification password (blank if none)"),
    onError: (error) => {
      console.error(`Login error: ${error.message}`);
    }
  });

  const me = await client.getMe();
  const session = client.session.save() as unknown as string;

  console.log(`\nLogged in as ${me.firstName ?? ""} ${me.username ? `(@${me.username})` : ""}`);
  console.log("\nAdd these to apps/backend/.env (keep TELEGRAM_SESSION secret):\n");
  console.log(`TELEGRAM_MODE=user`);
  console.log(`TELEGRAM_API_ID=${apiId}`);
  console.log(`TELEGRAM_API_HASH=${apiHash}`);
  console.log(`TELEGRAM_SESSION=${session}\n`);

  await client.disconnect();
};

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    closePrompt();
    setTimeout(() => process.exit(), 500);
  });
