import type {
  TelegramLogger,
  TelegramUpdateIngestionService,
  TelegramUpdate
} from "./telegram.types.js";

export type SignalStoredHandler = (signalId: string) => Promise<void>;
export type SignalEditedHandler = (signalId: string, previousText: string) => Promise<void>;

export const createTelegramUpdateHandler =
  (
    service: TelegramUpdateIngestionService,
    logger: TelegramLogger,
    onSignalStored?: SignalStoredHandler,
    onSignalEdited?: SignalEditedHandler
  ): ((update: TelegramUpdate) => Promise<void>) =>
  async (update: TelegramUpdate): Promise<void> => {
    try {
      const result = await service.ingestUpdate(update);

      if (result.status === "stored" && result.signalId && onSignalStored) {
        await onSignalStored(result.signalId);
      }

      if (result.status === "edited" && result.signalId && onSignalEdited) {
        await onSignalEdited(result.signalId, result.previousText ?? "");
      }
    } catch (error) {
      logger.error(
        {
          error
        },
        "Telegram listener error"
      );
    }
  };
