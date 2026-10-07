import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EntryType, MarginType, SignalSide } from "../models/index.js";
import { parseSignalText } from "../modules/signal-parser/index.js";

const RLC_SIGNAL = `Coin #RLC/USDT

Position: LONG

Leverage:  Cross 20×

Entries:  0.8250 - 0.7900

Targets: 🎯 0.8650, 0.9150, 0.9750

Stop Loss: 0.7550`;

const parseOk = (text: string) => {
  const result = parseSignalText(text);
  assert.equal(result.success, true, JSON.stringify(result));
  return result.data;
};

void describe("Signal parser", () => {
  void it("parses the group's signal format completely", () => {
    assert.deepEqual(parseOk(RLC_SIGNAL), {
      symbol: "RLCUSDT",
      side: SignalSide.Long,
      entry: { type: EntryType.EntryRange, minPrice: 0.79, maxPrice: 0.825 },
      leverage: 20,
      marginType: MarginType.Cross,
      stopLoss: 0.755,
      takeProfits: [
        { price: 0.865, allocationPercentage: 33.33 },
        { price: 0.915, allocationPercentage: 33.33 },
        { price: 0.975, allocationPercentage: 33.34 }
      ]
    });
  });

  void it("parses the same format as a SHORT", () => {
    const signal = parseOk(
      "Coin #ETH/USDT\nPosition: SHORT\nLeverage: Isolated 10x\nEntries: 3200 - 3250\nTargets: 3100, 3000\nStop Loss: 3350"
    );

    assert.equal(signal.side, SignalSide.Short);
    assert.equal(signal.marginType, MarginType.Isolated);
    assert.equal(signal.leverage, 10);
    assert.deepEqual(
      signal.takeProfits.map((takeProfit) => takeProfit.price),
      [3100, 3000]
    );
  });

  void it("reads entry ranges written without spaces as two prices", () => {
    const signal = parseOk("#BTC/USDT LONG\nEntry: 60000-61000\nTP1: 62000\nSL: 59000");
    assert.deepEqual(signal.entry, {
      type: EntryType.EntryRange,
      minPrice: 60000,
      maxPrice: 61000
    });
  });

  void it("reads numbered target lists by price, not by list index", () => {
    const signal = parseOk(
      "ETHUSDT BUY\nEntry 3200\nTargets:\n1) 3300\n2) 3400\nStop 3100"
    );
    assert.deepEqual(
      signal.takeProfits.map((takeProfit) => takeProfit.price),
      [3300, 3400]
    );
  });

  void it("does not invent a symbol from header words", () => {
    const signal = parseOk("Binance Futures\n#SOL SHORT\nEntry 150\nTP1 140\nSL 160");
    assert.equal(signal.symbol, "SOLUSDT");
  });

  void it("rejects a message with no symbol marker instead of guessing", () => {
    const result = parseSignalText("Binance Futures SHORT\nEntry 150\nTP1 140\nSL 160");
    assert.equal(result.success, false);
  });

  void it("ignores stop-loss percentages", () => {
    const signal = parseOk("#XRP/USDT SHORT\nEntry 0.60\nTP 0.55\nSL: 0.65 (8%)");
    assert.equal(signal.stopLoss, 0.65);
  });

  void it("keeps explicit per-target allocations", () => {
    const signal = parseOk("BTCUSDT LONG\nEntry 60000\nTP1 62000 50%\nTP2 64000 50%\nSL 58000");
    assert.deepEqual(
      signal.takeProfits.map((takeProfit) => takeProfit.allocationPercentage),
      [50, 50]
    );
  });

  void it("handles 1000-prefixed meme coins", () => {
    assert.equal(
      parseOk("1000PEPEUSDT SHORT\nEntry: 0.01200\nTP: 0.01100\nSL: 0.01300").symbol,
      "1000PEPEUSDT"
    );
  });

  void it("treats follow-up chatter as not tradable", () => {
    for (const text of ["RLC TP1 hit ✅", "Close half and move SL to entry", "Good morning traders"]) {
      assert.equal(parseSignalText(text).success, false, text);
    }
  });

  void it("rejects a LONG whose stop loss is above the entry", () => {
    const result = parseSignalText(
      "#RLC/USDT\nPosition: LONG\nEntries: 0.8250 - 0.7900\nTargets: 0.8650\nStop Loss: 0.8000"
    );
    assert.equal(result.success, false);
  });
});
