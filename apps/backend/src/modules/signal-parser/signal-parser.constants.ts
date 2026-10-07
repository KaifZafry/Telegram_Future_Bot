export const QUOTE_ASSET = "USDT";

export const BARE_LEVERAGE_PATTERN = /\b(\d+(?:\.\d+)?)\s*x\b/i;
export const LABELED_LEVERAGE_PATTERN =
  /\b(?:leverage|lev)\b\s*:?\s*(?:(?:cross|isolated|isolate)\s*)?(-?\d+(?:\.\d+)?)\s*x?\b/i;

export const CROSS_MARGIN_PATTERN = /\bcross(?:ed)?\b/i;
export const ISOLATED_MARGIN_PATTERN = /\bisolated?\b/i;

// Prices are never negative, so "0.8250-0.7900" is read as two numbers rather
// than 0.8250 and -0.7900. Thousands separators must be followed by a non-digit
// so "62000,63000" splits into two numbers.
export const NUMBER_PATTERN = /\d+(?:,\d{3}(?!\d))*(?:\.\d+)?/g;

export const SIGNAL_PARSER_ERROR_CODES = [
  "INVALID_SYMBOL_FORMAT",
  "MISSING_SYMBOL",
  "MISSING_SIDE",
  "AMBIGUOUS_SIDE",
  "MISSING_ENTRY",
  "INVALID_ENTRY",
  "MISSING_STOP_LOSS",
  "INVALID_STOP_LOSS",
  "MISSING_TAKE_PROFIT",
  "INVALID_TAKE_PROFIT",
  "INVALID_PRICE_RELATIONSHIP",
  "INVALID_LEVERAGE",
  "INVALID_TP_ALLOCATION",
  "AMBIGUOUS_SIGNAL"
] as const;

export const SIDE_LONG_PATTERN = /\b(?:long|buy)(?:\s+position|\s+long)?\b/i;
export const SIDE_SHORT_PATTERN = /\b(?:short|sell)(?:\s+position|\s+short)?\b/i;

export const ENTRY_LABEL_PATTERN = /\bentr(?:y|ies)\b/i;
export const STOP_LOSS_LABEL_PATTERN = /\b(?:sl|stop\s*loss|stoploss|stop)\b/i;
export const TAKE_PROFIT_LABEL_PATTERN =
  /\b(?:tp\s*\d*|targets?\s*\d*|take\s*profits?\s*\d*)\b/i;
export const NUMBERED_TAKE_PROFIT_LABEL_PATTERN =
  /\b(?:tp|targets?|take\s*profits?)\s*\d{1,2}(?![\d.,])/i;

// List markers such as "1) 3300", "2. 3400" or "3- 3500" at the start of a line.
export const LIST_INDEX_PATTERN = /^\s*\d{1,2}\s*(?:\)|\.(?=\s)|-(?=\s)|:)\s*/;

export const SYMBOL_EXCLUDED_TOKENS = new Set([
  "LONG",
  "SHORT",
  "BUY",
  "SELL",
  "ENTRY",
  "ENTRIES",
  "ZONE",
  "MARKET",
  "SL",
  "STOP",
  "LOSS",
  "STOPLOSS",
  "TP",
  "TARGET",
  "TARGETS",
  "LEVERAGE",
  "LEV",
  "CROSS",
  "ISOLATED",
  "SIGNAL",
  "SIGNALS",
  "VIP",
  "FUTURES",
  "BINANCE",
  "USDT"
]);
