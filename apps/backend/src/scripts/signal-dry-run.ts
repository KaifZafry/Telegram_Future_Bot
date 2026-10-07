import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { BinanceEnvironment } from "../models/index.js";
import { previewSignal } from "../modules/trading/trading.preview.js";

/**
 * Shows exactly what the bot would do with a signal message, using live market
 * data, without placing any orders or needing a database.
 *
 *   npm run signal:dry-run -- --file signal.txt --margin 10
 *   echo "..." | npm run signal:dry-run
 */
const main = async (): Promise<void> => {
  const { values } = parseArgs({
    options: {
      file: { type: "string" },
      margin: { type: "string", default: "10" },
      leverage: { type: "string", default: "10" },
      "max-leverage": { type: "string", default: "20" },
      entries: { type: "string", default: "3" },
      testnet: { type: "boolean", default: false }
    }
  });

  const text = values.file ? readFileSync(values.file, "utf8") : readFileSync(0, "utf8");
  const preview = await previewSignal(text, {
    marginUsdt: Number(values.margin),
    defaultLeverage: Number(values.leverage),
    maxLeverage: Number(values["max-leverage"]),
    entryOrderCount: Number(values.entries),
    environment: values.testnet ? BinanceEnvironment.Testnet : BinanceEnvironment.Live
  });

  console.log("=== Parsed signal ===");
  console.log(JSON.stringify(preview.parsed, null, 2));

  if (preview.market) {
    const { markPrice, tickSize, stepSize, minNotional } = preview.market;
    console.log(`\n=== Market (${preview.environment}) ===`);
    console.log(`Mark price ${markPrice} | tick ${tickSize} | step ${stepSize} | min notional ${minNotional}`);
  }

  const { plan } = preview;

  if (!plan) {
    console.log(`\nNot tradable: ${preview.rejection ?? "unknown reason"}`);
    return;
  }

  console.log("\n=== Orders the bot would place ===");
  console.log(`Margin ${plan.marginUsdt} USDT x ${plan.leverage} = ${plan.notionalUsdt} USDT position`);
  console.log(`1. STOP_MARKET ${plan.exitSide} close-position @ ${plan.stopLoss}`);
  plan.legs.forEach((leg, index) =>
    console.log(`${index + 2}. ${leg.type} ${plan.entrySide} ${leg.quantity} ${leg.type === "LIMIT" ? `@ ${leg.price}` : `(~${leg.referencePrice})`}`)
  );
  console.log("Then, as entries fill, reduce-only take profits sized to the filled quantity:");
  plan.takeProfits.forEach((takeProfit, index) =>
    console.log(`   TP${index + 1} ${plan.exitSide} @ ${takeProfit.price} (${takeProfit.allocationPercentage}%)`)
  );
  console.log(
    `\nIf fully filled: avg entry ~${plan.averageEntryPrice.toFixed(6)}, loss at SL ~${(preview.lossAtStopUsdt ?? 0).toFixed(2)} USDT`
  );
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
