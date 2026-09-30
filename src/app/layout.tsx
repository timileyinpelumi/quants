import type { Metadata } from "next";
import Script from "next/script";
import { Unbounded, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/web/wallet/Providers";

const unbounded = Unbounded({ subsets: ["latin"], weight: ["500", "700", "900"], variable: "--font-unbounded" });
const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = { title: "quants", description: "Launch a token. Stakers earn three." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${unbounded.variable} ${geist.variable} ${mono.variable}`}>
      <body className="min-h-screen">
        <Providers>{children}</Providers>
        <Script src="https://plugin.jup.ag/plugin-v1.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
