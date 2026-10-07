import type { BinanceEnvironment } from "../../models/index.js";
import {
  BinanceAccountModel,
  type BinanceAccount
} from "../../models/index.js";
import {
  createCredentialEncryptionService,
  type CredentialEncryptionService
} from "../../services/credentialEncryptionService.js";
import { BinanceFuturesClient } from "./binance.client.js";
import { BINANCE_BASE_URLS } from "./binance.types.js";

const publicClients = new Map<BinanceEnvironment, BinanceFuturesClient>();

/** Unauthenticated client for market data (exchange rules, mark price). */
export const getPublicClient = (environment: BinanceEnvironment): BinanceFuturesClient => {
  let client = publicClients.get(environment);

  if (!client) {
    client = new BinanceFuturesClient({ baseUrl: BINANCE_BASE_URLS[environment] });
    publicClients.set(environment, client);
  }

  return client;
};

/** Builds and caches one authenticated client per Binance account. */
export class BinanceAccountClientRegistry {
  private readonly clients = new Map<string, BinanceFuturesClient>();
  private readonly encryption: CredentialEncryptionService;

  public constructor(encryption?: CredentialEncryptionService) {
    this.encryption = createCredentialEncryptionService(encryption);
  }

  /** Drops a cached client so the next use reloads keys and environment. */
  public invalidate(accountId: string): void {
    this.clients.delete(accountId);
  }

  public async get(accountId: string): Promise<BinanceFuturesClient> {
    const cached = this.clients.get(accountId);

    if (cached) {
      return cached;
    }

    const account = await BinanceAccountModel.findById(accountId)
      .select("+apiKeyEncrypted +apiSecretEncrypted")
      .lean<(BinanceAccount & { _id: unknown }) | null>();

    if (!account) {
      throw new Error(`Binance account ${accountId} not found`);
    }

    const client = new BinanceFuturesClient({
      baseUrl: BINANCE_BASE_URLS[account.environment],
      credentials: {
        apiKey: await this.encryption.decrypt(account.apiKeyEncrypted),
        apiSecret: await this.encryption.decrypt(account.apiSecretEncrypted)
      }
    });
    this.clients.set(accountId, client);

    return client;
  }
}
