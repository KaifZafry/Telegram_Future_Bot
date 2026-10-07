import mongoose from "mongoose";

import {
  ParseStatus,
  SignalModel,
  SignalStatus,
  TelegramSourceModel,
  ValidationStatus
} from "../../models/index.js";
import type {
  RawSignalInput,
  SignalRepository,
  TelegramIngestionResult,
  TelegramLogger,
  TelegramMessage,
  TelegramMessageCandidate,
  TelegramSenderInfo,
  TelegramSourceRecord,
  TelegramSourceRepository,
  TelegramUpdate
} from "./telegram.types.js";

interface MongoDuplicateKeyError {
  code?: number;
}

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as MongoDuplicateKeyError).code === 11000;

const extractSender = (message: TelegramMessage): TelegramSenderInfo | undefined => {
  if (message.from) {
    return {
      id: String(message.from.id),
      username: message.from.username,
      firstName: message.from.first_name,
      lastName: message.from.last_name,
      isBot: message.from.is_bot
    };
  }

  if (message.sender_chat) {
    return {
      id: String(message.sender_chat.id),
      username: message.sender_chat.username,
      firstName: message.sender_chat.title
    };
  }

  return undefined;
};

export const extractTelegramMessageCandidate = (
  update: TelegramUpdate
): TelegramMessageCandidate | null => {
  const message = update.message ?? update.channel_post;

  if (!message) {
    return null;
  }

  const text = message.text ?? message.caption;

  if (!text?.trim()) {
    return null;
  }

  return {
    chatId: String(message.chat.id),
    messageId: String(message.message_id),
    text,
    sender: extractSender(message),
    messageDate: new Date(message.date * 1000)
  };
};

export class MongooseTelegramSourceRepository
  implements TelegramSourceRepository
{
  public async findActiveByChatId(
    chatId: string
  ): Promise<TelegramSourceRecord | null> {
    return TelegramSourceModel.findOne({
      chatId,
      isActive: true
    }).lean<TelegramSourceRecord | null>();
  }
}

export class MongooseSignalRepository implements SignalRepository {
  public async createRawSignal(input: RawSignalInput): Promise<{ id: string }> {
    const signal = await SignalModel.create({
      userId: input.userId,
      telegramSourceId: input.telegramSourceId,
      telegramMessageId: input.telegramMessageId,
      rawText: input.rawText,
      telegramSender: input.telegramSender,
      status: SignalStatus.Received,
      parseStatus: ParseStatus.Pending,
      validationStatus: ValidationStatus.Pending,
      receivedAt: input.receivedAt
    });

    return {
      id: signal._id.toString()
    };
  }
}

export interface TelegramServiceDependencies {
  sourceRepository?: TelegramSourceRepository;
  signalRepository?: SignalRepository;
  logger: TelegramLogger;
}

export class TelegramService {
  private readonly sourceRepository: TelegramSourceRepository;
  private readonly signalRepository: SignalRepository;
  private readonly logger: TelegramLogger;

  public constructor(dependencies: TelegramServiceDependencies) {
    this.sourceRepository =
      dependencies.sourceRepository ?? new MongooseTelegramSourceRepository();
    this.signalRepository =
      dependencies.signalRepository ?? new MongooseSignalRepository();
    this.logger = dependencies.logger;
  }

  public async ingestUpdate(
    update: TelegramUpdate
  ): Promise<TelegramIngestionResult> {
    const candidate = extractTelegramMessageCandidate(update);

    if (!candidate) {
      return {
        status: "ignored",
        reason: "unsupported_update"
      };
    }

    this.logger.info(
      {
        chatId: candidate.chatId,
        messageId: candidate.messageId
      },
      "Telegram message received"
    );

    const source = await this.sourceRepository.findActiveByChatId(candidate.chatId);

    if (!source) {
      this.logger.warn(
        {
          chatId: candidate.chatId,
          messageId: candidate.messageId
        },
        "Message received from unconfigured Telegram source"
      );

      return {
        status: "ignored",
        reason: "source_not_configured"
      };
    }

    this.logger.info(
      {
        sourceId: source._id.toString(),
        userId: source.userId.toString()
      },
      "Telegram source configured"
    );

    try {
      const signal = await this.signalRepository.createRawSignal({
        userId: source.userId,
        telegramSourceId: source._id,
        telegramMessageId: candidate.messageId,
        rawText: candidate.text,
        telegramSender: candidate.sender,
        receivedAt: candidate.messageDate
      });

      this.logger.info(
        {
          signalId: signal.id,
          telegramSourceId: source._id.toString(),
          telegramMessageId: candidate.messageId
        },
        "Signal stored"
      );

      return {
        status: "stored",
        signalId: signal.id
      };
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        this.logger.info(
          {
            telegramSourceId: source._id.toString(),
            telegramMessageId: candidate.messageId
          },
          "Duplicate Telegram message ignored"
        );

        return {
          status: "duplicate",
          reason: "duplicate_message"
        };
      }

      throw error;
    }
  }
}

export const createTelegramService = (logger: TelegramLogger): TelegramService =>
  new TelegramService({ logger });

export const createMongoObjectId = (): mongoose.Types.ObjectId =>
  new mongoose.Types.ObjectId();
