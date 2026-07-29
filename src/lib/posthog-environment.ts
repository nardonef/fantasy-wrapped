/**
 * Next.js only inlines NEXT_PUBLIC_-prefixed vars into the browser bundle, so
 * a helper called from both server and client code needs both names: Vercel
 * sets VERCEL_ENV for server code and auto-populates the NEXT_PUBLIC_ twin
 * for the client (same convention layout.tsx already relies on for the
 * production URL).
 */
export type PostHogEnvironment = "production" | "preview" | "development";

export function getPostHogEnvironment(): PostHogEnvironment {
  const vercelEnv = process.env.VERCEL_ENV ?? process.env.NEXT_PUBLIC_VERCEL_ENV;
  if (vercelEnv === "production" || vercelEnv === "preview") return vercelEnv;
  return "development";
}
