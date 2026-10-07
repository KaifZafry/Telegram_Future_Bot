# Telegram Module

Receives Telegram messages and stores them as raw `Signal` documents.

Two transports implement the same `TelegramClient` interface:

- **user** (`TELEGRAM_MODE=user`, default): logs in as your own Telegram account
  through MTProto (GramJS), so it can read any group or channel you are a member
  of. Run `npm run telegram:login` once to create `TELEGRAM_SESSION`.
- **bot** (`TELEGRAM_MODE=bot`): Bot API polling via grammY. The bot must be a
  member (channel admin) of every source chat.

Only chats registered as active `TelegramSource` records are ingested. Find a
chat's ID with `npm run telegram:chats`. Stored signals are handed to the
trading pipeline through `onSignalStored`.
