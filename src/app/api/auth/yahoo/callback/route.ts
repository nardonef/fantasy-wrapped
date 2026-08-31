import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  encryptCookieValue,
  YAHOO_STATE_COOKIE,
  YAHOO_TOKEN_COOKIE,
  YAHOO_TOKEN_COOKIE_MAX_AGE_S,
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
