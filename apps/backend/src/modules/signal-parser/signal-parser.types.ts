import type { Types } from "mongoose";

import type {
  MarginType,
  SignalSide,
  SignalStatus,
  ParseStatus,
  TakeProfitTarget,
  TradeEntry
} from "../../models/index.js";
import type { SIGNAL_PARSER_ERROR_CODES } from "./signal-parser.constants.js";

export type SignalParserErrorCode = (typeof SIGNAL_PARSER_ERROR_CODES)[number];

export interface NormalizedSignal {
  symbol: string;
  side: SignalSide;
  entry: TradeEntry;
  leverage?: number;
  marginType?: MarginType;
  stopLoss: number;
  takeProfits: TakeProfitTarget[];
}

export interface SuccessfulParseResult {
  success: true;
  data: NormalizedSignal;
}

export interface FailedParseResult {
  success: false;
  errorCode: SignalParserErrorCode;
  errorMessage: string;
}

export type ParseResult = SuccessfulParseResult | FailedParseResult;

export interface SignalParserRepositoryRecord {
  _id: Types.ObjectId;
  rawText: string;
  parseStatus: ParseStatus;
  status: SignalStatus;
}

export interface SignalParserRepository {
  findSignalById(signalId: string): Promise<SignalParserRepositoryRecord | null>;
  markParsed(signalId: string, data: NormalizedSignal, parsedAt: Date): Promise<void>;
  markParseFailed(
    signalId: string,
    errorCode: SignalParserErrorCode,
    errorMessage: string,
    parsedAt: Date
  ): Promise<void>;
}

export interface ParseAndUpdateOptions {
  reprocessFailed?: boolean;
  force?: boolean;
}

export interface ParseAndUpdateResult {
  signalId: string;
  parsed: boolean;
  skipped: boolean;
  result?: ParseResult;
  reason?: "already_parsed" | "not_found";
}

export interface ParsedFieldCandidates {
  symbol?: string;
  side?: SignalSide;
  entry?: TradeEntry;
  leverage?: number;
  marginType?: MarginType;
  stopLoss?: number;
  takeProfits: TakeProfitTarget[];
}
