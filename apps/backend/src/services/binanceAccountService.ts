import type { Types } from "mongoose";

import { env } from "../config/env.js";
import {
  BinanceAccountModel,
  BinancePermission,
  type BinanceEnvironment
} from "../models/index.js";
import { BinanceFuturesClient } from "../modules/binance/binance.client.js";
import { BINANCE_BASE_URLS } from "../modules/binance/binance.types.js";
import { AesGcmCredentialEncryptionService } from "./credentialEncryptionService.js";

export interface AccountCheck {
  ok: boolean;
  availableBalance?: number;
  hedgeMode?: boolean;
  error?: string;
}

export const checkBinanceCredentials = async (
  environment: BinanceEnvironment,
  apiKey: string,
  apiSecret: string
): Promise<AccountCheck> => {
  const client = new BinanceFuturesClient({
    baseUrl: BINANCE_BASE_URLS[environment],
    credentials: { apiKey, apiSecret }
  });

  try {
    const [availableBalance, hedgeMode] = await Promise.all([
      client.getAvailableBalance(),
      client.isHedgeMode()
    ]);
    return { ok: true, availableBalance, hedgeMode };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};

/** Stores (or replaces, by name) a Binance account with encrypted keys. */
export const saveBinanceAccount = async (input: {
  userId: Types.ObjectId;
  name: string;
  environment: BinanceEnvironment;
  apiKey: string;
  apiSecret: string;
}): Promise<Types.ObjectId> => {
  if (!env.CREDENTIALS_ENCRYPTION_KEY) {
    throw new Error("CREDENTIALS_ENCRYPTION_KEY must be set before adding Binance accounts");
  }

  const encryption = new AesGcmCredentialEncryptionService(env.CREDENTIALS_ENCRYPTION_KEY);
  const account = await BinanceAccountModel.findOneAndUpdate(
    { userId: input.userId, name: input.name },
    {
      $set: {
        apiKeyEncrypted: await encryption.encrypt(input.apiKey),
        apiSecretEncrypted: await encryption.encrypt(input.apiSecret),
        environment: input.environment,
        isActive: true,
        permissions: [BinancePermission.Read, BinancePermission.Trade, BinancePermission.Futures]
      }
    },
    { upsert: true, new: true }
  );

  return account._id;
};
