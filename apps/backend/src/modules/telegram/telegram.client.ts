import { Bot } from "grammy";
import { TelegramClient as GramJsClient } from "telegram";
import { NewMessage, type NewMessageEvent } from "telegram/events/index.js";
import { EditedMessage, type EditedMessageEvent } from "telegram/events/EditedMessage.js";
import { LogLevel } from "telegram/extensions/Logger.js";
import { StringSession } from "telegram/sessions/index.js";

import type {
  TelegramChatInfo,
  TelegramClient,
  TelegramUpdate
} from "./telegram.types.js";

/** Bot API listener: only sees chats the bot has been added to. */
export class GrammyTelegramClient implements TelegramClient {
  private readonly bot: Bot;

  public constructor(token: string) {
    this.bot = new Bot(token);
  }

  public async start(
    onUpdate: (update: TelegramUpdate) => Promise<void>
  ): Promise<void> {
    this.bot.on("message", async (context) => {
      await onUpdate(context.update);
    });

    this.bot.on("channel_post", async (context) => {
      await onUpdate(context.update);
    });

    this.bot.on(["edited_message", "edited_channel_post"], async (context) => {
      await onUpdate(context.update);
    });

    // bot.start() only settles when polling stops, so wait for onStart instead
    // of the returned promise; awaiting it would block startup forever.
    await new Promise<void>((resolve, reject) => {
      this.bot
        .start({
          drop_pending_updates: true,
          onStart: () => resolve()
        })
        .catch(reject);
    });
  }

  public async stop(): Promise<void> {
    await this.bot.stop();
  }
}

/**
 * MTProto user-account listener: reads every chat the logged-in account is a
 * member of, so it works for signal groups and channels you cannot add a bot to.
 */
export class GramJsUserTelegramClient implements TelegramClient {
  private readonly client: GramJsClient;

  public constructor(apiId: number, apiHash: string, session: string) {
    this.client = new GramJsClient(new StringSession(session), apiId, apiHash, {
      connectionRetries: 10,
      autoReconnect: true
    });
    this.client.setLogLevel(LogLevel.WARN);
  }

  public async start(
    onUpdate: (update: TelegramUpdate) => Promise<void>
  ): Promise<void> {
    await this.client.connect();

    if (!(await this.client.checkAuthorization())) {
      throw new Error(
        "TELEGRAM_SESSION is invalid or expired; run `npm run telegram:login` again"
      );
    }

    // GramJS needs at least one getDialogs() call to populate its internal
    // entity cache (peer → chatId mappings). Without this, messages from
    // channels and supergroups arrive but message.chatId resolves to undefined
    // because the peer is unknown, so they are silently dropped.
    await this.client.getDialogs({ limit: 1 });

    this.client.addEventHandler((event: NewMessageEvent) => {
      const message = event.message;
      const chatId = message.chatId;

      if (!chatId) {
        return;
      }

      // GramJS marks chat IDs the same way the Bot API does (-100… for
      // channels/supergroups), so TelegramSource.chatId works in both modes.
      // onUpdate handles its own errors.
      void onUpdate({
        update_id: message.id,
        message: {
          message_id: message.id,
          date: message.date,
          chat: { id: chatId.toString() },
          text: message.message,
          from: message.senderId ? { id: message.senderId.toString() } : undefined,
          reply_to_message: message.replyTo?.replyToMsgId
            ? { message_id: message.replyTo.replyToMsgId }
            : undefined
        }
      });
    }, new NewMessage({}));

    this.client.addEventHandler((event: EditedMessageEvent) => {
      const message = event.message;
      const chatId = message.chatId;

      if (!chatId) {
        return;
      }

      void onUpdate({
        update_id: message.id,
        edited_message: {
          message_id: message.id,
          date: message.date,
          edit_date: message.editDate ?? message.date,
          chat: { id: chatId.toString() },
          text: message.message
        }
      });
    }, new EditedMessage({}));
  }

  public async listChats(): Promise<TelegramChatInfo[]> {
    const dialogs = await this.client.getDialogs({ limit: 500 });

    return dialogs
      .filter((dialog) => dialog.isGroup || dialog.isChannel)
      .map((dialog) => ({
        chatId: dialog.id?.toString() ?? "",
        title: dialog.title ?? "",
        type: dialog.isChannel && !dialog.isGroup ? ("CHANNEL" as const) : ("GROUP" as const)
      }))
      .filter((chat) => chat.chatId !== "");
  }

  public async stop(): Promise<void> {
    await this.client.destroy();
  }
}
