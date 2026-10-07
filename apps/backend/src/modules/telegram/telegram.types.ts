import type { Types } from "mongoose";

export type TelegramMode = "bot" | "user";

export interface TelegramConfig {
  mode: TelegramMode;
  botToken?: string;
  webhookSecret?: string;
  apiId?: number;
  apiHash?: string;
  session?: string;
}

export interface TelegramSenderInfo {
  id?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  isBot?: boolean;
}

export interface TelegramChat {
  id: number | string;
  type?: string;
  title?: string;
  username?: string;
}

export interface TelegramUser {
  id: number | string;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface TelegramMessage {
  message_id: number;
  date: number;
  chat: TelegramChat;
  from?: TelegramUser;
  sender_chat?: TelegramChat;
  text?: string;
  caption?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_message?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
}

export interface TelegramMessageCandidate {
  chatId: string;
  messageId: string;
  text: string;
  sender?: TelegramSenderInfo;
  messageDate: Date;
}

export interface TelegramSourceRecord {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  chatId: string;
  isActive: boolean;
}

export interface TelegramSourceRepository {
  findActiveByChatId(chatId: string): Promise<TelegramSourceRecord | null>;
}

export interface RawSignalInput {
  userId: Types.ObjectId;
  telegramSourceId: Types.ObjectId;
  telegramMessageId: string;
  rawText: string;
  telegramSender?: TelegramSenderInfo;
  receivedAt: Date;
}

export interface SignalRepository {
  createRawSignal(input: RawSignalInput): Promise<{ id: string }>;
}

export interface TelegramLogger {
  info(data: Record<string, unknown>, message: string): void;
  warn(data: Record<string, unknown>, message: string): void;
  error(data: Record<string, unknown>, message: string): void;
}

export interface TelegramChatInfo {
  chatId: string;
  title: string;
  type: "CHANNEL" | "GROUP";
}

export interface TelegramClient {
  start(onUpdate: (update: TelegramUpdate) => Promise<void>): Promise<void>;
  stop(): Promise<void>;
  /** Groups and channels the account can read (user mode only). */
  listChats?(): Promise<TelegramChatInfo[]>;
}

export type TelegramClientFactory = (config: TelegramConfig) => TelegramClient;

export type TelegramIngestionStatus = "stored" | "ignored" | "duplicate";

export interface TelegramIngestionResult {
  status: TelegramIngestionStatus;
  reason?: string;
  signalId?: string;
}

export interface TelegramUpdateIngestionService {
  ingestUpdate(update: TelegramUpdate): Promise<TelegramIngestionResult>;
}

export interface TelegramRuntimeStatus {
  enabled: boolean;
  running: boolean;
  mode: TelegramMode;
}
