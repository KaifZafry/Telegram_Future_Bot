import {
  createHmac,
  randomBytes,
  scrypt,
  timingSafeEqual,
  type ScryptOptions
} from "node:crypto";

const SCRYPT_PARAMS: ScryptOptions = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

const scryptAsync = (password: string, salt: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, SCRYPT_PARAMS, (error, key) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(key);
    });
  });

/** Format: `scrypt:<salt b64>:<hash b64>`. */
export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt);
  return `scrypt:${salt.toString("base64")}:${hash.toString("base64")}`;
};

export const verifyPassword = async (password: string, stored: string): Promise<boolean> => {
  const [scheme, salt, hash] = stored.split(":");

  if (scheme !== "scrypt" || !salt || !hash) {
    return false;
  }

  const expected = Buffer.from(hash, "base64");
  const actual = await scryptAsync(password, Buffer.from(salt, "base64"));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

export interface SessionPayload {
  sub: string;
  exp: number;
}

const sign = (payload: string, secret: string): string =>
  createHmac("sha256", secret).update(payload).digest("base64url");

/** Compact signed token: `<payload b64url>.<hmac>`. */
export const createSessionToken = (userId: string, secret: string): string => {
  const payload = Buffer.from(
    JSON.stringify({
      sub: userId,
      exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
    } satisfies SessionPayload)
  ).toString("base64url");

  return `${payload}.${sign(payload, secret)}`;
};

export const verifySessionToken = (
  token: string,
  secret: string
): SessionPayload | undefined => {
  const [payload, signature] = token.split(".");

  if (!payload || !signature) {
    return undefined;
  }

  const expected = Buffer.from(sign(payload, secret));
  const actual = Buffer.from(signature);

  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return undefined;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString()) as SessionPayload;
    return session.exp > Date.now() / 1000 ? session : undefined;
  } catch {
    return undefined;
  }
};
