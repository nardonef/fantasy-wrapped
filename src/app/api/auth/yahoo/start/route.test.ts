import { beforeEach, describe, expect, it } from "vitest";
import { YAHOO_STATE_COOKIE } from "@/lib/yahoo-cookies";
import { GET } from "./route";

describe("GET /api/auth/yahoo/start", () => {
  beforeEach(() => {
    process.env.YAHOO_CLIENT_ID = "test-client-id";
    process.env.YAHOO_REDIRECT_URI = "https://example.vercel.app/api/auth/yahoo/callback";
  });

  it("redirects to Yahoo's authorization URL and sets a state cookie", async () => {
    const response = await GET();

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin + location.pathname).toBe(
      "https://api.login.yahoo.com/oauth2/request_auth",
    );
    const state = location.searchParams.get("state");
    expect(state).toBeTruthy();

    const cookie = response.cookies.get(YAHOO_STATE_COOKIE);
    expect(cookie?.value).toBe(state);
    expect(cookie?.httpOnly).toBe(true);
  });

  it("sets a different state on every call", async () => {
    const a = await GET();
    const b = await GET();
    const stateA = new URL(a.headers.get("location") ?? "").searchParams.get("state");
    const stateB = new URL(b.headers.get("location") ?? "").searchParams.get("state");
    expect(stateA).not.toBe(stateB);
  });
});
