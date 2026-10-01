import type { Metadata } from "next";
import { Header } from "@/web/ui/Header";

export const metadata: Metadata = { title: "Terms and risks" };

const items: [string, string][] = [
  ["What quants is", "quants is software that helps you launch tokens on Meteora and stake them on Kamino Farms. You interact with those programs directly from your own wallet. quants never holds your stake."],
  ["No advice", "Nothing on quants is financial, investment or legal advice. Tokens launched here are created by their launchers, not by quants, and quants does not vouch for any of them."],
  ["Your responsibility", "You are responsible for what you launch, buy, stake and sign, for keeping your wallet safe, and for following the laws where you live. Launchers must have the right to use the names, symbols, images and links they submit."],
  ["Risks", "Token prices can fall to zero. Reward tokens can lose value. Programs and this site can have bugs. Networks can be slow or fail. Leaving a stake early burns part of it. Transactions on Solana cannot be reversed."],
  ["Fees", "Trading fees, the launch fee and early exit penalties work as described in the docs. Settings can change for new launches and future fees. Existing stakes keep the lock tiers and penalty they started with."],
  ["Availability", "quants is provided as is. We can change or pause the site at any time. Your tokens and stakes stay on chain and can be reached through Meteora and Kamino without this site."],
];

export default function TermsPage() {
  return (
    <div className="bg-launch flex-1">
      <Header active="other" />
      <main className="wrap pt-10 md:pt-14 pb-20">
        <div className="mx-auto max-w-3xl flex flex-col gap-6">
        <h1 className="m-0 font-display font-black text-[40px] md:text-[56px] tracking-[-0.03em] leading-none">Terms and risks</h1>
        <p className="m-0 text-muted">By using quants you accept the following.</p>
        {items.map(([h, t]) => (
          <section key={h} className="flex flex-col gap-2 py-4 border-t line">
            <h2 className="m-0 font-display font-bold text-xl">{h}</h2>
            <p className="m-0 text-[17px] leading-relaxed text-[#C9C5D6]">{t}</p>
          </section>
        ))}
        </div>
      </main>
    </div>
  );
}
