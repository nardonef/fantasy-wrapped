import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAuthorizationUrl, exchangeCodeForToken } from "./yahoo-oauth";

describe("buildAuthorizationUrl", () => {
  beforeEach(() => {
    process.env.YAHOO_CLIENT_ID = "test-client-id";
    process.env.YAHOO_REDIRECT_URI = "https://example.vercel.app/api/auth/yahoo/callback";
  });

  it("builds the Yahoo authorization URL with required params", () => {
    const url = new URL(buildAuthorizationUrl("state-123"));
    expect(url.origin + url.pathname).toBe("https://api.login.yahoo.com/oauth2/request_auth");
    expect(url.searchParams.get("client_id")).toBe("test-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://example.vercel.app/api/auth/yahoo/callback",
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("fspt-r");
    expect(url.searchParams.get("state")).toBe("state-123");
  });

  it("throws a clear error when YAHOO_CLIENT_ID is unset", () => {
    delete process.env.YAHOO_CLIENT_ID;
    expect(() => buildAuthorizationUrl("state-123")).toThrow("YAHOO_CLIENT_ID");
  });
});

describe("exchangeCodeForToken", () => {
  beforeEach(() => {
    process.env.YAHOO_CLIENT_ID = "test-client-id";
    process.env.YAHOO_CLIENT_SECRET = "test-secret";
    process.env.YAHOO_REDIRECT_URI = "https://example.vercel.app/api/auth/yahoo/callback";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts to Yahoo's token endpoint with basic auth and returns the parsed token", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ access_token: "abc", token_type: "bearer", expires_in: 3600 }),
        {
          status: 200,
        },
      ),
    );

    const token = await exchangeCodeForToken("auth-code-xyz");

    expect(token).toEqual({ access_token: "abc", token_type: "bearer", expires_in: 3600 });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.login.yahoo.com/oauth2/get_token");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toBe(
      `Basic ${Buffer.from("test-client-id:test-secret").toString("base64")}`,
    );
    const body = new URLSearchParams(init?.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("auth-code-xyz");
    expect(body.get("redirect_uri")).toBe("https://example.vercel.app/api/auth/yahoo/callback");
  });

  it("throws when Yahoo returns a non-2xx status", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("bad request", { status: 400 }));
    await expect(exchangeCodeForToken("bad-code")).rejects.toThrow("Yahoo token exchange failed");
  });
});
