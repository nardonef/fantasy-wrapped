import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { YAHOO_STATE_COOKIE, YAHOO_TOKEN_COOKIE, decryptCookieValue } from "@/lib/yahoo-cookies";
import * as yahooOauth from "@/lib/yahoo-oauth";
import { GET } from "./route";

function requestWithCookie(url: string, cookieValue?: string): NextRequest {
  const headers = new Headers();
  if (cookieValue) headers.set("cookie", `${YAHOO_STATE_COOKIE}=${cookieValue}`);
  return new NextRequest(url, { headers });
}

describe("GET /api/auth/yahoo/callback", () => {
  beforeEach(() => {
    process.env.YAHOO_COOKIE_SECRET = Buffer.alloc(32, 7).toString("base64");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exchanges the code and redirects to the picker with an encrypted token cookie", async () => {
    vi.spyOn(yahooOauth, "exchangeCodeForToken").mockResolvedValue({
      access_token: "real-access-token",
      token_type: "bearer",
      expires_in: 3600,
    });

    const request = requestWithCookie(
      "https://example.vercel.app/api/auth/yahoo/callback?code=abc&state=xyz",
      "xyz",
    );
    const response = await GET(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://example.vercel.app/connect/yahoo");

    const cookie = response.cookies.get(YAHOO_TOKEN_COOKIE);
    expect(cookie).toBeTruthy();
    expect(decryptCookieValue(cookie?.value ?? "")).toBe("real-access-token");
    expect(response.cookies.get(YAHOO_STATE_COOKIE)?.value).toBe("");
  });

  it("redirects to an error state when state doesn't match (CSRF)", async () => {
    const exchangeSpy = vi.spyOn(yahooOauth, "exchangeCodeForToken");
    const request = requestWithCookie(
      "https://example.vercel.app/api/auth/yahoo/callback?code=abc&state=WRONG",
      "xyz",
    );
    const response = await GET(request);

    expect(response.headers.get("location")).toBe(
      "https://example.vercel.app/?error=yahoo_auth_failed",
    );
    expect(exchangeSpy).not.toHaveBeenCalled();
  });

  it("redirects to an error state when the token exchange throws", async () => {
    vi.spyOn(yahooOauth, "exchangeCodeForToken").mockRejectedValue(new Error("boom"));
    const request = requestWithCookie(
      "https://example.vercel.app/api/auth/yahoo/callback?code=abc&state=xyz",
      "xyz",
    );
    const response = await GET(request);
    expect(response.headers.get("location")).toBe(
      "https://example.vercel.app/?error=yahoo_auth_failed",
    );
  });
});
