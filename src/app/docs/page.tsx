import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/web/ui/Header";
import { getContext } from "@/web/server/context";
import { loadLatestSettings } from "@/domain/settings";
import { fmtAmount } from "@/web/ui/format";

export const metadata: Metadata = { title: "Docs", description: "How quants works: launching, fees, reward baskets, staking, early exits and graduation." };
export const dynamic = "force-dynamic";

const SOL = "So11111111111111111111111111111111111111112";
const sections = [
  ["how", "How it works"], ["launch", "Launching a token"], ["fees", "Where fees go"], ["basket", "The reward basket"],
  ["staking", "Staking and lock tiers"], ["early", "Leaving early"], ["graduation", "Graduation"], ["risks", "Risks"], ["faq", "Questions"],
] as const;

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return <h2 id={id} className="m-0 pt-4 scroll-mt-28 font-display font-black text-2xl md:text-[32px] tracking-tight">{children}</h2>;
}
const P = ({ children }: { children: React.ReactNode }) => <p className="m-0 text-[17px] leading-relaxed text-[#C9C5D6]">{children}</p>;

export default async function DocsPage() {
  const s = await loadLatestSettings(getContext().sql);
  const pct = (bps: number) => `${bps / 100}%`;
  const ours = process.env.NEXT_PUBLIC_OURTOKEN_SYMBOL ?? "OURTOKEN";
  const solGrad = process.env.NEXT_PUBLIC_SOL_GRADUATION ?? "85";
  const oursGrad = process.env.NEXT_PUBLIC_OURTOKEN_GRADUATION;

  return (
    <div className="bg-launch flex-1">
      <Header active="docs" />
      <div className="grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)] gap-10 lg:gap-16 wrap pt-10 md:pt-14 pb-20">
        <aside className="lg:sticky lg:top-8 self-start">
          <nav aria-label="On this page" className="flex lg:flex-col gap-x-5 gap-y-1 overflow-x-auto lg:overflow-visible text-sm">
            {sections.map(([id, label]) => (
              <a key={id} href={`#${id}`} className="text-muted hover:text-ink min-h-9 flex items-center shrink-0">{label}</a>
            ))}
          </nav>
        </aside>

        <article className="flex flex-col gap-6 max-w-3xl">
          <h1 className="m-0 font-display font-black text-[40px] md:text-[64px] leading-[1.02] tracking-[-0.03em]">How quants<br /><span className="text-lime">works.</span></h1>

          <H2 id="how">How it works</H2>
          <P>Anyone can launch a token on quants. Every trade of that token pays a small fee. Most of that fee buys up to three tokens the creator picked, and those tokens are paid out to people who stake the launched token. Stake for longer and you earn a bigger share.</P>
          <P>Launches run on Meteora, the same pools that power much of Solana trading. Staking runs on Kamino Farms. quants itself holds no one&apos;s stake.</P>

          <H2 id="launch">Launching a token</H2>
          <P>Pick a name, a symbol and a square image, then choose what your token trades against: SOL or {ours}. Choose a trading fee of 1%, 2%, 3% or 5% and pick your reward basket. You can buy some of your own token in the same approval.</P>
          <P>Every token has a supply of 1,000,000,000. Launching costs {fmtAmount(s.launchFeeLamports, 9)} SOL plus network fees. A first buy is capped at {pct(s.devBuyCapBps)} of supply.</P>

          <H2 id="fees">Where fees go</H2>
          <P>Meteora keeps 20% of each trading fee. Of what is left:</P>
          <div className="flex flex-col text-[15px]">
            {[["The reward basket for stakers", s.split.basketBps], ["The platform", s.split.platformBps], ["The creator", s.split.creatorBps]].map(([l, v]) => (
              <span key={l as string} className="flex justify-between py-3 border-b line"><span>{l}</span><span className="font-mono">{pct(v as number)}</span></span>
            ))}
          </div>
          <P>Fees are collected every few minutes. The creator share is sent to the creator once it passes {fmtAmount(s.creatorPayoutMin[SOL] ?? 0n, 9)} SOL.</P>

          <H2 id="basket">The reward basket</H2>
          <P>The basket is up to three verified tokens with weights that add up to 100%. The basket share of every fee is swapped into those tokens and streamed to stakers over about {Math.round(s.rewardPeriodSeconds / 3600)} hours. If nobody is staked yet, rewards wait until someone is. The basket is fixed once staking opens for a token.</P>

          <H2 id="staking">Staking and lock tiers</H2>
          <P>Stake a launched token into one of these locks. A bigger multiplier means a bigger share of the rewards for the same amount staked.</P>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            {s.tiers.map((t) => (
              <span key={t.id} className="flex flex-col items-center gap-1 py-5 rounded-3xl bg-violet/[0.08] border border-violet/20">
                <span className="font-display font-black text-3xl text-violet-light">{t.multiplierBps / 10_000}x</span>
                <span className="text-sm text-muted">{Math.round(t.lockSeconds / 86_400)} days</span>
              </span>
            ))}
          </div>
          <P>Claim rewards whenever you like. Adding more to a stake that is still locked starts its lock again for the whole amount. When the lock ends you can withdraw everything with no penalty.</P>

          <H2 id="early">Leaving early</H2>
          <P>You can always leave before your lock ends. Up to {pct(s.maxPenaltyBps)} of your stake is burned, and the penalty shrinks every day you stay: leave with half your lock left and you lose half of {pct(s.maxPenaltyBps)}. The stake page shows the exact amount before you sign.</P>
          <P>Rewards you already earned are yours to keep. 100% of every penalty is burned. quants never receives any of it.</P>

          <H2 id="graduation">Graduation</H2>
          <P>New tokens trade on a bonding curve. When the curve raises {solGrad} SOL{oursGrad ? ` (or ${oursGrad} ${ours} for tokens paired with ${ours})` : ""}, the token graduates to a Meteora DAMM v2 pool with permanently locked liquidity. Trading, fees, rewards and staking carry on as before.</P>

          <H2 id="risks">Risks</H2>
          <P>Launched tokens are highly volatile and most lose value. Reward tokens can lose value too. Smart contracts can have bugs. Only use money you can afford to lose. Read the <Link href="/terms" className="text-lime">terms and risks</Link>.</P>

          <H2 id="faq">Questions</H2>
          {[
            ["Can quants take my stake?", "No. Stakes sit in Kamino Farms under your wallet. quants can fund rewards but cannot move your stake."],
            ["Why only three reward tokens?", "Three keeps the basket readable and each payout meaningful."],
            ["What if a reward token cannot be bought?", "Its share waits and is bought on a later run. The other basket tokens are unaffected."],
            ["Where does the platform share go?", "To the platform treasury. It pays for infrastructure and development."],
          ].map(([q, a]) => (
            <div key={q} className="flex flex-col gap-1.5 py-4 border-t line">
              <h3 className="m-0 font-display font-bold text-lg">{q}</h3>
              <P>{a}</P>
            </div>
          ))}
        </article>
      </div>
    </div>
  );
}
