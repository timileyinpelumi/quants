import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/web/ui/Header";
import { getContext } from "@/web/server/context";
import { cachedSettings } from "@/domain/settings";
import { fmtAmount, lockLabel, lockShort } from "@/web/ui/format";
import { quoteCoins } from "@/domain/quotes";
import { launchableQuotes } from "@/web/server/quotes";
import { launchCost } from "@/domain/launch-cost";
import { usdPrices } from "@/web/server/prices";

export const metadata: Metadata = { title: "Docs", description: "How quants works: launching, fees, reward baskets, staking, early exits and graduation." };
export const dynamic = "force-dynamic";

const SOL = "So11111111111111111111111111111111111111112";
const sections = [
  ["glance", "At a glance"], ["how", "How it works"], ["launch", "Launching a token"], ["fees", "Where fees go"], ["basket", "The reward basket"],
  ["opens", "When staking opens"], ["staking", "Staking and lock tiers"], ["early", "Leaving early"], ["graduation", "Graduation"], ["stocks", "Stock pairs"], ["risks", "Risks"], ["wallets", "Wallets and programs"], ["faq", "Questions"],
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
  const s = await cachedSettings(ctx.sql);
  const fees = s.feeTiersBps.map((b) => `${b / 100}%`);
  const feeList = fees.length > 1 ? `${fees.slice(0, -1).join(", ")} or ${fees.at(-1)}` : fees[0]!;
  const SOL_MINT = "So11111111111111111111111111111111111111112";
  const solUsd = (await usdPrices(ctx, [SOL_MINT]).catch(() => ({} as Record<string, number | null>)))[SOL_MINT] ?? null;
  const sol = (lamports: bigint) => `${fmtAmount(lamports, 9, 3)} SOL${solUsd ? ` (about $${(Number(lamports) / 1e9 * solUsd).toFixed(2)})` : ""}`;
  const one = launchCost(s, 1).rent, three = launchCost(s, 3).rent, ten = launchCost(s, 10).rent;
  // Stakers get basketBps of what is left after Meteora's 20%.
  const stakerShare = (feeBps: number) => (feeBps / 10_000) * 0.8 * (s.split.basketBps / 10_000);
  const volumeToOpen = (rent: bigint, feeBps: number) => Math.ceil(Number(rent) / 1e9 / stakerShare(feeBps));
  const pct = (bps: number) => `${bps / 100}%`;
  const coins = quoteCoins(undefined, s);
  const pairs = coins.filter((c) => c.enabled);
  const solGrad = coins[0]!.graduation;
  const stocks = (await launchableQuotes(ctx)).filter((c) => c.tradingOnly);
  const owners = s.split.platformBps + s.split.creatorBps;
  const creatorOnly = owners ? Math.round((s.split.creatorBps * 10_000) / owners) : 0;

  return (
    <div className="bg-launch flex-1">
      <Header active="docs" />
      <div className="grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)] gap-10 lg:gap-16 wrap pt-10 md:pt-14 pb-20">
        <aside className="lg:sticky lg:top-8 self-start">
          <nav aria-label="On this page" className="flex lg:flex-col gap-x-5 gap-y-1 overflow-x-auto lg:overflow-visible text-sm">
            {sections.filter(([id]) => id !== "stocks" || s.stockPairs).map(([id, label]) => (
              <a key={id} href={`#${id}`} className="text-muted hover:text-ink min-h-10 md:min-h-9 flex items-center shrink-0">{label}</a>
            ))}
          </nav>
        </aside>

        <article className="flex flex-col gap-6 max-w-3xl">
          <h1 className="m-0 font-display font-black text-[40px] md:text-[56px] leading-[1.02] tracking-[-0.03em]">How quants works</h1>
          <P>quants launches tokens whose trading fees pay the people who stake them. This page covers launching, where every fee goes, when staking opens, and how staking and early exits work.</P>

          <H2 id="glance">At a glance</H2>
          <Table head={["", "Value"]} rows={[
            ["Trading fee, set by the creator", feeList],
            ["Share of fees that buys staker rewards", `${pct(s.split.basketBps)} after Meteora's 20%`],
            ["Reward tokens per launch", "Up to 10"],
            ["Pair tokens", pairs.map((c) => c.symbol).join(", ")],
            ["Supply of every token", "1,000,000,000"],
            ["Graduates to Meteora DAMM v2 at", `${solGrad} SOL raised, or the amount below for other pairs`],
            ["Lock tiers", s.tiers.map((t) => `${lockShort(t.lockSeconds)} ${t.multiplierBps / 10_000}x`).join(", ")],
            ["Most an early exit can burn", pct(s.maxPenaltyBps)],
            ["Staking opens when the stakers' share has paid for the farms", `${sol(three)} with 3 reward tokens`],
          ]} />

          <H2 id="how">How it works</H2>
          <P>Anyone can launch a token on quants. Every trade of that token pays a small fee. Most of that fee buys up to ten tokens the creator picked, and those tokens are paid to people who stake the launched token. Longer locks earn a bigger share.</P>
          <P>Launches and trading run on Meteora. Staking runs on Kamino Farms. quants never holds anyone&apos;s stake.</P>

          <H2 id="launch">Launching a token</H2>
          <P>Pick a name, a symbol and a square image, then pick the pair token: {pairs.map((c) => c.symbol).join(", ")}. Choose a trading fee of {feeList} and pick your reward basket. An optional first buy of your own token goes in the same approval. It is paid in SOL and swapped to the pair token if needed.</P>
          <P>Every token has a supply of 1,000,000,000. Launching costs the Solana network fees and account rent for your transactions, plus any first buy. Your wallet shows the total before you approve. A first buy is capped at {pct(s.devBuyCapBps)} of supply.</P>
          <P>Staking does not open at launch. The staking farms are paid for out of the stakers&apos; share of trading fees, so a token can be staked once it has traded enough. See <a href="#opens" className="text-accent">When staking opens</a>.</P>

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
          <P>After graduation, pool LP fees go to the platform. The graduated pool&apos;s liquidity is locked forever in a position quants holds, and the fees that position earns are paid to the platform treasury in full. The split above applies to the bonding curve&apos;s trading fees.</P>
          <P>Fees are collected every few minutes. The creator share is sent to the creator once it passes {fmtAmount(s.creatorPayoutMin[SOL] ?? 0n, 9)} SOL. Until staking opens, the stakers&apos; share is held for the token and first pays for its staking farms.</P>

          <H2 id="basket">The reward basket</H2>
          <P>The basket is up to ten verified tokens with weights that add up to 100%. The basket share of every fee is swapped into those tokens and streamed to stakers over about {Math.round(s.rewardPeriodSeconds / 3600)} hours. If nobody is staked yet, rewards wait until someone is. The basket is fixed once staking opens for a token.</P>

          <H2 id="opens">When staking opens</H2>
          <P>Staking a token needs one Kamino farm per lock tier ({s.tiers.length}), with an account for each reward token, plus the transaction fees to set them up. The stakers&apos; share of trading fees is held until it covers that cost, which is then taken from it to create the farms. Staking opens right after, and from then on the whole stakers&apos; share buys rewards.</P>
          <Table head={["Reward tokens", "Farm setup"]} rows={[["1", sol(one)], ["3", sol(three)], ["10", sol(ten)]]} />
          <P>Stakers get {pct(s.split.basketBps)} of each trading fee after Meteora&apos;s 20%. So with 3 reward tokens, staking opens after about this much trading volume:</P>
          <Table head={["Trading fee", "Volume to open staking"]} rows={s.feeTiersBps.map((bps) => [pct(bps), `${volumeToOpen(three, bps).toLocaleString("en-US")} SOL`])} />
          <P>Tokens paired with something other than SOL count their stakers&apos; share at its value in SOL. Each token page shows how far along it is, as a percent and as the amount still needed.</P>

          <H2 id="staking">Staking and lock tiers</H2>
          <P>Once staking opens, stake a launched token into one of these locks. A bigger multiplier means a bigger share of the rewards for the same amount staked.</P>
          <Table head={["Lock", "Multiplier", "Share of 1,000 staked, against 1,000 at 1x"]} rows={s.tiers.map((t) => {
            const m = t.multiplierBps / 10_000;
            return [lockLabel(t.lockSeconds), `${m}x`, `${Math.round((m / (m + 1)) * 100)}%`];
          })} />
          <P>Claim rewards at any time. Adding more to a stake that is still locked starts its lock again for the whole amount. When the lock ends you can withdraw everything with no penalty.</P>

          <H2 id="early">Leaving early</H2>
          <P>You can leave before your lock ends. Up to {pct(s.maxPenaltyBps)} of your stake is burned, and the penalty shrinks every day you stay: leave with half your lock left and you lose half of {pct(s.maxPenaltyBps)}. The stake page shows the exact amount before you sign.</P>
          <P>Rewards already earned stay yours. 100% of every penalty is burned. quants never receives any of it.</P>

          <H2 id="graduation">Graduation</H2>
          <P>New tokens trade on a bonding curve. When the curve has raised the amount below in its pair token, the token graduates to a Meteora DAMM v2 pool with permanently locked liquidity. Trading and staking continue, and rewards already bought keep streaming to stakers. After graduation, pool LP fees go to the platform.</P>
          <Table head={["Paired with", "Graduates at"]} rows={pairs.filter((c) => c.graduation > 0).map((c) => [c.name === "quants" ? `${c.symbol} (platform token)` : `${c.symbol} (${c.name})`, `${c.graduation.toLocaleString("en-US")} ${c.symbol}`])} />

          {s.stockPairs && <>
            <H2 id="stocks">Stock pairs</H2>
            <P>A token can also be paired with a tokenized stock from xStocks or Backpack{stocks.length ? `: ${stocks.map((c) => c.symbol).join(", ")}` : ""}. These launches are trading only. They have no reward basket and no staking, because Kamino farms cannot hold stock tokens. The share of fees that would buy rewards goes to the creator and the platform instead, so the creator gets {pct(creatorOnly)} and the platform {pct(10_000 - creatorOnly)} of what is left after Meteora&apos;s 20%.</P>
            <P>The company behind a stock token can pause it, for example around a corporate action. While it is paused nobody can buy or sell tokens paired with it, and quants waits to collect fees, pay creators and graduate those tokens until it is resumed. Nothing is lost while it waits.</P>
            <P>Meteora accepts a stock as a pair only once it has a token badge for that stock, and quants offers only stocks that have one and that pass its checks: no transfer fee and no transfer hook.</P>
            <P>Some stock tokens scale the amount a wallet shows, to account for dividends and splits. quants shows balances and trade amounts the way your wallet does. Transactions, charts and graduation progress use the amounts recorded on chain.</P>
            {stocks.some((c) => c.graduation > 0) && <Table head={["Paired with", "Graduates at"]} rows={stocks.filter((c) => c.graduation > 0).map((c) => [`${c.symbol} (${c.name})`, `${c.graduation.toLocaleString("en-US")} ${c.symbol}`])} />}
          </>}

          <H2 id="risks">Risks</H2>
          <P>Launched tokens are volatile and most lose value. Reward tokens can lose value too. Smart contracts can have bugs. Only use money you can afford to lose. Read the <Link href="/terms" className="text-accent">terms and risks</Link>.</P>

          <H2 id="wallets">Wallets and programs</H2>
          <P>Every fee quants collects moves through these wallets, and every launch, trade and stake runs on these programs.</P>
          <Table text head={["Wallet or program", "What it does"]} rows={[
            ["Keeper", "Collects trading fees, buys reward tokens, funds the farms and pays creators"],
            ["Penalty wallet", "Receives early exit penalties, which the keeper burns"],
            ["Treasury", "Receives the platform share and the LP fees of graduated pools"],
            ["Meteora Dynamic Bonding Curve", "Where new tokens trade until they graduate"],
            ["Meteora DAMM v2", "Where graduated tokens trade"],
            ["Kamino Farms", "Where stakes and rewards live"],
          ]} />

          <H2 id="faq">Questions</H2>
          {[
            ["Why can't I stake a token right after launch?", "Its stakers' share of trading fees first pays for the staking farms. The token page shows the percent toward opening."],
            ["Can quants take my stake?", "No. Stakes sit in Kamino Farms under your wallet. quants can fund rewards but cannot move your stake."],
            ["Why at most ten reward tokens?", "Kamino farms hold ten reward tokens each. Fewer tokens also means bigger payouts per token."],
            ["What if a reward token cannot be bought?", "Its share waits and is bought on a later run. The other basket tokens are unaffected."],
            ["Where does the platform share go?", "To the platform treasury. It pays for infrastructure and development."],
            ["Who gets the fees after a token graduates?", "The curve's trading fees stop and the token trades in a Meteora pool. The LP fees of that pool go to the platform."],
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
