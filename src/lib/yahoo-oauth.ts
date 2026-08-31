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
  url.searchParams.set("scope", "fspt-r");
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
