import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Types, type IndexDefinition, type IndexOptions } from "mongoose";

import {
  DailyStatisticsModel,
  EntryType,
  SignalModel,
  SignalSide,
  SignalStatus,
  TradeExecutionModel,
  ValidationStatus
} from "../models/index.js";
import { validateSignalPriceRelationships } from "../services/signalValidationService.js";

type SchemaIndex = [IndexDefinition, IndexOptions];

const objectId = (): Types.ObjectId => new Types.ObjectId();

const hasIndex = (
  indexes: SchemaIndex[],
  expectedFields: Record<string, 1 | -1>,
  expectedUnique?: boolean
): boolean =>
  indexes.some(([fields, options]) => {
    const hasMatchingFields = Object.entries(expectedFields).every(
      ([fieldName, direction]) => fields[fieldName] === direction
    );

    if (!hasMatchingFields) {
      return false;
    }

    if (expectedUnique === undefined) {
      return true;
    }

    return options.unique === expectedUnique;
  });

void describe("Phase 2 database models", () => {
  void it("validates a valid Signal while preserving the original Telegram message", () => {
    const signal = new SignalModel({
      userId: objectId(),
      telegramSourceId: objectId(),
      telegramMessageId: "telegram-message-1",
      rawText: "BTCUSDT LONG entry 65000 sl 64000 tp 66000 67000",
      symbol: "btcusdt",
      side: SignalSide.Long,
      entry: {
        type: EntryType.Limit,
        price: 65_000
      },
      leverage: 10,
      stopLoss: 64_000,
      takeProfits: [
        {
          price: 66_000,
          allocationPercentage: 50
        },
        {
          price: 67_000,
          allocationPercentage: 50
        }
      ],
      status: SignalStatus.Validated,
      validationStatus: ValidationStatus.Valid
    });

    assert.equal(signal.validateSync(), undefined);
    assert.equal(signal.rawText, "BTCUSDT LONG entry 65000 sl 64000 tp 66000 67000");
    assert.equal(signal.symbol, "BTCUSDT");
  });

  void it("detects invalid LONG take-profit and stop-loss relationships in the validation layer", () => {
    const result = validateSignalPriceRelationships({
      side: SignalSide.Long,
      entry: {
        type: EntryType.Limit,
        price: 100
      },
      stopLoss: 105,
      takeProfits: [
        {
          price: 95,
          allocationPercentage: 100
        }
      ]
    });

    assert.equal(result.isValid, false);
    assert.deepEqual(result.errors, [
      "LONG stop loss must be below entry",
      "LONG take-profit targets must be above entry"
    ]);
  });

  void it("detects invalid SHORT take-profit and stop-loss relationships in the validation layer", () => {
    const result = validateSignalPriceRelationships({
      side: SignalSide.Short,
      entry: {
        type: EntryType.Limit,
        price: 100
      },
      stopLoss: 95,
      takeProfits: [
        {
          price: 105,
          allocationPercentage: 100
        }
      ]
    });

    assert.equal(result.isValid, false);
    assert.deepEqual(result.errors, [
      "SHORT stop loss must be above entry",
      "SHORT take-profit targets must be below entry"
    ]);
  });

  void it("prevents duplicate Telegram messages with a unique source/message index", () => {
    assert.equal(
      hasIndex(
        SignalModel.schema.indexes(),
        {
          telegramSourceId: 1,
          telegramMessageId: 1
        },
        true
      ),
      true
    );
  });

  void it("prevents duplicate TradeExecution records for one signal/account pair", () => {
    assert.equal(
      hasIndex(
        TradeExecutionModel.schema.indexes(),
        {
          signalId: 1,
          binanceAccountId: 1
        },
        true
      ),
      true
    );
  });

  void it("fails validation when total take-profit allocation exceeds 100%", () => {
    const signal = new SignalModel({
      userId: objectId(),
      telegramSourceId: objectId(),
      telegramMessageId: "telegram-message-2",
      rawText: "ETHUSDT LONG entry 3000 sl 2900 tp 3100 3200",
      symbol: "ETHUSDT",
      side: SignalSide.Long,
      entry: {
        type: EntryType.Limit,
        price: 3_000
      },
      leverage: 5,
      stopLoss: 2_900,
      takeProfits: [
        {
          price: 3_100,
          allocationPercentage: 60
        },
        {
          price: 3_200,
          allocationPercentage: 50
        }
      ]
    });

    const validationError = signal.validateSync();

    assert.notEqual(validationError, undefined);
    assert.match(
      validationError?.message ?? "",
      /Total take-profit allocation cannot exceed 100%/
    );
  });

  void it("prevents duplicate DailyStatistics rows for the same user/date", () => {
    assert.equal(
      hasIndex(
        DailyStatisticsModel.schema.indexes(),
        {
          userId: 1,
          date: 1
        },
        true
      ),
      true
    );
  });
});
