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
