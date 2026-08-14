import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptCookieValue, encryptCookieValue } from "./yahoo-cookies";

describe("yahoo cookie encryption", () => {
  const ORIGINAL_SECRET = process.env.YAHOO_COOKIE_SECRET;

  beforeEach(() => {
    // 32 raw bytes, base64-encoded — same shape `openssl rand -base64 32` produces.
    process.env.YAHOO_COOKIE_SECRET = Buffer.alloc(32, 7).toString("base64");
  });

  afterEach(() => {
    process.env.YAHOO_COOKIE_SECRET = ORIGINAL_SECRET;
  });

  it("round-trips a plaintext value", () => {
    const encrypted = encryptCookieValue("my-access-token");
    expect(encrypted).not.toContain("my-access-token");
    expect(decryptCookieValue(encrypted)).toBe("my-access-token");
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const a = encryptCookieValue("same-input");
    const b = encryptCookieValue("same-input");
    expect(a).not.toBe(b);
  });

  it("returns null for garbage input instead of throwing", () => {
    expect(decryptCookieValue("not-a-real-encrypted-value")).toBeNull();
  });

  it("returns null when the key doesn't match (tampered or wrong secret)", () => {
    const encrypted = encryptCookieValue("my-access-token");
    process.env.YAHOO_COOKIE_SECRET = Buffer.alloc(32, 9).toString("base64");
    expect(decryptCookieValue(encrypted)).toBeNull();
  });

  it("throws a clear error when YAHOO_COOKIE_SECRET is unset", () => {
    process.env.YAHOO_COOKIE_SECRET = undefined;
    expect(() => encryptCookieValue("x")).toThrow("YAHOO_COOKIE_SECRET");
  });
});
