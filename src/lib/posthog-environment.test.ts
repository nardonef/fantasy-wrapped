import { afterEach, describe, expect, it } from "vitest";
import { getPostHogEnvironment } from "./posthog-environment";

describe("getPostHogEnvironment", () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it("reads VERCEL_ENV=production", () => {
    process.env.VERCEL_ENV = "production";
    expect(getPostHogEnvironment()).toBe("production");
  });

  it("reads VERCEL_ENV=preview", () => {
    process.env.VERCEL_ENV = "preview";
    expect(getPostHogEnvironment()).toBe("preview");
  });

  it("falls back to NEXT_PUBLIC_VERCEL_ENV when VERCEL_ENV is unset (browser bundle)", () => {
    process.env.VERCEL_ENV = undefined;
    process.env.NEXT_PUBLIC_VERCEL_ENV = "production";
    expect(getPostHogEnvironment()).toBe("production");
  });

  it("defaults to development when neither var is set or set to something else", () => {
    process.env.VERCEL_ENV = undefined;
    process.env.NEXT_PUBLIC_VERCEL_ENV = undefined;
    expect(getPostHogEnvironment()).toBe("development");

    process.env.VERCEL_ENV = "development";
    expect(getPostHogEnvironment()).toBe("development");
  });
});
