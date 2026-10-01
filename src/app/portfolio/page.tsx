import type { Metadata } from "next";
import { Header } from "@/web/ui/Header";
import { PortfolioApp } from "@/web/portfolio/PortfolioApp";

export const metadata: Metadata = { title: "Portfolio" };

export default function PortfolioPage() {
  return (
    <div className="bg-stake-page flex-1">
      <Header active="portfolio" />
      <PortfolioApp />
    </div>
  );
}
