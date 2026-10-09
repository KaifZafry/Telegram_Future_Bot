/**
 * Recognises follow-up instructions a signal group posts after a signal
 * ("Close RLC", "Move SL to entry", "Cancel ETH", "New SL 0.80"). Only called
 * for messages that are not complete signals, so a real signal is never
 * mistaken for a command. Informational posts ("TP1 hit ✅") return null.
 */

export type FollowUpAction = "CLOSE" | "CANCEL" | "BREAKEVEN" | "MOVE_SL";

export interface FollowUp {
  action: FollowUpAction;
  /** Coin tokens mentioned, upper-case, without a USDT suffix (e.g. "RLC"). */
  symbols: string[];
  /** Coins named unambiguously: #ETH, ETH/USDT or ETHUSDT. */
  explicitSymbols: string[];
  /** New stop price for MOVE_SL. */
  price?: number;
}

// Words that can follow "close"/"exit" without naming a coin or an order.
const NOT_A_TARGET = new Set([
  "TO", "THE", "AT", "ABOVE", "BELOW", "IN", "ON", "BY", "NEAR", "ENOUGH", "CALL",
  "TP", "TP1", "TP2", "TP3", "TARGET", "PRICE", "PROFIT", "PROFITS", "AND", "OR",
  "IS", "WAS", "WE", "I", "YOU", "A", "AN", "OF", "FROM", "FOR", "WITH",
  "WILL", "WOULD", "SHOULD", "MAY", "MIGHT", "CAN", "COULD", "NOT", "NEVER", "DONT", "CANT",
  "WONT", "MARKET", "DAILY", "WEEKLY", "CANDLE", "HOURLY", "4H", "1H", "1D", "SOON"
]);

const NOISE_TOKENS = new Set([
  ...NOT_A_TARGET,
  "CLOSE", "CLOSED", "EXIT", "NOW", "ALL", "POSITION", "TRADE", "IT", "CANCEL", "CANCELLED",
  "CANCELED", "SIGNAL", "SL", "STOP", "LOSS", "MOVE", "SET", "SHIFT", "ENTRY", "BREAKEVEN",
  "BREAK", "EVEN", "BE", "NEW", "UPDATE", "USDT", "LONG", "SHORT", "DONT", "DON", "T",
  "ENTER", "AVOID", "SKIP", "INVALID", "INVALIDATED", "PLEASE", "GUYS", "COST", "MANUALLY",
  "FUTURES", "SPOT", "BINANCE", "VIP"
]);

const BREAKEVEN_PATTERN =
  /\b(?:sl|stop\s*loss|stop)\s*(?:to|at|on|=|:)?\s*(?:entry|entries|breakeven|break\s*even|be|cost)\b|\b(?:move|shift|set|put)\s+(?:sl|stop\s*loss|stop)\s+(?:to\s+)?(?:entry|breakeven|break\s*even|be)\b|\bbreak\s*-?\s*even\b/i;
const MOVE_SL_PATTERN =
  /\b(?:new\s+(?:sl|stop\s*loss|stop)|(?:move|update|change|set|shift)\s+(?:sl|stop\s*loss|stop)\s*(?:to|at|=)?)\s*:?\s*(\d+(?:\.\d+)?)/i;
const CLOSE_PATTERN = /\b(?:close|exit|square\s*off)\s+(?:#?([a-z0-9]{2,15})(?:\s*\/?\s*usdt)?)\b/gi;
const CLOSE_STANDALONE_PATTERN = /^\s*(?:close|exit)\s*(?:now|all|position|trade|it)?\s*[!.]*\s*$/im;
// "#RLC close", "RLC/USDT close now": coin first, verb last on the line.
const CLOSE_SUFFIX_PATTERN = /#?\b([a-z0-9]{2,15})(?:\s*\/?\s*usdt)?\s+(?:close|exit)\s*(?:now|it)?\s*[!.]*\s*$/im;
const CANCEL_PATTERN =
  /\b(?:cancel(?:l?ed)?|don'?t\s+enter|do\s+not\s+enter|avoid\s+(?:this|entry)|skip\s+(?:this|it)|invalidated)\b/i;

const symbolTokens = (text: string): string[] => {
  const tokens = new Set<string>();

  for (const match of text.matchAll(/#([a-z0-9]{2,15})/gi)) {
    tokens.add((match[1] as string).toUpperCase());
  }

  for (const match of text.matchAll(/\b([a-z0-9]{2,15})\s*\/?\s*usdt\b/gi)) {
    tokens.add((match[1] as string).toUpperCase());
  }

  // Bare tokens are kept as candidates; the handler only uses ones that match an open trade.
  for (const match of text.matchAll(/\b([A-Za-z][A-Za-z0-9]{1,14})\b/g)) {
    tokens.add((match[1] as string).toUpperCase().replace(/USDT$/, ""));
  }

  return [...tokens].filter((token) => token.length >= 2 && !NOISE_TOKENS.has(token));
};

const explicitTokens = (text: string): string[] => {
  const tokens = new Set<string>();

  for (const match of text.matchAll(/#([a-z0-9]{2,15})/gi)) {
    tokens.add((match[1] as string).toUpperCase().replace(/USDT$/, ""));
  }

  for (const match of text.matchAll(/\b([a-z0-9]{2,15})\s*\/?\s*usdt\b/gi)) {
    tokens.add((match[1] as string).toUpperCase());
  }

  return [...tokens].filter((token) => !NOISE_TOKENS.has(token));
};

export const parseFollowUp = (rawText: string): FollowUp | null => {
  const text = rawText.replace(/[^\p{L}\p{N}\s#/.:=!'-]/gu, " ");
  const symbols = symbolTokens(text);
  const explicitSymbols = explicitTokens(text);

  const moveSl = text.match(MOVE_SL_PATTERN);
  if (moveSl?.[1]) {
    return { action: "MOVE_SL", symbols, explicitSymbols, price: Number(moveSl[1]) };
  }

  if (BREAKEVEN_PATTERN.test(text)) {
    return { action: "BREAKEVEN", symbols, explicitSymbols };
  }

  const closeTargets = [...text.matchAll(CLOSE_PATTERN)]
    .map((match) => (match[1] as string).toUpperCase())
    .filter((target) => !NOT_A_TARGET.has(target));
  const suffixTarget = text.match(CLOSE_SUFFIX_PATTERN)?.[1]?.toUpperCase();
  const closeBySuffix = suffixTarget !== undefined && !NOT_A_TARGET.has(suffixTarget) && !NOISE_TOKENS.has(suffixTarget);

  if (closeTargets.length > 0 || closeBySuffix || CLOSE_STANDALONE_PATTERN.test(text)) {
    return { action: "CLOSE", symbols, explicitSymbols };
  }

  if (CANCEL_PATTERN.test(text)) {
    return { action: "CANCEL", symbols, explicitSymbols };
  }

  return null;
};
