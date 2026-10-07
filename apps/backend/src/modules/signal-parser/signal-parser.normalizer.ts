import {
  EntryType,
  MarginType,
  SignalSide,
  type TakeProfitTarget,
  type TradeEntry
} from "../../models/index.js";
import {
  BARE_LEVERAGE_PATTERN,
  CROSS_MARGIN_PATTERN,
  ENTRY_LABEL_PATTERN,
  ISOLATED_MARGIN_PATTERN,
  LABELED_LEVERAGE_PATTERN,
  LIST_INDEX_PATTERN,
  NUMBERED_TAKE_PROFIT_LABEL_PATTERN,
  NUMBER_PATTERN,
  QUOTE_ASSET,
  SIDE_LONG_PATTERN,
  SIDE_SHORT_PATTERN,
  STOP_LOSS_LABEL_PATTERN,
  SYMBOL_EXCLUDED_TOKENS,
  TAKE_PROFIT_LABEL_PATTERN
} from "./signal-parser.constants.js";
import type {
  ParsedFieldCandidates,
  SignalParserErrorCode
} from "./signal-parser.types.js";

export interface FieldExtractionFailure {
  errorCode: SignalParserErrorCode;
  errorMessage: string;
}

export type FieldExtractionResult =
  | {
      success: true;
      data: ParsedFieldCandidates;
    }
  | {
      success: false;
      error: FieldExtractionFailure;
    };

interface ParsedTakeProfitLine {
  price: number;
  allocationPercentage?: number;
}

const PERCENT_TOKEN_PATTERN = /\d+(?:\.\d+)?\s*%/g;
const TAKE_PROFIT_LABEL_STRIP_PATTERN =
  /\b(?:tp|targets?|take\s*profits?)(?:\s*\d{1,2}(?![\d.,]))?/i;

const normalizeLine = (line: string): string =>
  line
    // "20×" is a common way of writing leverage; "×" is not a letter so it
    // would otherwise be stripped and the leverage lost.
    .replace(/[×✕✖]/g, "x")
    .replace(/[^\p{L}\p{N}\s:./%+\-#(),]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

export const normalizeSignalLines = (rawText: string): string[] =>
  rawText
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter((line) => line.length > 0);

export const normalizeSignalText = (rawText: string): string =>
  normalizeSignalLines(rawText).join("\n");

const parseNumber = (value: string): number | undefined => {
  const parsedValue = Number.parseFloat(value.replace(/,/g, ""));
  return Number.isFinite(parsedValue) ? parsedValue : undefined;
};

const extractNumbers = (text: string): number[] =>
  [...text.matchAll(NUMBER_PATTERN)]
    .map((match) => parseNumber(match[0]))
    .filter((value): value is number => value !== undefined);

const extractPriceNumbers = (text: string): number[] =>
  extractNumbers(text.replace(PERCENT_TOKEN_PATTERN, " "));

const extractPercent = (text: string): number | undefined => {
  const percentMatch = text.match(/(\d+(?:\.\d+)?)\s*%/);
  return percentMatch?.[1] ? parseNumber(percentMatch[1]) : undefined;
};

const isPositive = (value: number): boolean => Number.isFinite(value) && value > 0;

export const normalizeSymbol = (rawSymbol: string): string | undefined => {
  const normalizedSymbol = rawSymbol
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  if (!normalizedSymbol.endsWith(QUOTE_ASSET)) {
    return undefined;
  }

  const baseAsset = normalizedSymbol.slice(0, -QUOTE_ASSET.length);

  if (!/^[A-Z0-9]{2,15}$/.test(baseAsset)) {
    return undefined;
  }

  return `${baseAsset}${QUOTE_ASSET}`;
};

const toSymbol = (baseOrPair: string | undefined): string | undefined => {
  if (!baseOrPair) {
    return undefined;
  }

  const upper = baseOrPair.toUpperCase();
  const base = upper.endsWith(QUOTE_ASSET) ? upper.slice(0, -QUOTE_ASSET.length) : upper;

  if (SYMBOL_EXCLUDED_TOKENS.has(base)) {
    return undefined;
  }

  return normalizeSymbol(`${base}${QUOTE_ASSET}`);
};

// Symbols are only taken from explicit markers: a USDT pair, a hashtag, or a
// "Coin:/Pair:/Symbol:" label. Guessing from arbitrary words is unsafe because
// a header such as "Binance Futures" would otherwise become BINANCEUSDT.
const extractSymbol = (normalizedText: string): string | undefined => {
  const symbolPatterns = [
    /#?\b([A-Z0-9]{2,15})\s*[/\-\s]\s*USDT\b/gi,
    /#?\b([A-Z0-9]{2,15}USDT)\b/gi,
    /#([A-Z0-9]{2,15})\b/gi,
    /\b(?:coin|pair|symbol|asset)\b\s*:?\s*#?([A-Z0-9]{2,15})\b/gi
  ];

  for (const symbolPattern of symbolPatterns) {
    for (const match of normalizedText.matchAll(symbolPattern)) {
      const symbol = toSymbol(match[1]);

      if (symbol) {
        return symbol;
      }
    }
  }

  return undefined;
};

const extractSide = (
  normalizedText: string
):
  | {
      success: true;
      side?: SignalSide;
    }
  | {
      success: false;
      error: FieldExtractionFailure;
    } => {
  const hasLong = SIDE_LONG_PATTERN.test(normalizedText);
  const hasShort = SIDE_SHORT_PATTERN.test(normalizedText);

  if (hasLong && hasShort) {
    return {
      success: false,
      error: {
        errorCode: "AMBIGUOUS_SIDE",
        errorMessage: "Both LONG/BUY and SHORT/SELL side markers were detected"
      }
    };
  }

  return {
    success: true,
    side: hasLong ? SignalSide.Long : hasShort ? SignalSide.Short : undefined
  };
};

const extractMarginType = (normalizedText: string): MarginType | undefined => {
  if (CROSS_MARGIN_PATTERN.test(normalizedText)) {
    return MarginType.Cross;
  }

  if (ISOLATED_MARGIN_PATTERN.test(normalizedText)) {
    return MarginType.Isolated;
  }

  return undefined;
};

const parseEntryFromLine = (line: string): TradeEntry | undefined => {
  if (!ENTRY_LABEL_PATTERN.test(line)) {
    return undefined;
  }

  const valueText = line.replace(ENTRY_LABEL_PATTERN, " ");

  if (/\b(?:market|cmp|now)\b/i.test(valueText)) {
    return {
      type: EntryType.Market
    };
  }

  const numbers = extractPriceNumbers(valueText);

  if (numbers.length >= 2) {
    const [first, second] = numbers;

    if (first !== undefined && second !== undefined && first !== second) {
      return {
        type: EntryType.EntryRange,
        minPrice: Math.min(first, second),
        maxPrice: Math.max(first, second)
      };
    }
  }

  const [price] = numbers;

  return price === undefined
    ? undefined
    : {
        type: EntryType.Limit,
        price
      };
};

const extractEntry = (lines: string[]): TradeEntry | undefined => {
  for (const line of lines) {
    const entry = parseEntryFromLine(line);

    if (entry) {
      return entry;
    }
  }

  return undefined;
};

const extractStopLoss = (
  lines: string[]
):
  | {
      success: true;
      stopLoss?: number;
    }
  | {
      success: false;
      error: FieldExtractionFailure;
    } => {
  const stopLossValues = lines.flatMap((line, index) => {
    if (!STOP_LOSS_LABEL_PATTERN.test(line)) {
      return [];
    }

    const [sameLinePrice] = extractPriceNumbers(line);
    if (sameLinePrice !== undefined) {
      return [sameLinePrice];
    }

    const nextLine = lines[index + 1];
    return nextLine ? extractPriceNumbers(nextLine).slice(0, 1) : [];
  });

  const uniqueStopLossValues = [...new Set(stopLossValues)];

  if (uniqueStopLossValues.length > 1) {
    return {
      success: false,
      error: {
        errorCode: "INVALID_STOP_LOSS",
        errorMessage: "Multiple stop-loss prices were detected"
      }
    };
  }

  return {
    success: true,
    stopLoss: uniqueStopLossValues[0]
  };
};

const extractTakeProfitsFromTargetsBlock = (
  lines: string[],
  startIndex: number
): ParsedTakeProfitLine[] => {
  const takeProfits: ParsedTakeProfitLine[] = [];

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];

    if (
      !line ||
      STOP_LOSS_LABEL_PATTERN.test(line) ||
      ENTRY_LABEL_PATTERN.test(line) ||
      TAKE_PROFIT_LABEL_PATTERN.test(line)
    ) {
      break;
    }

    const [price] = extractPriceNumbers(line.replace(LIST_INDEX_PATTERN, ""));
    if (price === undefined) {
      break;
    }

    takeProfits.push({
      price,
      allocationPercentage: extractPercent(line)
    });
  }

  return takeProfits;
};

const extractTakeProfits = (lines: string[]): TakeProfitTarget[] => {
  const parsedTakeProfits: ParsedTakeProfitLine[] = [];

  lines.forEach((line, index) => {
    if (!TAKE_PROFIT_LABEL_PATTERN.test(line) || STOP_LOSS_LABEL_PATTERN.test(line)) {
      return;
    }

    const valueText = line.replace(TAKE_PROFIT_LABEL_STRIP_PATTERN, " ");
    const prices = extractPriceNumbers(valueText);
    const allocationPercentage = extractPercent(line);

    if (prices.length === 0) {
      parsedTakeProfits.push(...extractTakeProfitsFromTargetsBlock(lines, index));
      return;
    }

    // "TP1: 62000 50%" names a single target; "Targets: 0.86, 0.91, 0.97"
    // lists several on one line.
    if (NUMBERED_TAKE_PROFIT_LABEL_PATTERN.test(line) || prices.length === 1) {
      parsedTakeProfits.push({
        price: prices[0] as number,
        allocationPercentage
      });
      return;
    }

    parsedTakeProfits.push(...prices.map((price) => ({ price })));
  });

  return applyTakeProfitAllocations(parsedTakeProfits);
};

const applyTakeProfitAllocations = (
  takeProfits: ParsedTakeProfitLine[]
): TakeProfitTarget[] => {
  if (takeProfits.length === 0) {
    return [];
  }

  const hasAnyExplicitAllocation = takeProfits.some(
    (takeProfit) => takeProfit.allocationPercentage !== undefined
  );

  if (hasAnyExplicitAllocation) {
    return takeProfits.map((takeProfit) => ({
      price: takeProfit.price,
      allocationPercentage: takeProfit.allocationPercentage ?? 0
    }));
  }

  const baseAllocation = Math.floor((100 / takeProfits.length) * 100) / 100;
  let remainingAllocation = 100;

  return takeProfits.map((takeProfit, index) => {
    const isLastTarget = index === takeProfits.length - 1;
    const allocationPercentage = isLastTarget
      ? Number(remainingAllocation.toFixed(2))
      : baseAllocation;

    remainingAllocation = Number(
      (remainingAllocation - allocationPercentage).toFixed(2)
    );

    return {
      price: takeProfit.price,
      allocationPercentage
    };
  });
};

const extractLeverage = (
  normalizedText: string
):
  | {
      success: true;
      leverage?: number;
    }
  | {
      success: false;
      error: FieldExtractionFailure;
    } => {
  const lines = normalizedText.split("\n");
  const leverageValues = lines
    .map((line) => {
      const labeledMatch = line.match(LABELED_LEVERAGE_PATTERN);
      if (labeledMatch?.[1]) {
        return parseNumber(labeledMatch[1]);
      }

      const bareMatch = line.match(BARE_LEVERAGE_PATTERN);
      return bareMatch?.[1] ? parseNumber(bareMatch[1]) : undefined;
    })
    .filter((value): value is number => value !== undefined);

  if (leverageValues.length === 0) {
    return {
      success: true
    };
  }

  const uniqueLeverageValues = [...new Set(leverageValues)];

  if (
    uniqueLeverageValues.length !== 1 ||
    !isPositive(uniqueLeverageValues[0] ?? 0)
  ) {
    return {
      success: false,
      error: {
        errorCode: "INVALID_LEVERAGE",
        errorMessage: "Leverage must be a single positive number"
      }
    };
  }

  return {
    success: true,
    leverage: uniqueLeverageValues[0]
  };
};

export const extractSignalFields = (rawText: string): FieldExtractionResult => {
  const lines = normalizeSignalLines(rawText);
  const normalizedText = lines.join("\n");

  const sideResult = extractSide(normalizedText);
  if (!sideResult.success) {
    return sideResult;
  }

  const stopLossResult = extractStopLoss(lines);
  if (!stopLossResult.success) {
    return stopLossResult;
  }

  const leverageResult = extractLeverage(normalizedText);
  if (!leverageResult.success) {
    return leverageResult;
  }

  const takeProfits = extractTakeProfits(lines);

  return {
    success: true,
    data: {
      symbol: extractSymbol(normalizedText),
      side: sideResult.side,
      entry: extractEntry(lines),
      leverage: leverageResult.leverage,
      marginType: extractMarginType(normalizedText),
      stopLoss: stopLossResult.stopLoss,
      takeProfits: takeProfits.filter((takeProfit) => isPositive(takeProfit.price))
    }
  };
};
