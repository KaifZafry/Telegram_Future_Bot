import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EntryType, SignalSide } from "../models/index.js";
import { floorToStep, roundToStep } from "../modules/binance/binance.math.js";
import { buildExecutionPlan, type PlanInput } from "../modules/binance/binance.planner.js";
import type { SymbolRules } from "../modules/binance/binance.types.js";
import { AesGcmCredentialEncryptionService } from "../services/credentialEncryptionService.js";

const RULES: SymbolRules = {
  symbol: "RLCUSDT",
  status: "TRADING",
  tickSize: "0.0001",
  stepSize: "0.1",
  minQty: 0.1,
  marketStepSize: "0.1",
  marketMinQty: 0.1,
  minNotional: 5
};

const rlcLong = (overrides: Partial<PlanInput> = {}): PlanInput => ({
  symbol: "RLCUSDT",
  side: SignalSide.Long,
  entry: { type: EntryType.EntryRange, minPrice: 0.79, maxPrice: 0.825 },
  stopLoss: 0.755,
  takeProfits: [
    { price: 0.865, allocationPercentage: 33.33 },
    { price: 0.915, allocationPercentage: 33.33 },
    { price: 0.975, allocationPercentage: 33.34 }
  ],
  markPrice: 0.84,
  marginUsdt: 10,
  leverage: 20,
  entryOrderCount: 3,
  rules: RULES,
  ...overrides
});

const plan = (input: PlanInput) => {
  const result = buildExecutionPlan(input);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.plan;
};

void describe("Binance step rounding", () => {
  void it("floors quantities and rounds prices to exchange steps without float noise", () => {
    assert.equal(floorToStep(74.59, "0.1"), "74.5");
    assert.equal(floorToStep(0.3, "0.1"), "0.3");
    assert.equal(floorToStep(1234.9, "1"), "1234");
    assert.equal(roundToStep(0.80749999, "0.0001"), "0.8075");
    assert.equal(roundToStep(60000.04, "0.10"), "60000.0");
  });
});

void describe("Execution planner", () => {
  void it("splits an entry range into limit orders from the near edge when price is above it", () => {
    const { legs, entrySide, exitSide, stopLoss, notionalUsdt } = plan(rlcLong());

    assert.equal(entrySide, "BUY");
    assert.equal(exitSide, "SELL");
    assert.equal(stopLoss, "0.7550");
    assert.equal(notionalUsdt, 200);
    assert.deepEqual(
      legs.map((leg) => [leg.type, leg.price]),
      [
        ["LIMIT", "0.8250"],
        ["LIMIT", "0.8075"],
        ["LIMIT", "0.7900"]
      ]
    );
    // 200 USDT at an average 0.8075 is ~247.6 RLC, ~82.5 per leg.
    legs.forEach((leg) => assert.equal(leg.quantity, "82.5"));
  });

  void it("fills the part of the range price has already reached at market", () => {
    const { legs } = plan(rlcLong({ markPrice: 0.8 }));

    assert.deepEqual(
      legs.map((leg) => leg.type),
      ["MARKET", "LIMIT"]
    );
    assert.equal(legs[1]?.price, "0.7900");
    assert.ok(Number(legs[0]?.quantity) > Number(legs[1]?.quantity));
  });

  void it("mirrors the range for SHORT signals", () => {
    const { legs, entrySide } = plan(
      rlcLong({
        side: SignalSide.Short,
        entry: { type: EntryType.EntryRange, minPrice: 0.825, maxPrice: 0.86 },
        stopLoss: 0.9,
        takeProfits: [{ price: 0.78, allocationPercentage: 100 }],
        markPrice: 0.81
      })
    );

    assert.equal(entrySide, "SELL");
    assert.deepEqual(
      legs.map((leg) => leg.price),
      ["0.8250", "0.8425", "0.8600"]
    );
  });

  void it("uses fewer entry orders when the margin is too small for three", () => {
    const { legs } = plan(rlcLong({ marginUsdt: 0.6 }));
    // 0.6 x 20 = 12 USDT: three ~4 USDT legs are under the 5 USDT minimum.
    assert.equal(legs.length, 2);
    legs.forEach((leg) => assert.ok(Number(leg.quantity) * leg.referencePrice >= 5));
  });

  void it("rejects when even one order is below the exchange minimum", () => {
    const result = buildExecutionPlan(rlcLong({ marginUsdt: 0.2 }));
    assert.equal(result.ok, false);
  });

  void it("rejects a signal whose TP1 has already been reached", () => {
    const result = buildExecutionPlan(rlcLong({ markPrice: 0.9 }));
    assert.deepEqual(result.ok, false);
    assert.match((result as { reason: string }).reason, /TP1/);
  });

  void it("rejects a signal when price is already through the stop loss", () => {
    const result = buildExecutionPlan(rlcLong({ markPrice: 0.75 }));
    assert.match((result as { reason: string }).reason, /stop loss/);
  });

  void it("rejects symbols that are not trading", () => {
    const result = buildExecutionPlan(rlcLong({ rules: { ...RULES, status: "SETTLING" } }));
    assert.equal(result.ok, false);
  });
});

void describe("Credential encryption", () => {
  const key = Buffer.alloc(32, 7).toString("base64");

  void it("round-trips and never stores the plain text", async () => {
    const service = new AesGcmCredentialEncryptionService(key);
    const cipherText = await service.encrypt("my-binance-secret");

    assert.equal(cipherText.includes("my-binance-secret"), false);
    assert.equal(await service.decrypt(cipherText), "my-binance-secret");
  });

  void it("refuses to decrypt with the wrong key", async () => {
    const cipherText = await new AesGcmCredentialEncryptionService(key).encrypt("secret");
    const other = new AesGcmCredentialEncryptionService(Buffer.alloc(32, 9).toString("base64"));

    await assert.rejects(() => other.decrypt(cipherText));
  });
});
