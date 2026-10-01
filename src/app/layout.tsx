import type { Metadata } from "next";
import { Unbounded, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/web/wallet/Providers";
import { Footer } from "@/web/ui/Footer";

const unbounded = Unbounded({ subsets: ["latin"], weight: ["500", "700", "900"], variable: "--font-unbounded" });
const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: { default: "quants", template: "%s · quants" },
  description: "Launch a token that pays its stakers. Trading fees buy up to ten tokens the creator picks and pay them to people who stake it.",
  openGraph: { title: "quants", description: "Launch a token that pays its stakers. Trading fees buy up to ten tokens the creator picks and pay them to people who stake it.", images: ["/brand/quants-logo-512h.png"] },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${unbounded.variable} ${geist.variable} ${mono.variable}`}>
      <body className="min-h-screen flex flex-col">
        <Providers>
          <div className="flex-1 flex flex-col">{children}</div>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
