import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Routes PostHog ingestion through this app's own domain so ad blockers
  // don't drop capture calls. Swap "us" for "eu" here (and in
  // instrumentation-client.ts's ui_host) if the project is on EU cloud.
  // https://posthog.com/docs/advanced/proxy/nextjs
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://us.i.posthog.com/:path*",
      },
    ];
  },
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
