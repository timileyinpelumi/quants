import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/web/ui/Header";
import { getContext } from "@/web/server/context";
import { loadLatestSettings } from "@/domain/settings";
import { fmtAmount, lockLabel, lockShort } from "@/web/ui/format";
import { quoteCoins } from "@/domain/quotes";
import { launchCost } from "@/domain/launch-cost";
import { usdPrices } from "@/web/server/prices";

export const metadata: Metadata = { title: "Docs", description: "How quants works: launching, fees, reward baskets, staking, early exits and graduation." };
export const dynamic = "force-dynamic";

const SOL = "So11111111111111111111111111111111111111112";
const sections = [
  ["glance", "At a glance"], ["how", "How it works"], ["launch", "Launching a token"], ["fees", "Where fees go"], ["basket", "The reward basket"],
  ["staking", "Staking and lock tiers"], ["early", "Leaving early"], ["graduation", "Graduation"], ["risks", "Risks"], ["wallets", "Wallets and programs"], ["faq", "Questions"],
] as const;

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return <h2 id={id} className="m-0 pt-4 scroll-mt-28 font-display font-black text-2xl md:text-[32px] tracking-tight">{children}</h2>;
}
const P = ({ children }: { children: React.ReactNode }) => <p className="m-0 text-[17px] leading-relaxed text-[#C9C5D6]">{children}</p>;

function Table({ head, rows, text = false }: { head: string[]; rows: React.ReactNode[][]; text?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[15px] border-collapse">
        <thead>
          <tr>{head.map((h, i) => <th key={h} className={`py-2.5 pr-4 font-normal text-[13px] text-muted border-b line ${i && !text ? "text-right" : "text-left"}`}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j} className={`py-3 pr-4 border-b line ${j && !text ? "text-right font-mono" : "text-left"}`}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function DocsPage() {
  const ctx = getContext();
  const s = await loadLatestSettings(ctx.sql);
  const SOL_MINT = "So11111111111111111111111111111111111111112";
  const solUsd = (await usdPrices(ctx, [SOL_MINT]).catch(() => ({} as Record<string, number | null>)))[SOL_MINT] ?? null;
  const sol = (lamports: bigint) => `${fmtAmount(lamports, 9, 3)} SOL${solUsd ? ` (about $${(Number(lamports) / 1e9 * solUsd).toFixed(2)})` : ""}`;
  const one = launchCost(s, 1), three = launchCost(s, 3), ten = launchCost(s, 10);
  const pct = (bps: number) => `${bps / 100}%`;
  const solGrad = quoteCoins()[0]!.graduation;

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
          <h1 className="m-0 font-display font-black text-[40px] md:text-[56px] leading-[1.02] tracking-[-0.03em]">How quants works</h1>
          <P>quants launches tokens whose trading fees pay the people who stake them. This page covers what it costs, where every fee goes, and how staking and early exits work.</P>

          <H2 id="glance">At a glance</H2>
          <Table head={["", "Value"]} rows={[
            ["Launch fee with 1 reward token", sol(one.total)],
            ["Launch fee with 3 reward tokens", sol(three.total)],
            ["Launch fee with 10 reward tokens", sol(ten.total)],
            ["Trading fee, set by the creator", "1%, 2%, 3% or 5%"],
            ["Share of fees that buys staker rewards", `${pct(s.split.basketBps)} after Meteora's 20%`],
            ["Reward tokens per launch", "Up to 10"],
            ["Pair tokens", quoteCoins().map((c) => c.symbol).join(", ")],
            ["Supply of every token", "1,000,000,000"],
            ["Graduates to Meteora DAMM v2 at", `${solGrad} SOL raised, or the amount below for other pairs`],
            ["Lock tiers", s.tiers.map((t) => `${lockShort(t.lockSeconds)} ${t.multiplierBps / 10_000}x`).join(", ")],
            ["Most an early exit can burn", pct(s.maxPenaltyBps)],
          ]} />

          <H2 id="how">How it works</H2>
          <P>Anyone can launch a token on quants. Every trade of that token pays a small fee. Most of that fee buys up to ten tokens the creator picked, and those tokens are paid out to people who stake the launched token. Stake for longer and you earn a bigger share.</P>
          <P>Launches run on Meteora, the same pools that power much of Solana trading. Staking runs on Kamino Farms. quants itself holds no one&apos;s stake.</P>

          <H2 id="launch">Launching a token</H2>
          <P>Pick a name, a symbol and a square image, then choose what your token trades against: {quoteCoins().map((c) => c.symbol).join(", ")}. Choose a trading fee of 1%, 2%, 3% or 5% and pick your reward basket. You can buy some of your own token in the same approval, paid in SOL and swapped to the pair token if needed.</P>
          <P>Every token has a supply of 1,000,000,000. Launching costs a platform fee of {sol(s.launchFeeLamports)} plus the rent for the staking farms: one Kamino farm per lock tier, with an account for each reward token. That comes to {sol(three.total)} in all for a three token basket, plus network fees. A first buy is capped at {pct(s.devBuyCapBps)} of supply.</P>

          <H2 id="fees">Where fees go</H2>
          <P>Meteora keeps 20% of each trading fee. Of what is left:</P>
          <div className="flex flex-col text-[15px]">
            {[["The reward basket for stakers", s.split.basketBps], ["The platform", s.split.platformBps], ["The creator", s.split.creatorBps]].map(([l, v]) => (
              <span key={l as string} className="flex justify-between py-3 border-b line"><span>{l}</span><span className="font-mono">{pct(v as number)}</span></span>
            ))}
          </div>
          <P>For example, a 1 SOL buy of a token with a 2% trading fee:</P>
          <Table head={["Where it goes", "SOL"]} rows={(() => {
            const fee = 0.02, kept = fee * 0.8;
            const f = (n: number) => n.toFixed(4);
            return [
              ["Trading fee", f(fee)],
              ["Meteora", f(fee * 0.2)],
              ["Buys rewards for stakers", f(kept * s.split.basketBps / 10_000)],
              ["Platform", f(kept * s.split.platformBps / 10_000)],
              ["Creator", f(kept * s.split.creatorBps / 10_000)],
            ];
          })()} />
          <P>Fees are collected every few minutes. The creator share is sent to the creator once it passes {fmtAmount(s.creatorPayoutMin[SOL] ?? 0n, 9)} SOL.</P>

          <H2 id="basket">The reward basket</H2>
          <P>The basket is up to ten verified tokens with weights that add up to 100%. The basket share of every fee is swapped into those tokens and streamed to stakers over about {Math.round(s.rewardPeriodSeconds / 3600)} hours. If nobody is staked yet, rewards wait until someone is. The basket is fixed once staking opens for a token.</P>

          <H2 id="staking">Staking and lock tiers</H2>
          <P>Stake a launched token into one of these locks. A bigger multiplier means a bigger share of the rewards for the same amount staked.</P>
          <Table head={["Lock", "Multiplier", "Share of 1,000 staked, against 1,000 at 1x"]} rows={s.tiers.map((t) => {
            const m = t.multiplierBps / 10_000;
            return [lockLabel(t.lockSeconds), `${m}x`, `${Math.round((m / (m + 1)) * 100)}%`];
          })} />
          <P>Claim rewards whenever you like. Adding more to a stake that is still locked starts its lock again for the whole amount. When the lock ends you can withdraw everything with no penalty.</P>

          <H2 id="early">Leaving early</H2>
          <P>You can always leave before your lock ends. Up to {pct(s.maxPenaltyBps)} of your stake is burned, and the penalty shrinks every day you stay: leave with half your lock left and you lose half of {pct(s.maxPenaltyBps)}. The stake page shows the exact amount before you sign.</P>
          <P>Rewards you already earned are yours to keep. 100% of every penalty is burned. quants never receives any of it.</P>

          <H2 id="graduation">Graduation</H2>
          <P>New tokens trade on a bonding curve. When the curve has raised the amount below in its pair token, the token graduates to a Meteora DAMM v2 pool with permanently locked liquidity. Trading, fees, rewards and staking carry on as before.</P>
          <Table head={["Paired with", "Graduates at"]} rows={quoteCoins().filter((c) => c.graduation > 0).map((c) => [c.name === "quants" ? `${c.symbol} (platform token)` : `${c.symbol} (${c.name})`, `${c.graduation.toLocaleString("en-US")} ${c.symbol}`])} />

          <H2 id="risks">Risks</H2>
          <P>Launched tokens are highly volatile and most lose value. Reward tokens can lose value too. Smart contracts can have bugs. Only use money you can afford to lose. Read the <Link href="/terms" className="text-lime">terms and risks</Link>.</P>

          <H2 id="wallets">Wallets and programs</H2>
          <P>Every fee quants collects moves through these wallets, and every launch, trade and stake runs on these programs. Open any of them to check the record yourself.</P>
          <Table text head={["Address", "What it does"]} rows={[
            ...([
              [ctx.keeperAddress, "Keeper. Collects trading fees, buys reward tokens, funds the farms and pays creators"],
              [ctx.spillWallet.toBase58(), "Penalty wallet. Receives early exit penalties, which the keeper burns"],
              ...(process.env.TREASURY_ADDRESS ? [[process.env.TREASURY_ADDRESS, "Treasury. Receives the platform share"]] : []),
              ["dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN", "Meteora Dynamic Bonding Curve program"],
              ["cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG", "Meteora DAMM v2 program, where graduated tokens trade"],
              ["FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr", "Kamino Farms program, where stakes and rewards live"],
            ] as [string, string][]).map(([a, what]) => [
              <a key={a} href={`https://solscan.io/account/${a}`} target="_blank" rel="noreferrer" className="font-mono text-lime">{a.slice(0, 4)}…{a.slice(-4)}</a>, what,
            ]),
          ]} />

          <H2 id="faq">Questions</H2>
          {[
            ["Can quants take my stake?", "No. Stakes sit in Kamino Farms under your wallet. quants can fund rewards but cannot move your stake."],
            ["Why at most ten reward tokens?", "Kamino farms hold ten reward tokens each. Fewer tokens also means bigger payouts per token."],
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
