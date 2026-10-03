import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/web/wallet/Providers";
import { Footer } from "@/web/ui/Footer";
import { siteSettings } from "@/web/server/site";

// Banner, X link and the featured card come from admin settings, so every page renders per request.
export const dynamic = "force-dynamic";

const bricolage = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage" });
const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : `http://localhost:${process.env.PORT || 3000}`)),
  title: { default: "quants", template: "%s · quants" },
  description: "Launch a token that pays its stakers. Trading fees buy up to ten tokens the creator picks and pay them to people who stake it.",
  openGraph: { title: "quants", description: "Launch a token that pays its stakers. Trading fees buy up to ten tokens the creator picks and pay them to people who stake it." },
  twitter: { card: "summary_large_image", title: "quants", description: "Launch a token that pays its stakers." },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { bannerMessage } = await siteSettings();
  return (
    <html lang="en" className={`${bricolage.variable} ${geist.variable} ${mono.variable}`}>
      <body className="min-h-screen flex flex-col">
        {bannerMessage && (
          <div role="status" data-site-banner className="bg-accent text-ground text-center text-sm font-semibold px-4 py-2.5">{bannerMessage}</div>
        )}
        <Providers>
          <div className="flex-1 flex flex-col">{children}</div>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
