import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { PageviewTracker } from "@/components/analytics/PageviewTracker";
import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  // The production domain, not the per-deployment VERCEL_URL — share links
  // must survive future redeploys and never point at a preview-protected URL.
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000",
  ),
  title: "Fantasy Wrapped",
  description:
    "Your fantasy football season, told back to you with precision and a little cruelty.",
};

export const viewport: Viewport = {
  // The page ground, a shade darker than the card surface.
  themeColor: "#060607",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="grain min-h-full flex flex-col">
        <Suspense fallback={null}>
          <PageviewTracker />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
