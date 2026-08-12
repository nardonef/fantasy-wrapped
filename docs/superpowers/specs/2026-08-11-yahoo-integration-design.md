# Yahoo integration — design

Phase 6 (STATUS.md), previously blocked on Frank's Yahoo developer app credentials — now
unblocked, he has a registered app. This spec covers the Yahoo adapter and the OAuth flow
it requires; ESPN stays out of scope (separate phase, cookie-based auth, "after Yahoo" per
STATUS.md).

## Why this looks different from Sleeper

Sleeper's Fantasy API is public and unauthenticated — `/api/sleeper/leagues` just resolves
a username. Yahoo's Fantasy Sports API has no unauthenticated access at all: every request
needs a user-authorized OAuth 2.0 access token. So "connect a league" for Yahoo is
necessarily a real "Sign in with Yahoo" step, not a text field.

## Decisions confirmed with Frank

- **Token persistence: ephemeral, sync-only.** No refresh token is ever stored. We use the
  access token once, to pull the full season bundle into Postgres (same shape and same
  "raw payload in jsonb, re-run the engine without re-fetching" model Sleeper already
  uses), then discard it. Re-syncing later means re-authing. This matches the product's
  existing "sync once" model and avoids building token encryption-at-rest, refresh-token
  rotation, or revocation handling for a benefit (silent re-sync) the product doesn't need
  yet.
- **League discovery: auto-discover, not manual key entry.** After OAuth, we call Yahoo's
  own "leagues for the logged-in user" endpoint and show a picker — the OAuth token already
  identifies the user, so there's no analog to Sleeper's username-lookup step.
- **Token bridging: short-lived encrypted cookie.** Between the OAuth callback (which gets
  the access token) and the sync click (which needs it), the token has to live somewhere
  for a few minutes while the user looks at the league picker. An httpOnly, encrypted,
  ~10-minute-TTL cookie holds only the access token (never the refresh token). Cleared
  after the sync request completes or expires.
- **Adapter file split: mirrors Sleeper's four-file pattern exactly** (`client.ts` /
  `schemas.ts` / `normalize.ts` / `index.ts`), same two-function public surface
  (`fetchYahooPayloads` / `fetchYahooLeagueBundle`) returning the same
  `NormalizedLeagueBundle`. Nothing downstream (persist, engine) needs to know Yahoo
  exists.
- **Sync route: separate `/api/yahoo/sync`**, not a `provider` branch on the existing
  `/api/sync`. The request shapes genuinely differ (cookie-based auth vs. a bare
  `leagueId`), so a shared route would need the branching anyway — two small routes stay
  more readable than one route serving two auth models.
- **Dev-loop: test OAuth against a deployed URL, not `pnpm dev`.** Yahoo doesn't accept
  plain `http://localhost` as a redirect URI (confirmed against Yahoo's own OAuth docs and
  developer reports — HTTPS is required, `oob` is the only non-URL alternative and doesn't
  fit a web app). Rather than run a local TLS proxy, we register the redirect URI against a
  Vercel deployment and iterate there.

## OAuth flow

1. Landing page gets a "Connect Yahoo" entry point alongside the existing Sleeper flow.
2. Click → `GET /api/auth/yahoo/start`: builds the authorization URL
   (`https://api.login.yahoo.com/oauth2/request_auth?client_id=...&redirect_uri=...&response_type=code&state=...`),
   sets a random `state` value in a short-lived httpOnly cookie (CSRF check), redirects the
   browser to Yahoo.
3. User authorizes → Yahoo redirects to `GET /api/auth/yahoo/callback?code=...&state=...`.
   We verify `state` against the cookie, then exchange `code` for an access token at
   `https://api.login.yahoo.com/oauth2/get_token` (`grant_type=authorization_code`,
   `client_secret_basic` auth per RFC 2617 — `Authorization: Basic base64(client_id:client_secret)`).
4. With the access token, call
   `/users;use_login=1/games;game_codes=nfl/leagues?format=json` to list the user's NFL
   fantasy leagues across seasons.
5. Set the encrypted access-token cookie, redirect to a league-picker screen seeded with
   that list (same UX shape as Sleeper's league picker today).
6. Picking a league calls `POST /api/yahoo/sync` with `{ leagueKey, season }`. The route
   reads the token from the cookie, syncs, clears the cookie.

## Adapter (`src/providers/yahoo/`)

- **`client.ts`** — fetch wrapper: `getUserLeagues`, `getLeague`, `getStandings`,
  `getScoreboard(week)`, `getRoster(teamKey, week)`, `getTransactions`, `getDraftResults`,
  all hitting `https://fantasysports.yahooapis.com/fantasy/v2/...?format=json` with
  `Authorization: Bearer <token>`. Plus `createFixtureYahooApi` for tests/eval, matching
  Sleeper's fixture-replay pattern.
- **`schemas.ts`** — zod schemas for Yahoo's JSON shape, which is not clean JSON-API:
  collections come back as objects with numeric string keys plus a `count` field
  (`{"0": {...}, "1": {...}, "count": 2}`), and many resources are arrays of single-key
  objects. Needs a small shared preprocessor (e.g. `yahooCollection(itemSchema)`) rather
  than hand-parsing each endpoint — this is the shape most likely to break silently, so it
  gets its own unit tests (see Testing).
- **`normalize.ts`** — maps Yahoo payloads to `NormalizedLeagueBundle`. Key differences
  from Sleeper's normalize:
  - `game_key` is season-specific and numeric (no stable "nfl" alias across seasons), so we
    resolve it once via `/games;game_codes=nfl;seasons={season}` and build
    `league_key = {game_key}.l.{league_id}`.
  - `team_key` (`{league_key}.t.{team_id}`) stands in for Sleeper's `providerRosterId`.
  - No single "all matchups for the league" call exists — points come from
    `team/{team_key}/roster;week={w}/players;out=stats`, called once per team per week.
    Bigger fan-out than Sleeper's per-week call, same `Promise.all`-per-week pattern.
- **`index.ts`** — `fetchYahooPayloads` + `fetchYahooLeagueBundle`, same public shape as
  Sleeper's `index.ts`.

## Routes

- `GET /api/auth/yahoo/start` — builds auth URL, sets `state` cookie, redirects.
- `GET /api/auth/yahoo/callback` — verifies `state`, exchanges code, fetches league list,
  sets encrypted access-token cookie, redirects to picker.
- `POST /api/yahoo/sync` — reads token cookie, calls `fetchYahooLeagueBundle`, persists via
  the existing (already provider-agnostic) `persistBundle`, clears the cookie. Returns the
  same response shape `/api/sync` returns today (`provider, leagueId, season, name,
  yourRosterId, teams`) so `LandingFlow` and the story routes need minimal branching. Same
  `SYNCS_PER_HOUR` rate limiter as `/api/sync`, keyed by IP.

### Error handling specific to Yahoo

- Token cookie missing/expired at sync time (user sat on the picker past the ~10 min TTL) →
  401, "Your Yahoo session expired — sign in again."
- Yahoo access token expires mid-request (hard 1-hour limit) → same message. No silent
  refresh — we deliberately don't hold a refresh token.
- League has no completed season → existing 422 Sleeper already returns ("This league has
  no scored weeks yet — Wrapped needs a played season.").

## Cookie encryption

No new dependency: Node's built-in `crypto` (AES-256-GCM) is sufficient for both the
`state` CSRF cookie (random value, no encryption needed, just httpOnly+secure+compared on
callback) and the access-token bridging cookie (encrypted, since it carries a live bearer
token). Key comes from a new env var, generated once and set in Vercel + `.env`.

## New env vars

- `YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET` — from Frank's registered Yahoo app.
- `YAHOO_REDIRECT_URI` — the exact callback URL registered on the Yahoo app; must match
  byte-for-byte at both the `/start` and `/callback` steps.
- `YAHOO_COOKIE_SECRET` — 32-byte key (base64) for AES-256-GCM cookie encryption, generated
  once (`openssl rand -base64 32`), not derived from anything else.

## Action items for Frank (outside this repo)

- Register redirect URIs on the Yahoo app console: the production URL
  (`https://fantasy-wrapped-three.vercel.app/api/auth/yahoo/callback`) and a Vercel
  branch-preview alias for this feature branch once it exists
  (`https://fantasy-wrapped-git-<branch>-<scope>.vercel.app/api/auth/yahoo/callback` —
  exact value confirmed once the branch is pushed and Vercel assigns the alias).
- Confirm the "Fantasy Sports" API permission (read) is checked on the app.
- Provide `YAHOO_CLIENT_ID` / `YAHOO_CLIENT_SECRET` via `.env` locally and Vercel env vars
  for the branch — not pasted into chat/committed to the repo.

## Testing

Same eval-loop model as Sleeper: once the OAuth flow works end-to-end against Frank's real
Yahoo league, record the raw payloads to `fixtures/yahoo/` (one authenticated fetch, saved
to disk, replayed via `createFixtureYahooApi` from then on — no live Yahoo calls in CI or
`pnpm eval`). Golden-file tests for `normalizeYahooLeague` mirror
`sleeper/normalize.test.ts`'s pattern. `schemas.ts`'s numeric-keyed-collection parsing gets
direct unit tests, since it's the shape most likely to regress silently against a Yahoo API
response shape change. Playwright e2e for the new landing → OAuth-start → (mocked) callback
→ picker path, per the repo's "every new user-facing flow ships with an e2e test" rule —
the live Yahoo consent screen itself isn't something e2e can drive, so the test mocks the
callback's token exchange and asserts the picker renders and sync fires.

## Non-goals (this phase)

- Refresh-token persistence / silent re-sync without re-auth.
- ESPN adapter (separate phase, cookie-based auth).
- Multi-league-per-user account model — each sync is still a one-shot "connect this one
  league" action, same as Sleeper today.
