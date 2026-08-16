# Yahoo Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Yahoo Fantasy Sports adapter and OAuth connect flow so a manager can generate
their Wrapped from a real Yahoo league, matching Sleeper's existing capability end to end
(landing page → auth/discovery → sync → story).

**Architecture:** OAuth 2.0 authorization-code flow (`/api/auth/yahoo/start`,
`/api/auth/yahoo/callback`) bridges an access token to the browser via a short-lived
encrypted cookie — never persisted to Postgres. A new `src/providers/yahoo/` adapter,
structured identically to `src/providers/sleeper/`, turns Yahoo's raw JSON into the same
`NormalizedLeagueBundle` Sleeper already produces, so `persistBundle`, the engine, and the
story player need zero changes. A new `/connect/yahoo` picker page and `/api/yahoo/sync`
route mirror the existing Sleeper landing flow.

**Tech Stack:** Next.js App Router route handlers, `node:crypto` (AES-256-GCM, no new
dependency), zod v4, Vitest, Playwright.

## Global Constraints

- No refresh-token persistence — the access token lives only in an encrypted, httpOnly,
  ~10-minute cookie between the OAuth callback and the sync click, per
  `docs/superpowers/specs/2026-08-11-yahoo-integration-design.md`.
- Adapter file split mirrors `src/providers/sleeper/` exactly: `client.ts` / `schemas.ts` /
  `normalize.ts` / `index.ts`, same two-function public surface
  (`fetchYahooPayloads`/`fetchYahooLeagueBundle`), same `NormalizedLeagueBundle` output.
- `/api/yahoo/sync` is a separate route from `/api/sync` (not a provider branch).
- No `http://localhost` redirect URI — OAuth is tested against a deployed Vercel URL, not
  `pnpm dev`.
- The engine (`src/engine/`) stays untouched — this plan only adds an adapter and routes
  upstream of it.
- Run `./node_modules/.bin/biome check .` and `./node_modules/.bin/vitest run` directly,
  never via `pnpm lint`/`pnpm test` (this machine's RTK hook rewrites their output and has
  previously reported a false "no issues found").
- Every new user-facing flow ships with a Playwright e2e test before it's done (CLAUDE.md
  rule, same as the engine's golden-file requirement).

---

## Important: this plan has one human-in-the-loop task

Yahoo's Fantasy Sports API has no sandbox and no public schema registry — the only way to
know its *exact* JSON field names and nesting is to query it with a real authorized token.
I verified the pieces that are independently documented (OAuth endpoints, base URL, resource
path conventions, the "numbered collection" and "single-key shard array" JSON quirks, and a
comprehensive field list pulled from `yfpy`, a maintained open-source Yahoo Fantasy API
wrapper's real parsing code) and used those to write real, testable code against a
hand-built fixture that matches all of those documented conventions. That fixture is
internally consistent but **is not a real Yahoo response** — Task 14 is where it gets
checked against one, using your actual Yahoo league, and any mismatch gets fixed on the
spot. This is the same fixture-driven discipline the Sleeper adapter already uses
(`fixtures/sleeper/`, `scripts/record-fixtures.ts`) — Task 14 is just where that discipline
starts for Yahoo. Tasks 1–13 do not require your Yahoo credentials to build or test.

---

### Task 1: Cookie encryption helper

**Files:**
- Create: `src/lib/yahoo-cookies.ts`
- Test: `src/lib/yahoo-cookies.test.ts`

**Interfaces:**
- Produces: `encryptCookieValue(plaintext: string): string`,
  `decryptCookieValue(encoded: string): string | null`, and the constants
  `YAHOO_STATE_COOKIE`, `YAHOO_TOKEN_COOKIE`, `YAHOO_STATE_COOKIE_MAX_AGE_S`,
  `YAHOO_TOKEN_COOKIE_MAX_AGE_S` — consumed by Tasks 3, 4, 10, 11.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/yahoo-cookies.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run src/lib/yahoo-cookies.test.ts`
Expected: FAIL — `Cannot find module './yahoo-cookies'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/yahoo-cookies.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run src/lib/yahoo-cookies.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/yahoo-cookies.ts src/lib/yahoo-cookies.test.ts
git commit -m "feat(yahoo): add cookie encryption helper"
```

---

### Task 2: OAuth URL builder and token exchange

**Files:**
- Create: `src/lib/yahoo-oauth.ts`
- Test: `src/lib/yahoo-oauth.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `buildAuthorizationUrl(state: string): string`,
  `exchangeCodeForToken(code: string): Promise<YahooTokenResponse>`, and the type
  `YahooTokenResponse = { access_token: string; token_type: string; expires_in: number }` —
  consumed by Tasks 3 and 4.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/yahoo-oauth.test.ts
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
    expect(url.searchParams.get("state")).toBe("state-123");
  });

  it("throws a clear error when YAHOO_CLIENT_ID is unset", () => {
    process.env.YAHOO_CLIENT_ID = undefined;
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
      new Response(JSON.stringify({ access_token: "abc", token_type: "bearer", expires_in: 3600 }), {
        status: 200,
      }),
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run src/lib/yahoo-oauth.test.ts`
Expected: FAIL — `Cannot find module './yahoo-oauth'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/yahoo-oauth.ts
const AUTHORIZATION_URL = "https://api.login.yahoo.com/oauth2/request_auth";
const TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function buildAuthorizationUrl(state: string): string {
  const url = new URL(AUTHORIZATION_URL);
  url.searchParams.set("client_id", requireEnv("YAHOO_CLIENT_ID"));
  url.searchParams.set("redirect_uri", requireEnv("YAHOO_REDIRECT_URI"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  return url.toString();
}

export type YahooTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

/** Exchanges an authorization code for an access token. Never requests a refresh
 * token grant later — this app deliberately never persists one. */
export async function exchangeCodeForToken(code: string): Promise<YahooTokenResponse> {
  const clientId = requireEnv("YAHOO_CLIENT_ID");
  const clientSecret = requireEnv("YAHOO_CLIENT_SECRET");
  const redirectUri = requireEnv("YAHOO_REDIRECT_URI");
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
    }),
  });

  if (!res.ok) {
    throw new Error(`Yahoo token exchange failed: ${res.status}`);
  }
  const data = await res.json();
  if (typeof data.access_token !== "string") {
    throw new Error("Yahoo token response missing access_token");
  }
  return data as YahooTokenResponse;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run src/lib/yahoo-oauth.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/yahoo-oauth.ts src/lib/yahoo-oauth.test.ts
git commit -m "feat(yahoo): add OAuth authorization URL and token exchange"
```

---

### Task 3: `/api/auth/yahoo/start` route

**Files:**
- Create: `src/app/api/auth/yahoo/start/route.ts`
- Test: `src/app/api/auth/yahoo/start/route.test.ts`

**Interfaces:**
- Consumes: `buildAuthorizationUrl` (Task 2); `YAHOO_STATE_COOKIE`,
  `YAHOO_STATE_COOKIE_MAX_AGE_S` (Task 1).
- Produces: `GET` route handler redirecting to Yahoo with a `state` cookie set — consumed by
  the "Connect Yahoo" link added in Task 13.

- [ ] **Step 1: Write the failing test**

```typescript
// src/app/api/auth/yahoo/start/route.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run src/app/api/auth/yahoo/start/route.test.ts`
Expected: FAIL — `Cannot find module './route'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/app/api/auth/yahoo/start/route.ts
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { YAHOO_STATE_COOKIE, YAHOO_STATE_COOKIE_MAX_AGE_S } from "@/lib/yahoo-cookies";
import { buildAuthorizationUrl } from "@/lib/yahoo-oauth";

export const dynamic = "force-dynamic";

/** Kicks off the Yahoo OAuth flow. No request body — the "Connect Yahoo" link on the
 * landing page just navigates the browser here. */
export async function GET() {
  const state = randomBytes(16).toString("base64url");
  const response = NextResponse.redirect(buildAuthorizationUrl(state));
  response.cookies.set(YAHOO_STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: YAHOO_STATE_COOKIE_MAX_AGE_S,
    path: "/",
  });
  return response;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run src/app/api/auth/yahoo/start/route.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/auth/yahoo/start
git commit -m "feat(yahoo): add OAuth start route"
```

---

### Task 4: `/api/auth/yahoo/callback` route

**Files:**
- Create: `src/app/api/auth/yahoo/callback/route.ts`
- Test: `src/app/api/auth/yahoo/callback/route.test.ts`

**Interfaces:**
- Consumes: `exchangeCodeForToken` (Task 2); `YAHOO_STATE_COOKIE`, `YAHOO_TOKEN_COOKIE`,
  `YAHOO_TOKEN_COOKIE_MAX_AGE_S`, `encryptCookieValue`, `decryptCookieValue` (Task 1).
- Produces: `GET` route handler that verifies CSRF state, exchanges the code, and redirects
  to `/connect/yahoo` with an encrypted token cookie — the picker page (Task 12) and
  `/api/yahoo/leagues` (Task 10) depend on that cookie being present afterward.

- [ ] **Step 1: Write the failing test**

```typescript
// src/app/api/auth/yahoo/callback/route.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run src/app/api/auth/yahoo/callback/route.test.ts`
Expected: FAIL — `Cannot find module './route'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/app/api/auth/yahoo/callback/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  YAHOO_STATE_COOKIE,
  YAHOO_TOKEN_COOKIE,
  YAHOO_TOKEN_COOKIE_MAX_AGE_S,
  encryptCookieValue,
} from "@/lib/yahoo-cookies";
import { exchangeCodeForToken } from "@/lib/yahoo-oauth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = request.cookies.get(YAHOO_STATE_COOKIE)?.value;

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(new URL("/?error=yahoo_auth_failed", request.url));
  }

  let token: Awaited<ReturnType<typeof exchangeCodeForToken>>;
  try {
    token = await exchangeCodeForToken(code);
  } catch (error) {
    console.error("Yahoo token exchange failed", error);
    return NextResponse.redirect(new URL("/?error=yahoo_auth_failed", request.url));
  }

  const response = NextResponse.redirect(new URL("/connect/yahoo", request.url));
  response.cookies.set(YAHOO_TOKEN_COOKIE, encryptCookieValue(token.access_token), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: YAHOO_TOKEN_COOKIE_MAX_AGE_S,
    path: "/",
  });
  response.cookies.delete(YAHOO_STATE_COOKIE);
  return response;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run src/app/api/auth/yahoo/callback/route.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/auth/yahoo/callback
git commit -m "feat(yahoo): add OAuth callback route"
```

---

### Task 5: Yahoo JSON shape cleaner

Yahoo's `?format=json` output is a naive XML→JSON conversion applied at every depth:
collections come back keyed by numeric-string index plus a `count` field
(`{"0": {...}, "1": {...}, "count": 2}`), and a resource with multiple attributes/sub-resources
comes back as an array where each element holds exactly one of them
(`[{"league_key": "..."}, {"name": "..."}, {"settings": [...]}]`) instead of one flat object.
This task writes one generic, thoroughly-tested function that turns both patterns (and a
single-element array redundantly wrapping one sub-resource, which Yahoo also does) into plain
arrays/objects, so nothing downstream has to think about Yahoo's wire format.

**Files:**
- Create: `src/providers/yahoo/yahoo-json.ts`
- Test: `src/providers/yahoo/yahoo-json.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `cleanYahoo(value: unknown): unknown` — consumed by Task 8 (normalize).

- [ ] **Step 1: Write the failing test**

```typescript
// src/providers/yahoo/yahoo-json.test.ts
import { describe, expect, it } from "vitest";
import { cleanYahoo } from "./yahoo-json";

describe("cleanYahoo", () => {
  it("converts a numbered collection to a plain array, dropping count", () => {
    const input = { "0": "a", "1": "b", count: 2 };
    expect(cleanYahoo(input)).toEqual(["a", "b"]);
  });

  it("merges an array of single-key shards (distinct keys) into one object", () => {
    const input = [{ league_key: "423.l.1" }, { name: "My League" }];
    expect(cleanYahoo(input)).toEqual({ league_key: "423.l.1", name: "My League" });
  });

  it("merges shards that mix single- and multi-key objects, as long as no key repeats", () => {
    const input = [
      [{ team_key: "423.l.1.t.1" }, { name: "Dynasty Warriors" }],
      { team_points: { total: "120.5" } },
    ];
    expect(cleanYahoo(input)).toEqual({
      team_key: "423.l.1.t.1",
      name: "Dynasty Warriors",
      team_points: { total: "120.5" },
    });
  });

  it("unwraps a list of same-key-wrapped items into a plain array, without merging them", () => {
    const input = [{ roster_position: { position: "QB" } }, { roster_position: { position: "RB" } }];
    expect(cleanYahoo(input)).toEqual([{ position: "QB" }, { position: "RB" }]);
  });

  it("unwraps even a single same-key-wrapped item (still a list of one)", () => {
    const input = [{ manager: { guid: "ABC123", nickname: "Frank" } }];
    expect(cleanYahoo(input)).toEqual([{ guid: "ABC123", nickname: "Frank" }]);
  });

  it("unwraps a redundant one-element array wrapping a whole sub-resource", () => {
    const input = [{ playoff_start_week: "15", num_playoff_teams: "6" }];
    expect(cleanYahoo(input)).toEqual({ playoff_start_week: "15", num_playoff_teams: "6" });
  });

  it("leaves an unrelated plain array untouched", () => {
    expect(cleanYahoo(["QB", "RB", "WR"])).toEqual(["QB", "RB", "WR"]);
  });

  it("recurses into nested objects and arrays, applying the same-key-unwrap rule at every depth", () => {
    // A numbered collection of one item whose sole element is itself a
    // single-key wrapper ({"inner": {...}}) is structurally identical to
    // the manager/matchup cases above — same-key-unwrap correctly fires
    // here too (this is the same rule, not a special case).
    const input = { outer: { "0": { inner: [{ a: 1 }, { b: 2 }] }, count: 1 } };
    expect(cleanYahoo(input)).toEqual({ outer: [{ a: 1, b: 2 }] });
  });

  it("cleans a realistic nested league+scoreboard+matchup+teams shape end to end", () => {
    const rawTeam = (key: string, name: string, points: string) => ({
      team: [[{ team_key: key }, { name }], { team_points: { total: points } }],
    });
    const input = {
      fantasy_content: {
        league: [
          { league_key: "423.l.11184" },
          {
            scoreboard: [
              { week: "5" },
              {
                matchups: {
                  "0": {
                    matchup: [
                      { week: "5" },
                      { is_playoffs: "0" },
                      {
                        teams: {
                          "0": rawTeam("423.l.11184.t.1", "Dynasty Warriors", "120.5"),
                          "1": rawTeam("423.l.11184.t.2", "Bench Regret FC", "98.2"),
                          count: 2,
                        },
                      },
                    ],
                  },
                  count: 1,
                },
              },
            ],
          },
        ],
      },
    };

    const cleaned = cleanYahoo(input) as {
      fantasy_content: {
        league: {
          league_key: string;
          scoreboard: { week: string; matchups: { week: string; is_playoffs: string; teams: unknown[] }[] };
        };
      };
    };

    expect(cleaned.fantasy_content.league.league_key).toBe("423.l.11184");
    const scoreboard = cleaned.fantasy_content.league.scoreboard;
    expect(scoreboard.week).toBe("5");
    expect(scoreboard.matchups).toHaveLength(1);
    expect(scoreboard.matchups[0]).toEqual({
      week: "5",
      is_playoffs: "0",
      teams: [
        { team_key: "423.l.11184.t.1", name: "Dynasty Warriors", team_points: { total: "120.5" } },
        { team_key: "423.l.11184.t.2", name: "Bench Regret FC", team_points: { total: "98.2" } },
      ],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run src/providers/yahoo/yahoo-json.test.ts`
Expected: FAIL — `Cannot find module './yahoo-json'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/providers/yahoo/yahoo-json.ts
/**
 * Cleans Yahoo Fantasy Sports API JSON into plain, predictable shapes.
 * See the module-level comment in the implementation plan / design spec for
 * why this exists: Yahoo's ?format=json is a naive XML->JSON conversion.
 * Three patterns, unwound bottom-up:
 *  1. A "numbered collection" ({"0": x, "1": y, "count": 2}) becomes [x, y].
 *  2. An array of objects whose combined keys never repeat is really one
 *     resource sharded across elements ([{a:1}, {b:2}] -> {a:1, b:2}).
 *  3. An array where every element has the exact same single key is a list
 *     of same-typed wrapped items -- unwrap the wrapper, keep the list
 *     ([{manager: {...}}, {manager: {...}}] -> [{...}, {...}]).
 * A residual quirk not fully solvable without live data: Yahoo sometimes
 * represents a singular sub-element as a bare object instead of a
 * one-item list. Watch for this when checking real fixtures (see the
 * implementation plan's fixture-recording task).
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumberedCollection(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  if (keys.length === 0) return false;
  return keys.every((key) => key === "count" || /^\d+$/.test(key));
}

function canMergeAsShards(elements: unknown[]): elements is Record<string, unknown>[] {
  if (elements.length < 2) return false;
  if (!elements.every(isPlainObject)) return false;
  const allKeys = elements.flatMap((el) => Object.keys(el as Record<string, unknown>));
  return allKeys.length > 0 && new Set(allKeys).size === allKeys.length;
}

function postprocessArray(cleaned: unknown[]): unknown {
  if (canMergeAsShards(cleaned)) {
    const merged: Record<string, unknown> = {};
    for (const shard of cleaned) Object.assign(merged, shard);
    return merged;
  }
  if (cleaned.length >= 1 && cleaned.every((el) => isPlainObject(el) && Object.keys(el).length === 1)) {
    const keys = cleaned.map((el) => Object.keys(el as Record<string, unknown>)[0]);
    if (new Set(keys).size === 1) {
      const [key] = keys;
      return cleaned.map((el) => (el as Record<string, unknown>)[key]);
    }
  }
  // A single element left over after the more specific rules above didn't
  // fire is Yahoo's redundant one-item wrapper around a whole sub-resource.
  if (cleaned.length === 1 && isPlainObject(cleaned[0])) return cleaned[0];
  return cleaned;
}

export function cleanYahoo(value: unknown): unknown {
  if (Array.isArray(value)) {
    return postprocessArray(value.map(cleanYahoo));
  }
  if (isPlainObject(value)) {
    if (isNumberedCollection(value)) {
      const items = Object.keys(value)
        .filter((key) => key !== "count")
        .sort((a, b) => Number(a) - Number(b))
        .map((key) => cleanYahoo(value[key]));
      return postprocessArray(items);
    }
    return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, cleanYahoo(val)]));
  }
  return value;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run src/providers/yahoo/yahoo-json.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/providers/yahoo/yahoo-json.ts src/providers/yahoo/yahoo-json.test.ts
git commit -m "feat(yahoo): add generic JSON shape cleaner for Yahoo's API quirks"
```

---

### Task 6: Yahoo HTTP client

**Files:**
- Create: `src/providers/yahoo/client.ts`
- Test: `src/providers/yahoo/client.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (returns raw `unknown`, no shape assumptions).
- Produces: `interface YahooApi` with methods `getUserLeagues()`, `getLeague(leagueKey)`,
  `getScoreboard(leagueKey, week)`, `getRoster(teamKey, week)`, `getTransactions(leagueKey)`,
  `getDraftResults(leagueKey)`, `getUser()`; `createHttpYahooApi(accessToken: string):
  YahooApi`; `createFixtureYahooApi(fixtureDir: string): YahooApi` — consumed by Tasks 9, 10,
  11, 14.

- [ ] **Step 1: Write the failing test**

```typescript
// src/providers/yahoo/client.test.ts
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixtureYahooApi, createHttpYahooApi } from "./client";

describe("createHttpYahooApi", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends a bearer token and hits the expected Yahoo endpoints", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const api = createHttpYahooApi("test-token");

    await api.getLeague("423.l.11184");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://fantasysports.yahooapis.com/fantasy/v2/league/423.l.11184;out=settings,standings?format=json",
      { headers: { authorization: "Bearer test-token", accept: "application/json" } },
    );

    await api.getScoreboard("423.l.11184", 5);
    expect(fetchSpy).toHaveBeenLastCalledWith(
      "https://fantasysports.yahooapis.com/fantasy/v2/league/423.l.11184/scoreboard;week=5?format=json",
      { headers: { authorization: "Bearer test-token", accept: "application/json" } },
    );

    await api.getRoster("423.l.11184.t.1", 5);
    expect(fetchSpy).toHaveBeenLastCalledWith(
      "https://fantasysports.yahooapis.com/fantasy/v2/team/423.l.11184.t.1/roster;week=5/players;out=stats?format=json",
      { headers: { authorization: "Bearer test-token", accept: "application/json" } },
    );
  });

  it("retries on 429/5xx and throws after repeated failure", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response("rate limited", { status: 429 }));
    const api = createHttpYahooApi("test-token");

    const promise = api.getLeague("423.l.11184").catch((e) => e);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBeInstanceOf(Error);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });
});

describe("createFixtureYahooApi", () => {
  it("reads recorded payloads from disk", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "yahoo-fixture-"));
    await fs.writeFile(path.join(dir, "league.json"), JSON.stringify({ name: "Test League" }));
    await fs.writeFile(path.join(dir, "scoreboard-5.json"), JSON.stringify({ week: "5" }));

    const api = createFixtureYahooApi(dir);
    expect(await api.getLeague("423.l.11184")).toEqual({ name: "Test League" });
    expect(await api.getScoreboard("423.l.11184", 5)).toEqual({ week: "5" });
    await expect(api.getUserLeagues()).rejects.toThrow("not recorded in fixtures");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run src/providers/yahoo/client.test.ts`
Expected: FAIL — `Cannot find module './client'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/providers/yahoo/client.ts
import fs from "node:fs/promises";
import path from "node:path";

/** Data source for Yahoo payloads. Two implementations: live HTTP (with a caller-supplied
 * OAuth access token — never persisted, see docs/superpowers/specs/2026-08-11-yahoo-integration-design.md),
 * and recorded fixtures on disk. Both return raw JSON — cleaning/validation happens in normalize. */
export interface YahooApi {
  getUser(): Promise<unknown>;
  getUserLeagues(): Promise<unknown>;
  getLeague(leagueKey: string): Promise<unknown>;
  getScoreboard(leagueKey: string, week: number): Promise<unknown>;
  getRoster(teamKey: string, week: number): Promise<unknown>;
  getTransactions(leagueKey: string): Promise<unknown>;
  getDraftResults(leagueKey: string): Promise<unknown>;
}

const BASE_URL = "https://fantasysports.yahooapis.com/fantasy/v2";
const MAX_ATTEMPTS = 4;

async function fetchJson(url: string, accessToken: string): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
      });
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`Yahoo ${res.status} for ${url}`);
      } else if (!res.ok) {
        throw new Error(`Yahoo ${res.status} for ${url}`);
      } else {
        return await res.json();
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
  }
  throw lastError instanceof Error ? lastError : new Error(`Failed to fetch ${url}`);
}

export function createHttpYahooApi(accessToken: string): YahooApi {
  const get = (url: string) => fetchJson(url, accessToken);
  return {
    getUser: () => get(`${BASE_URL}/users;use_login=1?format=json`),
    getUserLeagues: () =>
      get(`${BASE_URL}/users;use_login=1/games;game_codes=nfl/leagues?format=json`),
    getLeague: (leagueKey) => get(`${BASE_URL}/league/${leagueKey};out=settings,standings?format=json`),
    getScoreboard: (leagueKey, week) =>
      get(`${BASE_URL}/league/${leagueKey}/scoreboard;week=${week}?format=json`),
    getRoster: (teamKey, week) =>
      get(`${BASE_URL}/team/${teamKey}/roster;week=${week}/players;out=stats?format=json`),
    getTransactions: (leagueKey) => get(`${BASE_URL}/league/${leagueKey}/transactions?format=json`),
    getDraftResults: (leagueKey) => get(`${BASE_URL}/league/${leagueKey}/draftresults?format=json`),
  };
}

/** Reads payloads recorded by scripts/record-yahoo-fixture.ts.
 * File layout: fixtures/yahoo/<leagueKey>/{league,transactions,draftresults,
 * scoreboard-<week>,roster-<teamKey>-<week>}.json */
export function createFixtureYahooApi(fixtureDir: string): YahooApi {
  const read = async (name: string): Promise<unknown> => {
    const file = path.join(fixtureDir, `${name}.json`);
    return JSON.parse(await fs.readFile(file, "utf8"));
  };
  const unsupported = (what: string) => {
    throw new Error(`${what} is not recorded in fixtures`);
  };
  return {
    getUser: () => unsupported("getUser"),
    getUserLeagues: () => unsupported("getUserLeagues"),
    getLeague: () => read("league"),
    getScoreboard: (_leagueKey, week) => read(`scoreboard-${week}`),
    getRoster: (teamKey, week) => read(`roster-${teamKey}-${week}`),
    getTransactions: () => read("transactions"),
    getDraftResults: () => read("draftresults"),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run src/providers/yahoo/client.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/providers/yahoo/client.ts src/providers/yahoo/client.test.ts
git commit -m "feat(yahoo): add HTTP and fixture-replay API clients"
```

---

### Task 7: Yahoo zod schemas

These schemas validate the *cleaned* shape (post `cleanYahoo`), not Yahoo's raw wire format —
`cleanYahoo` already flattened the collection/shard quirks by the time these run. As with
`sleeper/schemas.ts`, every object schema is `.loose()` — Yahoo adds fields freely and only
what's read here needs validating.

**Files:**
- Create: `src/providers/yahoo/schemas.ts`

**Interfaces:**
- Consumes: nothing (zod only).
- Produces: `yahooLeagueSchema`, `yahooTeamSchema`, `yahooScoreboardSchema`,
  `yahooRosterSchema`, `yahooTransactionSchema`, `yahooTransactionsSchema`,
  `yahooDraftResultSchema`, `yahooDraftResultsSchema`, `yahooUserLeaguesSchema`,
  `yahooUserSchema`, and their inferred types — consumed by Task 8 (normalize).

No test file for this task — these schemas have no behavior of their own beyond `.parse()`,
and Task 8's normalize tests exercise them against realistic payloads. (This matches
`sleeper/schemas.ts`, which also has no dedicated test file.)

- [ ] **Step 1: Write the implementation**

```typescript
// src/providers/yahoo/schemas.ts
import { z } from "zod";

const numericString = z.union([z.string(), z.number()]);

export const yahooManagerSchema = z.object({ guid: z.string(), nickname: z.string().nullish() }).loose();
export type YahooManager = z.infer<typeof yahooManagerSchema>;

export const yahooTeamSchema = z
  .object({
    team_key: z.string(),
    team_id: numericString,
    name: z.string(),
    managers: z.array(yahooManagerSchema).nullish(),
    team_standings: z
      .object({
        rank: numericString.nullish(),
        outcome_totals: z
          .object({
            wins: numericString,
            losses: numericString,
            ties: numericString.nullish(),
          })
          .loose()
          .nullish(),
        points_for: numericString.nullish(),
        points_against: numericString.nullish(),
      })
      .loose()
      .nullish(),
  })
  .loose();
export type YahooTeam = z.infer<typeof yahooTeamSchema>;

export const yahooRosterPositionSchema = z.object({ position: z.string(), count: numericString.nullish() }).loose();

export const yahooLeagueSettingsSchema = z
  .object({
    playoff_start_week: numericString.nullish(),
    num_playoff_teams: numericString.nullish(),
    roster_positions: z.array(yahooRosterPositionSchema).nullish(),
  })
  .loose();
export type YahooLeagueSettings = z.infer<typeof yahooLeagueSettingsSchema>;

export const yahooLeagueSchema = z
  .object({
    league_key: z.string(),
    league_id: z.string(),
    name: z.string(),
    season: numericString,
    num_teams: numericString,
    current_week: numericString.nullish(),
    end_week: numericString.nullish(),
    settings: yahooLeagueSettingsSchema.nullish(),
    // Deliberately unknown, not {teams: [...]} — see normalize.ts's
    // extractStandingsTeams for why this one field can't be validated
    // directly against a fixed shape.
    standings: z.unknown().nullish(),
  })
  .loose();
export type YahooLeague = z.infer<typeof yahooLeagueSchema>;

export const yahooScoreboardMatchupSchema = z
  .object({
    week: numericString,
    is_playoffs: numericString.nullish(),
    is_consolation: numericString.nullish(),
    teams: z.array(
      z
        .object({
          team_key: z.string(),
          team_points: z.object({ total: numericString }).loose().nullish(),
        })
        .loose(),
    ),
  })
  .loose();
export type YahooScoreboardMatchup = z.infer<typeof yahooScoreboardMatchupSchema>;

export const yahooScoreboardSchema = z
  .object({
    week: numericString,
    matchups: z.array(yahooScoreboardMatchupSchema),
  })
  .loose();
export type YahooScoreboard = z.infer<typeof yahooScoreboardSchema>;

export const yahooRosterPlayerSchema = z
  .object({
    player_key: z.string(),
    player_id: numericString,
    name: z.object({ full: z.string() }).loose(),
    display_position: z.string().nullish(),
    editorial_team_abbr: z.string().nullish(),
    selected_position: z.object({ position: z.string() }).loose().nullish(),
    player_points: z.object({ total: numericString }).loose().nullish(),
  })
  .loose();
export type YahooRosterPlayer = z.infer<typeof yahooRosterPlayerSchema>;

export const yahooRosterSchema = z
  .object({
    roster: z.object({
      week: numericString.nullish(),
      players: z.array(yahooRosterPlayerSchema).nullish(),
    }).loose(),
  })
  .loose();
export type YahooRoster = z.infer<typeof yahooRosterSchema>;

export const yahooTransactionSchema = z
  .object({
    transaction_key: z.string(),
    type: z.string(),
    status: z.string(),
    timestamp: numericString.nullish(),
    faab_bid: numericString.nullish(),
    players: z
      .array(
        z
          .object({
            player_key: z.string(),
            transaction_data: z
              .object({
                type: z.string(),
                source_team_key: z.string().nullish(),
                destination_team_key: z.string().nullish(),
              })
              .loose()
              .nullish(),
          })
          .loose(),
      )
      .nullish(),
  })
  .loose();
export type YahooTransaction = z.infer<typeof yahooTransactionSchema>;
export const yahooTransactionsSchema = z.array(yahooTransactionSchema);

export const yahooDraftResultSchema = z
  .object({
    pick: numericString,
    round: numericString,
    team_key: z.string(),
    player_key: z.string().nullish(),
    cost: numericString.nullish(),
  })
  .loose();
export type YahooDraftResult = z.infer<typeof yahooDraftResultSchema>;
export const yahooDraftResultsSchema = z.array(yahooDraftResultSchema);

export const yahooUserLeagueSchema = z
  .object({
    league_key: z.string(),
    name: z.string(),
    season: numericString,
    num_teams: numericString,
  })
  .loose();
export type YahooUserLeague = z.infer<typeof yahooUserLeagueSchema>;

export const yahooUserSchema = z
  .object({
    guid: z.string(),
    games: z.array(z.object({ leagues: z.array(yahooUserLeagueSchema).nullish() }).loose()).nullish(),
  })
  .loose();
export type YahooUser = z.infer<typeof yahooUserSchema>;
export const yahooUsersSchema = z.array(yahooUserSchema);
```

- [ ] **Step 2: Verify it compiles**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: no errors referencing `src/providers/yahoo/schemas.ts`

- [ ] **Step 3: Commit**

```bash
git add src/providers/yahoo/schemas.ts
git commit -m "feat(yahoo): add zod schemas for cleaned Yahoo payloads"
```

---

### Task 8: Yahoo normalize

Maps cleaned-and-validated Yahoo payloads to `NormalizedLeagueBundle`. The test fixture here
is hand-built to match everything verified in Task 5's research (documented Yahoo JSON
conventions + the `yfpy` field list) — Task 14 swaps in a real recorded payload and fixes
anything this guessed wrong.

**Files:**
- Create: `src/providers/yahoo/normalize.ts`
- Test: `src/providers/yahoo/normalize.test.ts`

**Interfaces:**
- Consumes: `cleanYahoo` (Task 5); all schemas from Task 7; `NormalizedLeagueBundle` and
  friends from `src/providers/types.ts`.
- Produces: `type YahooLeaguePayloads`, `normalizeYahooLeague(payloads: YahooLeaguePayloads):
  NormalizedLeagueBundle`, `extractStandingsTeams(standings: unknown): unknown[]` — consumed
  by Task 9 (index.ts), which needs the same standings-shape handling for its team-key fan-out.

- [ ] **Step 1: Write the failing test**

```typescript
// src/providers/yahoo/normalize.test.ts
import { describe, expect, it } from "vitest";
import { normalizeYahooLeague, type YahooLeaguePayloads } from "./normalize";

const LEAGUE_KEY = "423.l.11184";

function rawTeam(id: number, name: string, guid: string, wins: number, losses: number, pf: string, pa: string) {
  return {
    team: [
      [{ team_key: `${LEAGUE_KEY}.t.${id}` }, { team_id: id }, { name }, { managers: [{ manager: { guid, nickname: name } }] }],
      {
        team_standings: {
          rank: id,
          outcome_totals: { wins, losses, ties: 0 },
          points_for: pf,
          points_against: pa,
        },
      },
    ],
  };
}

function buildLeaguePayload() {
  return {
    fantasy_content: {
      league: [
        { league_key: LEAGUE_KEY },
        { league_id: "11184" },
        { name: "Legends Only League" },
        { season: "2025" },
        { num_teams: 2 },
        { current_week: 17 },
        { end_week: "17" },
        {
          settings: [
            {
              playoff_start_week: "15",
              num_playoff_teams: "2",
              roster_positions: [
                { roster_position: { position: "QB", count: "1" } },
                { roster_position: { position: "RB", count: "2" } },
              ],
            },
          ],
        },
        {
          standings: [
            {
              teams: {
                "0": rawTeam(1, "Dynasty Warriors", "GUID-1", 10, 4, "1500.50", "1300.20"),
                "1": rawTeam(2, "Bench Regret FC", "GUID-2", 4, 10, "1300.20", "1500.50"),
                count: 2,
              },
            },
          ],
        },
      ],
    },
  };
}

function buildScoreboardPayload(week: number) {
  return {
    fantasy_content: {
      league: [
        { league_key: LEAGUE_KEY },
        {
          scoreboard: [
            { week: String(week) },
            {
              matchups: {
                "0": {
                  matchup: [
                    { week: String(week) },
                    { is_playoffs: week >= 15 ? "1" : "0" },
                    {
                      teams: {
                        "0": {
                          team: [
                            [{ team_key: `${LEAGUE_KEY}.t.1` }, { name: "Dynasty Warriors" }],
                            { team_points: { total: "120.5" } },
                          ],
                        },
                        "1": {
                          team: [
                            [{ team_key: `${LEAGUE_KEY}.t.2` }, { name: "Bench Regret FC" }],
                            { team_points: { total: "98.2" } },
                          ],
                        },
                        count: 2,
                      },
                    },
                  ],
                },
                count: 1,
              },
            },
          ],
        },
      ],
    },
  };
}

function buildRosterPayload(teamKey: string, week: number) {
  return {
    fantasy_content: {
      team: [
        [{ team_key: teamKey }, { name: "Dynasty Warriors" }],
        {
          roster: [
            { week: String(week) },
            {
              players: {
                "0": {
                  player: [
                    [{ player_key: "423.p.1" }, { player_id: "1" }, { name: { full: "Star Quarterback" } }],
                    { display_position: "QB" },
                    { editorial_team_abbr: "KC" },
                    { selected_position: [{ coverage_type: "week" }, { position: "QB" }] },
                    { player_points: { total: "24.5" } },
                  ],
                },
                count: 1,
              },
            },
          ],
        },
      ],
    },
  };
}

function buildPayloads(): YahooLeaguePayloads {
  // Only team 1 has a recorded roster this week — keeps the player-weeks
  // assertions below unambiguous (exactly one rostered player, on one team).
  const teamOneKey = `${LEAGUE_KEY}.t.1`;
  return {
    league: buildLeaguePayload(),
    scoreboardByWeek: { 1: buildScoreboardPayload(1) },
    rosterByTeamWeek: { [`${teamOneKey}:1`]: buildRosterPayload(teamOneKey, 1) },
    transactions: { fantasy_content: { league: [{ league_key: LEAGUE_KEY }, { transactions: [] }] } },
    draftResults: { fantasy_content: { league: [{ league_key: LEAGUE_KEY }, { draft_results: [] }] } },
  };
}

describe("normalizeYahooLeague (hand-built fixture)", () => {
  it("normalizes league metadata", () => {
    const bundle = normalizeYahooLeague(buildPayloads());
    expect(bundle.league.provider).toBe("yahoo");
    expect(bundle.league.providerLeagueId).toBe(LEAGUE_KEY);
    expect(bundle.league.season).toBe(2025);
    expect(bundle.league.totalTeams).toBe(2);
    expect(bundle.league.playoffStartWeek).toBe(15);
    expect(bundle.league.playoffTeams).toBe(2);
    expect(bundle.league.rosterPositions).toEqual(["QB", "RB", "RB"]);
  });

  it("produces one team per Yahoo team with records and manager guid", () => {
    const bundle = normalizeYahooLeague(buildPayloads());
    expect(bundle.teams).toHaveLength(2);
    const warriors = bundle.teams.find((t) => t.displayName === "Dynasty Warriors");
    expect(warriors?.providerRosterId).toBe("1");
    expect(warriors?.providerUserId).toBe("GUID-1");
    expect(warriors?.wins).toBe(10);
    expect(warriors?.losses).toBe(4);
    expect(warriors?.pointsFor).toBeCloseTo(1500.5);
  });

  it("normalizes one matchup for the recorded week", () => {
    const bundle = normalizeYahooLeague(buildPayloads());
    expect(bundle.matchups).toHaveLength(1);
    expect(bundle.matchups[0]).toMatchObject({
      week: 1,
      teamA: "1",
      teamB: "2",
      teamAScore: 120.5,
      teamBScore: 98.2,
      isPlayoff: false,
    });
  });

  it("normalizes player-weeks from the recorded roster", () => {
    const bundle = normalizeYahooLeague(buildPayloads());
    expect(bundle.playerWeeks).toHaveLength(1);
    expect(bundle.playerWeeks[0]).toMatchObject({
      providerRosterId: "1",
      week: 1,
      providerPlayerId: "1",
      points: 24.5,
      started: true,
      slot: "QB",
    });
    expect(bundle.players).toHaveLength(1);
    expect(bundle.players[0]).toMatchObject({ providerPlayerId: "1", name: "Star Quarterback", position: "QB" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run src/providers/yahoo/normalize.test.ts`
Expected: FAIL — `Cannot find module './normalize'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/providers/yahoo/normalize.ts
import type { TransactionAssets, TransactionType } from "@/db/schema";
import type {
  NormalizedDraftPick,
  NormalizedLeagueBundle,
  NormalizedMatchup,
  NormalizedPlayer,
  NormalizedPlayerWeek,
  NormalizedTeam,
  NormalizedTransaction,
} from "@/providers/types";
import {
  type YahooScoreboardMatchup,
  yahooDraftResultsSchema,
  yahooLeagueSchema,
  yahooRosterSchema,
  yahooScoreboardSchema,
  yahooTeamSchema,
  yahooTransactionsSchema,
} from "./schemas";
import { cleanYahoo } from "./yahoo-json";

/** Everything fetched for one league-season, still Yahoo-shaped (raw fantasy_content JSON). */
export type YahooLeaguePayloads = {
  league: unknown;
  scoreboardByWeek: Record<number, unknown>;
  /** Keyed by `${teamKey}:${week}`. */
  rosterByTeamWeek: Record<string, unknown>;
  transactions: unknown;
  draftResults: unknown;
};

const NON_STARTING_POSITIONS = new Set(["BN", "IR", "IR+"]);

function unwrapLeague(raw: unknown): unknown {
  const cleaned = cleanYahoo(raw) as { fantasy_content?: { league?: unknown } };
  return cleaned.fantasy_content?.league;
}

/**
 * cleanYahoo's generic rules can't disambiguate "a wrapper around one
 * sub-resource" from "a list of one item" when that sub-resource's own
 * cleaned content has exactly one key — which is exactly what `standings`
 * is ({teams: [...]}, nothing else). Depending on how many teams clean up
 * alongside it, the same raw response can come out as either {teams: [...]}
 * or [[...]] (an array whose one element is the teams array). Handle both
 * rather than trying to make cleanYahoo itself resolve an ambiguity that
 * genuinely isn't resolvable from shape alone. See yahoo-json.ts's module
 * comment for the general version of this caveat.
 */
export function extractStandingsTeams(standings: unknown): unknown[] {
  if (Array.isArray(standings) && Array.isArray(standings[0])) return standings[0] as unknown[];
  if (standings && typeof standings === "object" && "teams" in standings) {
    return (standings as { teams: unknown[] }).teams;
  }
  return [];
}

function toInt(value: string | number): number {
  return typeof value === "number" ? Math.trunc(value) : Number.parseInt(value, 10);
}

function toFloat(value: string | number): number {
  return typeof value === "number" ? value : Number.parseFloat(value);
}

function normalizeTransactionType(type: string): TransactionType {
  if (type === "trade" || type === "waiver") return type;
  if (type === "add" || type === "drop") return "free_agent";
  return "commissioner";
}

/** Yahoo's player_key is `{game_key}.p.{player_id}` — extract the bare id so
 * transaction/draft-pick player refs land in the same id space as
 * players[]/playerWeeks[] (which use the bare numeric player_id). Mirrors
 * the .split(".t.")[1] pattern already used for team keys below. */
function barePlayerId(playerKey: string): string {
  return playerKey.split(".p.")[1];
}

export function normalizeYahooLeague(payloads: YahooLeaguePayloads): NormalizedLeagueBundle {
  const league = yahooLeagueSchema.parse(unwrapLeague(payloads.league));
  const rawTeams = yahooTeamSchema.array().parse(extractStandingsTeams(league.standings));
  const teams: NormalizedTeam[] = rawTeams.map((team) => {
    const manager = team.managers?.[0];
    const outcome = team.team_standings?.outcome_totals;
    return {
      providerRosterId: String(team.team_id),
      providerUserId: manager?.guid ?? null,
      displayName: team.name,
      teamName: null,
      avatarUrl: null,
      wins: outcome ? toInt(outcome.wins) : 0,
      losses: outcome ? toInt(outcome.losses) : 0,
      ties: outcome?.ties != null ? toInt(outcome.ties) : 0,
      pointsFor: team.team_standings?.points_for != null ? toFloat(team.team_standings.points_for) : 0,
      pointsAgainst:
        team.team_standings?.points_against != null ? toFloat(team.team_standings.points_against) : 0,
      finalRank: team.team_standings?.rank != null ? toInt(team.team_standings.rank) : null,
      playoffSeed: null,
      raw: team,
    };
  });

  const rosterPositions = (league.settings?.roster_positions ?? []).flatMap((rp) =>
    Array(rp.count != null ? toInt(rp.count) : 1).fill(rp.position),
  );
  const playoffStartWeek = league.settings?.playoff_start_week != null ? toInt(league.settings.playoff_start_week) : null;
  const playoffTeams = league.settings?.num_playoff_teams != null ? toInt(league.settings.num_playoff_teams) : null;

  const matchups: NormalizedMatchup[] = [];
  const playerWeeks: NormalizedPlayerWeek[] = [];
  const referencedPlayerIds = new Set<string>();

  const weekNumbers = Object.keys(payloads.scoreboardByWeek)
    .map(Number)
    .sort((a, b) => a - b);

  for (const week of weekNumbers) {
    const cleaned = cleanYahoo(payloads.scoreboardByWeek[week]) as {
      fantasy_content?: { league?: { scoreboard?: unknown } };
    };
    const scoreboard = yahooScoreboardSchema.parse(cleaned.fantasy_content?.league?.scoreboard);
    for (const matchup of scoreboard.matchups as YahooScoreboardMatchup[]) {
      // teamA must be the lower providerRosterId (see NormalizedMatchup's
      // doc comment and the unique index in db/schema.ts) — Yahoo's own
      // team order in the response isn't guaranteed to satisfy that.
      const [teamA, teamB] = [...matchup.teams].sort(
        (a, b) => Number(a.team_key.split(".t.")[1]) - Number(b.team_key.split(".t.")[1]),
      );
      if (!teamA) continue;
      matchups.push({
        week,
        teamA: teamA.team_key.split(".t.")[1],
        teamB: teamB ? teamB.team_key.split(".t.")[1] : null,
        teamAScore: teamA.team_points?.total != null ? toFloat(teamA.team_points.total) : 0,
        teamBScore: teamB?.team_points?.total != null ? toFloat(teamB.team_points.total) : null,
        isPlayoff: matchup.is_playoffs != null && toInt(matchup.is_playoffs) === 1,
        bracketRound: null,
      });
    }
  }

  for (const [key, rawRoster] of Object.entries(payloads.rosterByTeamWeek)) {
    const [teamKey, weekStr] = key.split(":");
    const rosterTeamId = teamKey.split(".t.")[1];
    const week = Number(weekStr);
    const cleaned = cleanYahoo(rawRoster) as { fantasy_content?: { team?: unknown } };
    const parsed = yahooRosterSchema.parse({ roster: (cleaned.fantasy_content?.team as { roster?: unknown })?.roster });
    for (const player of parsed.roster.players ?? []) {
      referencedPlayerIds.add(String(player.player_id));
      const slot = player.selected_position?.position ?? "BN";
      playerWeeks.push({
        providerRosterId: rosterTeamId,
        week,
        providerPlayerId: String(player.player_id),
        points: player.player_points?.total != null ? toFloat(player.player_points.total) : 0,
        started: !NON_STARTING_POSITIONS.has(slot),
        slot,
      });
    }
  }

  const players: NormalizedPlayer[] = [];
  {
    const seen = new Set<string>();
    for (const [, rawRoster] of Object.entries(payloads.rosterByTeamWeek)) {
      const cleaned = cleanYahoo(rawRoster) as { fantasy_content?: { team?: unknown } };
      const parsed = yahooRosterSchema.parse({ roster: (cleaned.fantasy_content?.team as { roster?: unknown })?.roster });
      for (const player of parsed.roster.players ?? []) {
        const id = String(player.player_id);
        if (seen.has(id)) continue;
        seen.add(id);
        players.push({
          providerPlayerId: id,
          name: player.name.full,
          position: player.display_position ?? null,
          nflTeam: player.editorial_team_abbr ?? null,
        });
      }
    }
  }

  const transactionsCleaned = cleanYahoo(payloads.transactions) as {
    fantasy_content?: { league?: { transactions?: unknown } };
  };
  const rawTransactions = yahooTransactionsSchema.parse(
    transactionsCleaned.fantasy_content?.league?.transactions ?? [],
  );
  const transactions: NormalizedTransaction[] = rawTransactions
    .filter((tx) => tx.status === "successful")
    .map((tx) => {
      const adds: Record<string, string[]> = {};
      const drops: Record<string, string[]> = {};
      for (const p of tx.players ?? []) {
        const data = p.transaction_data;
        if (!data) continue;
        referencedPlayerIds.add(barePlayerId(p.player_key));
        if (data.destination_team_key) {
          const rosterId = data.destination_team_key.split(".t.")[1];
          (adds[rosterId] ??= []).push(barePlayerId(p.player_key));
        }
        if (data.source_team_key) {
          const rosterId = data.source_team_key.split(".t.")[1];
          (drops[rosterId] ??= []).push(barePlayerId(p.player_key));
        }
      }
      const assets: TransactionAssets = { adds, drops };
      if (tx.faab_bid != null) {
        const firstRoster = Object.keys(adds)[0];
        if (firstRoster) assets.faab = { [firstRoster]: toInt(tx.faab_bid) };
      }
      return {
        providerTxId: tx.transaction_key,
        // Yahoo's transaction resource carries a timestamp but no week
        // number, and no task in this plan fetches NFL week-date
        // boundaries to derive one — known limitation, documented in
        // STATUS.md's "Known limitations" (Task 14). Revisit if/when
        // week-accurate transaction attribution is needed for Yahoo.
        week: 0,
        type: normalizeTransactionType(tx.type),
        rosterIds: [...new Set([...Object.keys(adds), ...Object.keys(drops)])],
        assets,
        executedAt: tx.timestamp != null ? new Date(toInt(tx.timestamp) * 1000) : null,
      };
    });

  const draftResultsCleaned = cleanYahoo(payloads.draftResults) as {
    fantasy_content?: { league?: { draft_results?: unknown } };
  };
  const rawDraftResults = yahooDraftResultsSchema.parse(
    draftResultsCleaned.fantasy_content?.league?.draft_results ?? [],
  );
  const draftPicks: NormalizedDraftPick[] = rawDraftResults.map((pick) => {
    if (pick.player_key) referencedPlayerIds.add(barePlayerId(pick.player_key));
    return {
      round: toInt(pick.round),
      pickNo: toInt(pick.pick),
      providerRosterId: pick.team_key.split(".t.")[1] ?? null,
      providerPlayerId: pick.player_key ? barePlayerId(pick.player_key) : null,
      isKeeper: false,
      amount: pick.cost != null ? toInt(pick.cost) : null,
    };
  });

  return {
    league: {
      provider: "yahoo",
      providerLeagueId: league.league_key,
      season: toInt(league.season),
      name: league.name,
      totalTeams: toInt(league.num_teams),
      rosterPositions,
      scoringSettings: {},
      playoffStartWeek,
      playoffTeams,
      lastScoredWeek: league.current_week != null ? toInt(league.current_week) : weekNumbers.at(-1) ?? null,
      previousProviderLeagueId: null,
      raw: payloads.league,
    },
    teams,
    matchups,
    playerWeeks,
    players,
    transactions,
    draftPicks,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run src/providers/yahoo/normalize.test.ts`
Expected: PASS (4 tests). If a specific assertion fails, the mismatch is almost always in
how `unwrapLeague`/`cleanYahoo` handled one of the hand-built fixture's nesting points —
compare the intermediate cleaned value (temporarily `console.log(unwrapLeague(payloads.league))`)
against what the test fixture actually contains before changing assertions.

- [ ] **Step 5: Commit**

```bash
git add src/providers/yahoo/normalize.ts src/providers/yahoo/normalize.test.ts
git commit -m "feat(yahoo): add normalize (Yahoo payloads -> NormalizedLeagueBundle)"
```

---

### Task 9: Yahoo index (public adapter surface)

**Files:**
- Create: `src/providers/yahoo/index.ts`

**Interfaces:**
- Consumes: `YahooApi` (Task 6), `normalizeYahooLeague`/`YahooLeaguePayloads`/
  `extractStandingsTeams` (Task 8).
- Produces: `fetchYahooPayloads(api, leagueKey): Promise<YahooLeaguePayloads>`,
  `fetchYahooLeagueBundle(api, leagueKey): Promise<NormalizedLeagueBundle>` — consumed by
  Task 11 (`/api/yahoo/sync`) and Task 14 (fixture recorder script).

No test file — this is thin orchestration over already-tested pieces (`client.ts`,
`normalize.ts`); mirrors `sleeper/index.ts`, which is also untested directly.

- [ ] **Step 1: Write the implementation**

```typescript
// src/providers/yahoo/index.ts
import type { NormalizedLeagueBundle } from "@/providers/types";
import type { YahooApi } from "./client";
import { extractStandingsTeams, normalizeYahooLeague, type YahooLeaguePayloads } from "./normalize";
import { cleanYahoo } from "./yahoo-json";

export { createFixtureYahooApi, createHttpYahooApi } from "./client";
export { normalizeYahooLeague } from "./normalize";

/** Fetch every payload needed to reconstruct one league-season. First fetches the league
 * (to learn num_teams and current_week), then fans out scoreboard-per-week and
 * roster-per-team-per-week calls in parallel — mirrors sleeper/index.ts's shape, just with
 * a bigger fan-out since Yahoo has no single "all matchups for the league" call. */
export async function fetchYahooPayloads(api: YahooApi, leagueKey: string): Promise<YahooLeaguePayloads> {
  const league = await api.getLeague(leagueKey);
  const cleaned = cleanYahoo(league) as {
    fantasy_content?: { league?: { current_week?: string | number; standings?: unknown } };
  };
  const leagueData = cleaned.fantasy_content?.league;
  const lastWeek = leagueData?.current_week != null ? Number(leagueData.current_week) : 17;
  const weeks = Array.from({ length: lastWeek }, (_, i) => i + 1);
  const teamKeys = extractStandingsTeams(leagueData?.standings).map((t) => (t as { team_key: string }).team_key);

  const [scoreboards, rosters, transactions, draftResults] = await Promise.all([
    Promise.all(weeks.map((w) => api.getScoreboard(leagueKey, w))),
    Promise.all(
      teamKeys.flatMap((teamKey) => weeks.map((w) => api.getRoster(teamKey, w).then((r) => [teamKey, w, r] as const))),
    ),
    api.getTransactions(leagueKey),
    api.getDraftResults(leagueKey),
  ]);

  return {
    league,
    scoreboardByWeek: Object.fromEntries(weeks.map((w, i) => [w, scoreboards[i]])),
    rosterByTeamWeek: Object.fromEntries(rosters.map(([teamKey, w, r]) => [`${teamKey}:${w}`, r])),
    transactions,
    draftResults,
  };
}

export async function fetchYahooLeagueBundle(
  api: YahooApi,
  leagueKey: string,
): Promise<NormalizedLeagueBundle> {
  return normalizeYahooLeague(await fetchYahooPayloads(api, leagueKey));
}
```

- [ ] **Step 2: Verify it compiles**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: no errors referencing `src/providers/yahoo/index.ts`

- [ ] **Step 3: Commit**

```bash
git add src/providers/yahoo/index.ts
git commit -m "feat(yahoo): add adapter public surface (fetchYahooPayloads / fetchYahooLeagueBundle)"
```

---

### Task 10: `/api/yahoo/leagues` route

**Files:**
- Create: `src/app/api/yahoo/leagues/route.ts`
- Test: `src/app/api/yahoo/leagues/route.test.ts`

**Interfaces:**
- Consumes: `YAHOO_TOKEN_COOKIE`, `decryptCookieValue` (Task 1); `createHttpYahooApi` (Task 6).
- Produces: `GET` route returning `{ guid, leagues: [{leagueKey, name, season, teams}] }` —
  consumed by Task 12 (`YahooConnectFlow`).

- [ ] **Step 1: Write the failing test**

```typescript
// src/app/api/yahoo/leagues/route.test.ts
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { YAHOO_TOKEN_COOKIE, encryptCookieValue } from "@/lib/yahoo-cookies";
import * as yahooClient from "@/providers/yahoo/client";
import { GET } from "./route";

function requestWithToken(token?: string): NextRequest {
  const headers = new Headers();
  if (token) headers.set("cookie", `${YAHOO_TOKEN_COOKIE}=${encryptCookieValue(token)}`);
  return new NextRequest("https://example.vercel.app/api/yahoo/leagues", { headers });
}

const RAW_DISCOVERY_RESPONSE = {
  fantasy_content: {
    users: [
      {
        user: [
          [{ guid: "GUID-1" }, { nickname: "Frank" }],
          {
            games: [
              {
                game: [
                  [{ game_key: "423" }, { code: "nfl" }],
                  {
                    leagues: {
                      "0": { league: [{ league_key: "423.l.1" }, { name: "My League" }, { season: "2025" }, { num_teams: 10 }] },
                      count: 1,
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
};

describe("GET /api/yahoo/leagues", () => {
  beforeEach(() => {
    process.env.YAHOO_COOKIE_SECRET = Buffer.alloc(32, 7).toString("base64");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("401s when there's no token cookie", async () => {
    const response = await GET(requestWithToken());
    expect(response.status).toBe(401);
  });

  it("returns the user's guid and league list", async () => {
    vi.spyOn(yahooClient, "createHttpYahooApi").mockReturnValue({
      getUser: () => Promise.resolve(RAW_DISCOVERY_RESPONSE),
      getUserLeagues: () => Promise.resolve(RAW_DISCOVERY_RESPONSE),
      getLeague: () => Promise.reject(new Error("unused")),
      getScoreboard: () => Promise.reject(new Error("unused")),
      getRoster: () => Promise.reject(new Error("unused")),
      getTransactions: () => Promise.reject(new Error("unused")),
      getDraftResults: () => Promise.reject(new Error("unused")),
    });

    const response = await GET(requestWithToken("real-token"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.guid).toBe("GUID-1");
    expect(data.leagues).toEqual([{ leagueKey: "423.l.1", name: "My League", season: 2025, teams: 10 }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run src/app/api/yahoo/leagues/route.test.ts`
Expected: FAIL — `Cannot find module './route'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/app/api/yahoo/leagues/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { YAHOO_TOKEN_COOKIE, decryptCookieValue } from "@/lib/yahoo-cookies";
import { createHttpYahooApi } from "@/providers/yahoo/client";
import { yahooUsersSchema } from "@/providers/yahoo/schemas";
import { cleanYahoo } from "@/providers/yahoo/yahoo-json";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const encrypted = request.cookies.get(YAHOO_TOKEN_COOKIE)?.value;
  const token = encrypted ? decryptCookieValue(encrypted) : null;
  if (!token) {
    return NextResponse.json({ error: "Your Yahoo session expired — sign in again." }, { status: 401 });
  }

  try {
    const api = createHttpYahooApi(token);
    const raw = await api.getUserLeagues();
    const cleaned = cleanYahoo(raw) as { fantasy_content?: { users?: unknown } };
    const users = yahooUsersSchema.parse(cleaned.fantasy_content?.users ?? []);
    const user = users[0];
    if (!user) throw new Error("Yahoo returned no logged-in user");

    const leagues = (user.games ?? []).flatMap((game) => game.leagues ?? []);
    return NextResponse.json({
      guid: user.guid,
      leagues: leagues.map((l) => ({
        leagueKey: l.league_key,
        name: l.name,
        season: Number(l.season),
        teams: Number(l.num_teams),
      })),
    });
  } catch (error) {
    console.error("Yahoo league lookup failed", error);
    return NextResponse.json({ error: "Could not load your Yahoo leagues." }, { status: 502 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run src/app/api/yahoo/leagues/route.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/yahoo/leagues
git commit -m "feat(yahoo): add league discovery route"
```

---

### Task 11: `/api/yahoo/sync` route

**Files:**
- Create: `src/app/api/yahoo/sync/route.ts`
- Test: `src/app/api/yahoo/sync/route.test.ts`

**Interfaces:**
- Consumes: `YAHOO_TOKEN_COOKIE`, `decryptCookieValue` (Task 1); `createHttpYahooApi`,
  `fetchYahooLeagueBundle` (Tasks 6, 9); `persistBundle` (`src/sync/persist.ts`, existing,
  provider-agnostic); `resolveYourRosterId` (`src/sync/resolve-roster.ts`, existing);
  `rateLimit`/`pruneRateLimitWindows` (`src/lib/rate-limit.ts`, existing).
- Produces: `POST` route returning `{provider, leagueId, season, name, yourRosterId, teams}`
  — same shape `/api/sync` already returns — consumed by `YahooConnectFlow` (Task 12).

- [ ] **Step 1: Write the failing test**

```typescript
// src/app/api/yahoo/sync/route.test.ts
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { YAHOO_TOKEN_COOKIE, encryptCookieValue } from "@/lib/yahoo-cookies";
import type { NormalizedLeagueBundle } from "@/providers/types";
import * as yahooProvider from "@/providers/yahoo";
import * as persistModule from "@/sync/persist";
import { POST } from "./route";

function postRequest(body: unknown, token?: string): NextRequest {
  const headers = new Headers({ "content-type": "application/json" });
  if (token) headers.set("cookie", `${YAHOO_TOKEN_COOKIE}=${encryptCookieValue(token)}`);
  return new NextRequest("https://example.vercel.app/api/yahoo/sync", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const BUNDLE: NormalizedLeagueBundle = {
  league: {
    provider: "yahoo",
    providerLeagueId: "423.l.1",
    season: 2025,
    name: "My League",
    totalTeams: 2,
    rosterPositions: ["QB"],
    scoringSettings: {},
    playoffStartWeek: null,
    playoffTeams: null,
    lastScoredWeek: 17,
    previousProviderLeagueId: null,
    raw: {},
  },
  teams: [
    {
      providerRosterId: "1",
      providerUserId: "GUID-1",
      displayName: "Dynasty Warriors",
      teamName: null,
      avatarUrl: null,
      wins: 10,
      losses: 4,
      ties: 0,
      pointsFor: 1500.5,
      pointsAgainst: 1300.2,
      finalRank: 1,
      playoffSeed: null,
      raw: {},
    },
  ],
  matchups: [{ week: 1, teamA: "1", teamB: null, teamAScore: 100, teamBScore: null, isPlayoff: false, bracketRound: null }],
  playerWeeks: [],
  players: [],
  transactions: [],
  draftPicks: [],
};

describe("POST /api/yahoo/sync", () => {
  beforeEach(() => {
    process.env.YAHOO_COOKIE_SECRET = Buffer.alloc(32, 7).toString("base64");
    vi.spyOn(persistModule, "persistBundle").mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("401s when there's no token cookie", async () => {
    const response = await POST(postRequest({ leagueKey: "423.l.1" }));
    expect(response.status).toBe(401);
  });

  it("400s when leagueKey is missing", async () => {
    const response = await POST(postRequest({}, "real-token"));
    expect(response.status).toBe(400);
  });

  it("syncs, persists, resolves the caller's own roster by guid, and clears the token cookie", async () => {
    vi.spyOn(yahooProvider, "fetchYahooLeagueBundle").mockResolvedValue(BUNDLE);

    const response = await POST(postRequest({ leagueKey: "423.l.1", guid: "GUID-1" }, "real-token"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      provider: "yahoo",
      leagueId: "423.l.1",
      season: 2025,
      name: "My League",
      yourRosterId: "1",
    });
    expect(persistModule.persistBundle).toHaveBeenCalled();
    expect(response.cookies.get(YAHOO_TOKEN_COOKIE)?.value).toBe("");
  });

  it("422s when the league has no scored weeks", async () => {
    vi.spyOn(yahooProvider, "fetchYahooLeagueBundle").mockResolvedValue({ ...BUNDLE, matchups: [] });
    const response = await POST(postRequest({ leagueKey: "423.l.1" }, "real-token"));
    expect(response.status).toBe(422);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run src/app/api/yahoo/sync/route.test.ts`
Expected: FAIL — `Cannot find module './route'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/app/api/yahoo/sync/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { YAHOO_TOKEN_COOKIE, decryptCookieValue } from "@/lib/yahoo-cookies";
import { pruneRateLimitWindows, rateLimit } from "@/lib/rate-limit";
import { z } from "zod";
import { createHttpYahooApi, fetchYahooLeagueBundle } from "@/providers/yahoo";
import { persistBundle } from "@/sync/persist";
import { resolveYourRosterId } from "@/sync/resolve-roster";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const bodySchema = z.object({ leagueKey: z.string().min(1), guid: z.string().optional() });
const SYNCS_PER_HOUR = 12;

/** Sync a Yahoo league into Postgres. The OAuth token identifies the caller directly (no
 * separate userId param, unlike Sleeper) — the picker passes the guid discovered alongside
 * the league list back through so the caller's own roster can be resolved. */
export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  pruneRateLimitWindows();
  const limit = rateLimit(`sync:${ip}`, SYNCS_PER_HOUR, 60 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many syncs — try again in a few minutes." },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } },
    );
  }

  const encrypted = request.cookies.get(YAHOO_TOKEN_COOKIE)?.value;
  const token = encrypted ? decryptCookieValue(encrypted) : null;
  if (!token) {
    return NextResponse.json({ error: "Your Yahoo session expired — sign in again." }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "leagueKey is required" }, { status: 400 });
  }

  try {
    const bundle = await fetchYahooLeagueBundle(createHttpYahooApi(token), parsed.data.leagueKey);
    if (bundle.matchups.length === 0) {
      // The token was already used above — clear it here too, same as every
      // other exit path past the auth check, so a retry can't replay it.
      const response = NextResponse.json(
        { error: "This league has no scored weeks yet — Wrapped needs a played season." },
        { status: 422 },
      );
      response.cookies.delete(YAHOO_TOKEN_COOKIE);
      return response;
    }
    await persistBundle(db, bundle);

    const yourRosterId = resolveYourRosterId(bundle.teams, parsed.data.guid);

    const response = NextResponse.json({
      provider: "yahoo",
      leagueId: bundle.league.providerLeagueId,
      season: bundle.league.season,
      name: bundle.league.name,
      yourRosterId,
      teams: bundle.teams
        .map((t) => ({
          rosterId: t.providerRosterId,
          displayName: t.displayName,
          teamName: t.teamName,
          avatarUrl: t.avatarUrl,
          record: `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ""}`,
        }))
        .sort((a, b) => Number(a.rosterId) - Number(b.rosterId)),
    });
    response.cookies.delete(YAHOO_TOKEN_COOKIE);
    return response;
  } catch (error) {
    console.error("yahoo sync failed", error);
    const response = NextResponse.json(
      { error: "Could not sync that league from Yahoo. Try connecting again." },
      { status: 502 },
    );
    response.cookies.delete(YAHOO_TOKEN_COOKIE);
    return response;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run src/app/api/yahoo/sync/route.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/yahoo/sync
git commit -m "feat(yahoo): add sync route"
```

---

### Task 12: `YahooConnectFlow` component and `/connect/yahoo` page

**Files:**
- Create: `src/components/YahooConnectFlow.tsx`
- Create: `src/app/connect/yahoo/page.tsx`

**Interfaces:**
- Consumes: `GET /api/yahoo/leagues` (Task 10), `POST /api/yahoo/sync` (Task 11) — fetched
  client-side.
- Produces: the `/connect/yahoo` page the OAuth callback (Task 4) redirects to.

No test file for the component itself — covered by the Playwright e2e in Task 15. This
mirrors `LandingFlow.tsx`'s phase-state-machine pattern but starts at "leagues" (OAuth
already established identity, so there's no username step).

- [ ] **Step 1: Write the implementation**

```tsx
// src/components/YahooConnectFlow.tsx
"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LoadingScreen } from "@/components/LoadingScreen";
import { PendingStoryOverlay } from "@/components/PendingStoryOverlay";

type League = { leagueKey: string; name: string; season: number; teams: number };
type SyncedTeam = { rosterId: string; displayName: string; teamName: string | null; record: string };
type Synced = { leagueId: string; season: number; name: string; teams: SyncedTeam[]; yourRosterId: string | null };

type Phase =
  | { step: "loading" }
  | { step: "leagues"; leagues: League[]; guid: string }
  | { step: "syncing"; leagueName: string }
  | { step: "teams"; synced: Synced }
  | { step: "error"; message: string };

const EASE = [0.16, 1, 0.3, 1] as const;
const LIST = "mt-3 divide-y divide-chalk/12 border-y border-chalk/12";

export function YahooConnectFlow() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ step: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/yahoo/leagues")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not load your Yahoo leagues.");
        if (cancelled) return;
        if (data.leagues.length === 0) {
          setPhase({ step: "error", message: "No NFL fantasy leagues found on this Yahoo account." });
          return;
        }
        setPhase({ step: "leagues", leagues: data.leagues, guid: data.guid });
      })
      .catch((err) => {
        if (!cancelled) {
          setPhase({ step: "error", message: err instanceof Error ? err.message : "Something went wrong" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function syncLeague(league: League, guid: string) {
    setPhase({ step: "syncing", leagueName: league.name });
    try {
      const res = await fetch("/api/yahoo/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leagueKey: league.leagueKey, guid }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sync failed");
      if (data.yourRosterId) {
        router.push(`/w/yahoo/${data.leagueId}/${data.season}/${data.yourRosterId}`);
        return;
      }
      setPhase({ step: "teams", synced: data });
    } catch (err) {
      setPhase({ step: "error", message: err instanceof Error ? err.message : "Sync failed" });
    }
  }

  return (
    <div className="mt-10">
      <AnimatePresence mode="wait">
        {phase.step === "loading" && (
          <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-6">
            <LoadingScreen title="Checking your Yahoo leagues…" description="One second." />
          </motion.div>
        )}

        {phase.step === "leagues" && (
          <motion.div
            key="leagues"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.3, ease: EASE }}
          >
            <p className="label text-chalk-faint">Pick your league</p>
            <ul className={LIST}>
              {phase.leagues.map((league, i) => (
                <motion.li
                  key={league.leagueKey}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05, duration: 0.4, ease: EASE }}
                >
                  <button
                    type="button"
                    onClick={() => syncLeague(league, phase.guid)}
                    className="group flex w-full items-center justify-between gap-4 py-4 text-left"
                  >
                    <span className="min-w-0">
                      <span className="display block truncate text-xl group-hover:text-flag">{league.name}</span>
                      <span className="label mt-1.5 block text-chalk-faint">
                        {league.teams} teams · {league.season}
                      </span>
                    </span>
                    <span className="display shrink-0 text-xl text-chalk-faint group-hover:text-flag">→</span>
                  </button>
                </motion.li>
              ))}
            </ul>
          </motion.div>
        )}

        {phase.step === "syncing" && (
          <motion.div key="syncing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="py-6">
            <LoadingScreen
              title="Pulling the tape…"
              description={`Reading every week of ${phase.leagueName}. Nothing will be forgotten.`}
            />
          </motion.div>
        )}

        {phase.step === "teams" && (
          <motion.div key="teams" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }}>
            <p className="label text-chalk-faint">{phase.synced.name} · who are you?</p>
            <ul className={LIST}>
              {phase.synced.teams.map((team, i) => (
                <motion.li
                  key={team.rosterId}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04, duration: 0.4, ease: EASE }}
                >
                  <Link
                    href={`/w/yahoo/${phase.synced.leagueId}/${phase.synced.season}/${team.rosterId}`}
                    className="group flex w-full items-baseline justify-between gap-4 py-3.5"
                  >
                    <span className="min-w-0">
                      <span className="display block truncate text-lg group-hover:text-flag">{team.displayName}</span>
                      {team.teamName && <span className="label mt-1.5 block text-chalk-faint">{team.teamName}</span>}
                    </span>
                    <span className="label shrink-0 text-chalk-faint">{team.record}</span>
                    <PendingStoryOverlay />
                  </Link>
                </motion.li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>

      {phase.step === "error" && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-5 border-l-2 border-card-red bg-field-raised px-4 py-3 text-[14px] leading-[1.5] text-card-red"
          role="alert"
        >
          {phase.message}
        </motion.p>
      )}
    </div>
  );
}
```

```tsx
// src/app/connect/yahoo/page.tsx
import { YahooConnectFlow } from "@/components/YahooConnectFlow";

export default function ConnectYahoo() {
  return (
    <main className="relative flex min-h-dvh flex-col px-7 pt-16 pb-10 sm:mx-auto sm:w-full sm:max-w-md">
      <header>
        <p className="label text-chalk-faint">Yahoo Fantasy Football</p>
        <h1 className="display mt-5 text-[clamp(2.75rem,14vw,3.75rem)]">You're in.</h1>
      </header>
      <YahooConnectFlow />
    </main>
  );
}
```

- [ ] **Step 2: Verify it compiles and renders**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: no errors referencing these two files.

Run: `pnpm dev`, then visit `http://localhost:3000/connect/yahoo` directly (it will show the
error state, since there's no real token cookie in dev — that's expected at this stage;
full flow verification happens in Task 14 against a deployment).

- [ ] **Step 3: Commit**

```bash
git add src/components/YahooConnectFlow.tsx src/app/connect/yahoo
git commit -m "feat(yahoo): add league picker page"
```

---

### Task 13: Landing page entry point

**Files:**
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `GET /api/auth/yahoo/start` (Task 3), via a plain link (full navigation, not a
  fetch — the browser needs to actually leave the page for the OAuth redirect chain).

- [ ] **Step 1: Add the Connect Yahoo entry point and update the footer copy**

```tsx
// src/app/page.tsx
import Link from "next/link";
import { LandingFlow } from "@/components/LandingFlow";

export default function Home() {
  return (
    <main className="relative flex min-h-dvh flex-col px-7 pt-16 pb-10 sm:mx-auto sm:w-full sm:max-w-md">
      <header>
        <p className="label text-chalk-faint">Fantasy Football · 2025</p>
        <h1 className="display mt-5 text-[clamp(2.75rem,14vw,3.75rem)]">
          Your season,
          <br />
          <span className="text-flag">told straight.</span>
        </h1>
        <p className="mt-5 max-w-[34ch] text-[15px] leading-[1.55] text-pretty text-chalk-dim">
          Every start, sit, trade and bad beat — handed back to you with precision and a little
          cruelty. Built to be screenshotted.
        </p>
      </header>

      <LandingFlow />

      <Link
        href="/api/auth/yahoo/start"
        className="label mt-6 block border border-chalk/20 px-4 py-3.5 text-center transition-colors hover:border-flag hover:text-flag"
      >
        Connect Yahoo instead
      </Link>

      <footer className="label mt-auto pt-12 text-chalk-faint">Sleeper &amp; Yahoo leagues · ESPN coming</footer>
    </main>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: no errors referencing `src/app/page.tsx`

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(yahoo): add Connect Yahoo entry point to the landing page"
```

---

### Task 14: Environment variables and STATUS.md

**Files:**
- Modify: `.env.example`
- Modify: `STATUS.md`

- [ ] **Step 1: Add the new env vars**

```bash
# .env.example — append after the ANTHROPIC_API_KEY block

# Yahoo Fantasy Sports OAuth (Phase 6). Register an app at
# https://developer.yahoo.com/apps/create/ with the "Fantasy Sports" (read)
# permission checked. Yahoo requires an HTTPS redirect_uri — no localhost —
# so YAHOO_REDIRECT_URI should point at a deployed Vercel URL, not
# http://localhost:3000, and must match byte-for-byte what's registered.
YAHOO_CLIENT_ID=
YAHOO_CLIENT_SECRET=
YAHOO_REDIRECT_URI=

# 32 raw bytes, base64-encoded (openssl rand -base64 32). Encrypts the
# short-lived cookie that bridges the OAuth access token from the callback
# to the sync click — see docs/superpowers/specs/2026-08-11-yahoo-integration-design.md.
# Generate once; rotating it just invalidates any in-flight connect attempt.
YAHOO_COOKIE_SECRET=
```

- [ ] **Step 2: Update STATUS.md's "Blocked on Frank" and "Shipped" sections**

Move the Yahoo line from "Blocked on Frank" to "Shipped", and add ESPN's line stays put:

```markdown
<!-- STATUS.md: in the "Shipped" list, add: -->
- Yahoo ingest (OAuth 2.0, ephemeral access-token-only — no refresh token
  persisted) → normalized bundle → Postgres, same engine/story path as Sleeper

<!-- STATUS.md: in "Blocked on Frank", remove the Yahoo line, leaving: -->
## Blocked on Frank

- [ ] ESPN credentials/cookie auth → ESPN adapter (after Yahoo)
```

- [ ] **Step 3: Commit**

```bash
git add .env.example STATUS.md
git commit -m "docs(yahoo): add env vars and mark Yahoo phase shipped in STATUS.md"
```

---

### Task 15 (human-in-the-loop): Record a real Yahoo fixture and correct the adapter

This is the task described at the top of this plan. Everything up to here was built and
tested against a hand-built fixture that matches documented Yahoo conventions but is not a
real response. This task checks that against reality using Frank's actual Yahoo league and
fixes anything that doesn't match — exactly the discipline `fixtures/sleeper/` and
`scripts/record-fixtures.ts` already establish for the Sleeper adapter.

**Files:**
- Create: `scripts/record-yahoo-fixture.ts`
- Create: `fixtures/yahoo/<leagueKey>/*.json` (generated by the script, then committed)
- Possibly modify: `src/providers/yahoo/schemas.ts`, `src/providers/yahoo/normalize.ts`,
  `src/providers/yahoo/yahoo-json.ts` — wherever the real payload's shape differs from the
  hand-built one in Task 8's test.
- Modify: `src/providers/yahoo/normalize.test.ts` — point it at the real fixture directory
  the way `sleeper/normalize.test.ts` does, in addition to (not instead of) the hand-built
  unit test from Task 8, which still documents `cleanYahoo`'s contract in isolation.

**Interfaces:**
- Consumes: `createHttpYahooApi` (Task 6), a real Yahoo access token.

- [ ] **Step 1: Deploy this branch to a Vercel preview and register its redirect URI**

```bash
git push -u origin worktree-feat-yahoo-integration
```

Note the resulting Vercel preview URL (`https://fantasy-wrapped-git-<branch>-<scope>.vercel.app`
or similar — check the Vercel dashboard or `vercel ls`). In the Yahoo app console, add
`<preview-url>/api/auth/yahoo/callback` to the app's registered redirect URIs. Set
`YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET`, `YAHOO_REDIRECT_URI` (= that exact callback URL),
and `YAHOO_COOKIE_SECRET` (`openssl rand -base64 32`) as environment variables for the
Preview environment in Vercel.

- [ ] **Step 2: Run the OAuth flow once, by hand, in a browser**

Visit `<preview-url>/api/auth/yahoo/start`, sign in with your real Yahoo account, approve
the app, and land on `/connect/yahoo`. Confirm your real league(s) appear in the picker —
this alone validates Tasks 1–4 and the `/api/yahoo/leagues` route end to end. Don't click
sync yet.

- [ ] **Step 3: Get a short-lived access token to run the recorder script locally**

The recorder script isn't a browser — it needs a bearer token directly. Easiest path: open
your browser's devtools Network tab while on `/connect/yahoo`, find the `/api/yahoo/leagues`
request... that request doesn't expose the token (it stays server-side in the cookie), so
instead temporarily add one throwaway `console.log(token.access_token)` line in
`src/app/api/auth/yahoo/callback/route.ts` right after `exchangeCodeForToken`, redeploy,
repeat the sign-in, copy the token from the Vercel deployment's function logs
(`vercel logs <deployment-url>` or the dashboard), then **remove that console.log and
redeploy again** before doing anything else — it must never ship. The token is valid for
about an hour, plenty of time for the next step.

- [ ] **Step 4: Write and run the fixture recorder**

```typescript
// scripts/record-yahoo-fixture.ts
/**
 * Record all Yahoo API payloads for one league into fixtures/yahoo/<leagueKey>/.
 * Needs a live access token (see the implementation plan's Task 15 for how to get
 * one) — tokens expire in ~1 hour, so run this in one sitting.
 *
 * Usage: pnpm tsx scripts/record-yahoo-fixture.ts <leagueKey> <accessToken>
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHttpYahooApi } from "@/providers/yahoo/client";
import { fetchYahooPayloads } from "@/providers/yahoo";

async function main(): Promise<void> {
  const [leagueKey, accessToken] = process.argv.slice(2);
  if (!leagueKey || !accessToken) {
    console.error("Usage: pnpm tsx scripts/record-yahoo-fixture.ts <leagueKey> <accessToken>");
    process.exit(1);
  }

  const api = createHttpYahooApi(accessToken);
  console.log(`Fetching league ${leagueKey}...`);
  const payloads = await fetchYahooPayloads(api, leagueKey);

  const dir = path.join("fixtures", "yahoo", leagueKey);
  await fs.mkdir(dir, { recursive: true });
  const write = (name: string, data: unknown) =>
    fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify(data, null, 1));

  await write("league", payloads.league);
  await write("transactions", payloads.transactions);
  await write("draftresults", payloads.draftResults);
  for (const [week, data] of Object.entries(payloads.scoreboardByWeek)) {
    await write(`scoreboard-${week}`, data);
  }
  for (const [key, data] of Object.entries(payloads.rosterByTeamWeek)) {
    const [teamKey, week] = key.split(":");
    await write(`roster-${teamKey}-${week}`, data);
  }

  console.log(`Recorded to ${dir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

Run:

```bash
pnpm tsx scripts/record-yahoo-fixture.ts <your-league-key> <access-token>
```

- [ ] **Step 5: Compare the real payloads against what the adapter expects**

Open a couple of the recorded files (`fixtures/yahoo/<leagueKey>/league.json` is the most
important one) and check them against the assumptions flagged as unverified in the code:
`league.settings.playoff_start_week` / `num_playoff_teams` field names, whether
`roster_positions` entries look like `{"roster_position": {"position": "QB", "count": 1}}`,
whether Yahoo's transaction `status` value for a completed transaction is really the string
`"successful"`, and generally whether `cleanYahoo`'s output on the real payload matches the
flattened shape the hand-built Task 8 fixture assumed (temporarily
`console.log(JSON.stringify(cleanYahoo(require('../fixtures/yahoo/<leagueKey>/league.json')), null, 2))`
in a scratch script is the fastest way to see this).

- [ ] **Step 6: Fix whatever doesn't match**

Adjust field names in `schemas.ts` / `normalize.ts`, or `cleanYahoo`'s rules in
`yahoo-json.ts` if a real nesting pattern isn't one of the three documented cases it
handles. Re-run `./node_modules/.bin/vitest run src/providers/yahoo/` after each change.

- [ ] **Step 7: Point normalize.test.ts at the real fixture too**

Add a second `describe` block to `src/providers/yahoo/normalize.test.ts`, alongside the
existing hand-built-fixture one, that loads the real recorded fixture via
`createFixtureYahooApi` and `fetchYahooLeagueBundle` and asserts against your league's real
known values (team count, your team's actual record, etc.) — mirroring
`sleeper/normalize.test.ts`'s structure exactly.

- [ ] **Step 8: Run the full test suite**

Run: `./node_modules/.bin/vitest run`
Expected: PASS, including the new real-fixture assertions.

- [ ] **Step 9: Commit**

```bash
git add scripts/record-yahoo-fixture.ts fixtures/yahoo src/providers/yahoo
git commit -m "feat(yahoo): record real league fixture and correct adapter against it"
```

---

### Task 16: Playwright e2e for the connect flow

**Files:**
- Create: `tests/e2e/yahoo-connect.spec.ts`

**Interfaces:**
- Consumes: the running app (`/`, `/connect/yahoo`, `/api/yahoo/leagues`, `/api/yahoo/sync`).

The live Yahoo consent screen itself isn't something e2e can drive (it's a third-party
domain, and CI has no Yahoo credentials). This test mocks the network boundary at
`/api/yahoo/leagues` and `/api/yahoo/sync` (Playwright's route interception) and exercises
everything this app controls: the landing page's Connect Yahoo link, the picker rendering,
and the sync-to-story-redirect happy path.

- [ ] **Step 1: Check an existing e2e spec for the project's Playwright conventions**

Read `tests/e2e/*.spec.ts` (whichever covers the Sleeper landing flow) before writing this
one, and match its setup/teardown and selector style exactly.

- [ ] **Step 2: Write the test**

```typescript
// tests/e2e/yahoo-connect.spec.ts
import { expect, test } from "@playwright/test";

test.describe("Yahoo connect flow", () => {
  test("landing page links to the Yahoo OAuth start route", async ({ page }) => {
    await page.goto("/");
    const link = page.getByRole("link", { name: "Connect Yahoo instead" });
    await expect(link).toHaveAttribute("href", "/api/auth/yahoo/start");
  });

  test("picker renders leagues and syncing redirects to the story", async ({ page }) => {
    await page.route("**/api/yahoo/leagues", async (route) => {
      await route.fulfill({
        json: {
          guid: "GUID-1",
          leagues: [{ leagueKey: "423.l.1", name: "Legends Only League", season: 2025, teams: 10 }],
        },
      });
    });
    await page.route("**/api/yahoo/sync", async (route) => {
      await route.fulfill({
        json: {
          provider: "yahoo",
          leagueId: "423.l.1",
          season: 2025,
          name: "Legends Only League",
          yourRosterId: "3",
          teams: [],
        },
      });
    });

    await page.goto("/connect/yahoo");
    await expect(page.getByText("Legends Only League")).toBeVisible();
    await page.getByText("Legends Only League").click();
    await page.waitForURL("**/w/yahoo/423.l.1/2025/3");
  });

  test("shows an error state when Yahoo league discovery fails", async ({ page }) => {
    await page.route("**/api/yahoo/leagues", async (route) => {
      await route.fulfill({ status: 401, json: { error: "Your Yahoo session expired — sign in again." } });
    });
    await page.goto("/connect/yahoo");
    await expect(page.getByRole("alert")).toHaveText("Your Yahoo session expired — sign in again.");
  });
});
```

- [ ] **Step 3: Run it**

Run: `./node_modules/.bin/playwright test tests/e2e/yahoo-connect.spec.ts`
Expected: PASS (3 tests). If the "Connect Yahoo instead" selector doesn't match, check the
exact link text/role against Task 13's implementation of `src/app/page.tsx`.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/yahoo-connect.spec.ts
git commit -m "test(yahoo): add e2e coverage for the connect flow"
```

---

### Task 17: Final verification

- [ ] **Step 1: Full typecheck**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: no errors

- [ ] **Step 2: Full lint**

Run: `./node_modules/.bin/biome check .`
Expected: no errors (fix and re-run if any surface — do not use `pnpm lint`, see Global
Constraints)

- [ ] **Step 3: Full unit/integration test suite**

Run: `./node_modules/.bin/vitest run`
Expected: PASS, all suites including every Yahoo test file added in Tasks 1–15

- [ ] **Step 4: Full e2e suite**

Run: `./node_modules/.bin/playwright test`
Expected: PASS, including the existing Sleeper e2e tests (confirming nothing broke) and the
new Yahoo ones

- [ ] **Step 5: Production build**

Run: `pnpm build`
Expected: succeeds

- [ ] **Step 6: Manual smoke test against the Vercel preview from Task 15**

Run through the full flow once more end to end on the deployed preview: landing page →
Connect Yahoo → Yahoo consent → picker → sync → story renders with real data from your
league.

- [ ] **Step 7: Open the PR**

```bash
gh pr create --fill
```

Then follow the repo's standard git workflow (CLAUDE.md "Git workflow"): wait for CI green
via `gh pr view <n> --json statusCheckRollup`, then `gh pr merge --squash --delete-branch`.
