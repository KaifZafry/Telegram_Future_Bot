import { Types } from "mongoose";

import {
  ParseStatus,
  SignalModel,
  SignalStatus,
  ValidationStatus
} from "../../models/index.js";
import { extractSignalFields } from "./signal-parser.normalizer.js";
import type {
  NormalizedSignal,
  ParseAndUpdateOptions,
  ParseAndUpdateResult,
  ParseResult,
  SignalParserErrorCode,
  SignalParserRepository,
  SignalParserRepositoryRecord
} from "./signal-parser.types.js";
import { validateNormalizedSignal } from "./signal-parser.validators.js";

class MongooseSignalParserRepository implements SignalParserRepository {
  public async findSignalById(
    signalId: string
  ): Promise<SignalParserRepositoryRecord | null> {
    if (!Types.ObjectId.isValid(signalId)) {
      return null;
    }

    return SignalModel.findById(signalId)
      .select("_id rawText parseStatus status")
      .lean<SignalParserRepositoryRecord | null>();
  }

  public async markParsed(
    signalId: string,
    data: NormalizedSignal,
    parsedAt: Date
  ): Promise<void> {
    await SignalModel.updateOne(
      { _id: signalId },
      {
        $set: {
          symbol: data.symbol,
          side: data.side,
          entry: data.entry,
          leverage: data.leverage,
          marginType: data.marginType,
          stopLoss: data.stopLoss,
          takeProfits: data.takeProfits,
          parseStatus: ParseStatus.Parsed,
          validationStatus: ValidationStatus.Valid,
          status: SignalStatus.Parsed,
          parsedAt
        },
        $unset: {
          parseError: ""
        }
      }
    );
  }

  public async markParseFailed(
    signalId: string,
    errorCode: SignalParserErrorCode,
    errorMessage: string,
    parsedAt: Date
  ): Promise<void> {
    await SignalModel.updateOne(
      { _id: signalId },
      {
        $set: {
          parseStatus: ParseStatus.Failed,
          validationStatus: ValidationStatus.Invalid,
          status: SignalStatus.Received,
          parseError: {
            code: errorCode,
            message: errorMessage
          },
          parsedAt
        }
      }
    );
  }
}

export class SignalParserService {
  private readonly repository: SignalParserRepository;

  public constructor(repository?: SignalParserRepository) {
    this.repository = repository ?? new MongooseSignalParserRepository();
  }

  public parseSignalText(rawText: string): ParseResult {
    const extraction = extractSignalFields(rawText);

    if (!extraction.success) {
      return {
        success: false,
        errorCode: extraction.error.errorCode,
        errorMessage: extraction.error.errorMessage
      };
    }

    return validateNormalizedSignal(extraction.data);
  }

  public async parseAndUpdateSignal(
    signalId: string,
    options: ParseAndUpdateOptions = {}
  ): Promise<ParseAndUpdateResult> {
    const signal = await this.repository.findSignalById(signalId);

    if (!signal) {
      return {
        signalId,
        parsed: false,
        skipped: true,
        reason: "not_found"
      };
    }

    if (signal.parseStatus === ParseStatus.Parsed && !options.force) {
      return {
        signalId,
        parsed: false,
        skipped: true,
        reason: "already_parsed"
      };
    }

    if (
      signal.parseStatus === ParseStatus.Failed &&
      !options.reprocessFailed &&
      !options.force
    ) {
      return {
        signalId,
        parsed: false,
        skipped: true,
        reason: "already_parsed"
      };
    }

    const result = this.parseSignalText(signal.rawText);
    const parsedAt = new Date();

    if (result.success) {
      await this.repository.markParsed(signalId, result.data, parsedAt);

      return {
        signalId,
        parsed: true,
        skipped: false,
        result
      };
    }

    await this.repository.markParseFailed(
      signalId,
      result.errorCode,
      result.errorMessage,
      parsedAt
    );

    return {
      signalId,
      parsed: false,
      skipped: false,
      result
    };
  }
}

export const parseSignalText = (rawText: string): ParseResult =>
  new SignalParserService().parseSignalText(rawText);
