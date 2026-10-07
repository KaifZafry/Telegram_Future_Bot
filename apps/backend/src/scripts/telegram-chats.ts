import "dotenv/config";

import { TelegramClient } from "telegram";
import { LogLevel } from "telegram/extensions/Logger.js";
import { StringSession } from "telegram/sessions/index.js";

/** Lists your groups and channels with the chat ID to register as a TelegramSource. */
const main = async (): Promise<void> => {
  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH;
  const session = process.env.TELEGRAM_SESSION;

  if (!apiId || !apiHash || !session) {
    throw new Error("Set TELEGRAM_API_ID, TELEGRAM_API_HASH and TELEGRAM_SESSION first (npm run telegram:login)");
  }

  const client = new TelegramClient(new StringSession(session), apiId, apiHash, {
    connectionRetries: 5
  });
  client.setLogLevel(LogLevel.ERROR);
  await client.connect();

  const filter = process.argv[2]?.toLowerCase();
  const dialogs = await client.getDialogs({ limit: 500 });
  const rows = dialogs
    .filter((dialog) => dialog.isGroup || dialog.isChannel)
    .filter((dialog) => !filter || (dialog.title ?? "").toLowerCase().includes(filter))
    .map((dialog) => ({
      chatId: dialog.id?.toString() ?? "",
      type: dialog.isChannel && !dialog.isGroup ? "CHANNEL" : "SUPERGROUP/GROUP",
      title: dialog.title ?? ""
    }));

  console.table(rows);
  await client.disconnect();
};

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    setTimeout(() => process.exit(), 500);
  });
