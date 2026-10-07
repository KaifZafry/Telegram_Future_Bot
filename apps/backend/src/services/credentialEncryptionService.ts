import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface CredentialEncryptionService {
  encrypt(plainText: string): Promise<string>;
  decrypt(cipherText: string): Promise<string>;
}

export class CredentialEncryptionNotConfiguredError extends Error {
  public constructor() {
    super("Credential encryption service is not configured");
    this.name = "CredentialEncryptionNotConfiguredError";
  }
}

export class UnconfiguredCredentialEncryptionService
  implements CredentialEncryptionService
{
  public encrypt(_plainText: string): Promise<string> {
    throw new CredentialEncryptionNotConfiguredError();
  }

  public decrypt(_cipherText: string): Promise<string> {
    throw new CredentialEncryptionNotConfiguredError();
  }
}

const CIPHER_VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

export const parseEncryptionKey = (rawKey: string): Buffer => {
  const trimmedKey = rawKey.trim();
  const key = /^[0-9a-f]{64}$/i.test(trimmedKey)
    ? Buffer.from(trimmedKey, "hex")
    : Buffer.from(trimmedKey, "base64");

  if (key.length !== 32) {
    throw new Error(
      "CREDENTIALS_ENCRYPTION_KEY must be 32 bytes encoded as base64 or 64 hex characters"
    );
  }

  return key;
};

/**
 * AES-256-GCM encryption. Output format: `v1:<iv>:<authTag>:<cipherText>`,
 * each part base64 encoded. GCM authenticates the payload, so a tampered or
 * wrongly-keyed value fails to decrypt instead of producing garbage.
 */
export class AesGcmCredentialEncryptionService implements CredentialEncryptionService {
  private readonly key: Buffer;

  public constructor(rawKey: string) {
    this.key = parseEncryptionKey(rawKey);
  }

  public encrypt(plainText: string): Promise<string> {
    return new Promise((resolve) => {
      resolve(this.encryptSync(plainText));
    });
  }

  public decrypt(cipherText: string): Promise<string> {
    return new Promise((resolve) => {
      resolve(this.decryptSync(cipherText));
    });
  }

  private encryptSync(plainText: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return [CIPHER_VERSION, iv, authTag, encrypted]
      .map((part) => (typeof part === "string" ? part : part.toString("base64")))
      .join(":");
  }

  private decryptSync(cipherText: string): string {
    const [version, iv, authTag, encrypted] = cipherText.split(":");

    if (version !== CIPHER_VERSION || !iv || !authTag || !encrypted) {
      throw new Error("Unsupported credential cipher format");
    }

    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(authTag, "base64"));

    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64")),
      decipher.final()
    ]).toString("utf8");
  }
}

export const createCredentialEncryptionService = (
  service?: CredentialEncryptionService
): CredentialEncryptionService => {
  if (service) {
    return service;
  }

  const rawKey = process.env.CREDENTIALS_ENCRYPTION_KEY?.trim();

  return rawKey
    ? new AesGcmCredentialEncryptionService(rawKey)
    : new UnconfiguredCredentialEncryptionService();
};
