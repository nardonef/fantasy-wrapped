import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encrypts the Yahoo OAuth state/access-token cookie values with
 * AES-256-GCM. Deliberately no new dependency — node:crypto is sufficient
 * and this is the only place in the app that needs authenticated
 * encryption. The access token cookie is the one that actually needs
 * secrecy; the state cookie just reuses this so there's one code path.
 */

export const YAHOO_STATE_COOKIE = "yahoo_oauth_state";
export const YAHOO_TOKEN_COOKIE = "yahoo_access_token";
/** Covers the time a user spends on Yahoo's own consent screen. */
export const YAHOO_STATE_COOKIE_MAX_AGE_S = 10 * 60;
/** Covers callback -> league picker -> sync click. Never extended or refreshed. */
export const YAHOO_TOKEN_COOKIE_MAX_AGE_S = 10 * 60;

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const secret = process.env.YAHOO_COOKIE_SECRET;
  if (!secret) throw new Error("YAHOO_COOKIE_SECRET is not set");
  const key = Buffer.from(secret, "base64");
  if (key.length !== 32) {
    throw new Error("YAHOO_COOKIE_SECRET must decode to 32 bytes (openssl rand -base64 32)");
  }
  return key;
}

export function encryptCookieValue(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64url");
}

export function decryptCookieValue(encoded: string): string | null {
  try {
    const raw = Buffer.from(encoded, "base64url");
    const iv = raw.subarray(0, IV_LENGTH);
    const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  } catch {
    return null;
  }
}
