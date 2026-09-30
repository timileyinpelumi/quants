# Quants Web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the quants web app (launch, explore, token, stake, admin) on top of the plan 1 backend, in the approved visual style.

**Architecture:** Next.js 16 App Router lives in the same package under `src/app`, running on the Bun runtime (`bun --bun next …`) so route handlers use `Bun.SQL` and the plan 1 modules directly. Web-only code sits in `src/web` (`server/` for route logic behind injectable context, `ui/` for components, `wallet/` for wallet plumbing). The server never signs for users: it returns unsigned transactions that the browser wallet signs.

**Tech Stack:** Next 16.3.8, React 19.3, Tailwind 4.3 (`@tailwindcss/postcss`), `next/font/google` (Unbounded, Geist, Geist Mono), `@solana/wallet-adapter-react` 0.15 + `-react-ui` 0.9 (Wallet Standard auto-detect, `wallets={[]}`), `lightweight-charts` 5.2, `jose` 6, `tweetnacl`, `image-size` 2, Pinata REST v3, GeckoTerminal v2, Jupiter plugin script + `api.jup.ag`, Playwright 1.63.

**Spec:** `docs/specs/2026-09-30-quants-web-design.md` (web) and `docs/specs/2026-09-30-quants-design.md` (core). Visual reference: design canvas "Quants design direction".

## Global Constraints

- Bun only. Dev/build/start are `bun --bun next dev|build|start`.
- Git identity `timileyinpelumi <timmypelumy@gmail.com>`; no AI attribution lines.
- Money stays `bigint` base units end to end; the browser receives amounts as decimal strings.
- Design tokens exactly as the web spec table: ground `#0A0A0F`, surface `#111018`, raised `#16151E`/`#1B1A24`, line `rgba(255,255,255,0.07)`, text `#F4F2EE`, muted `#9A97A8`, faint `#6F6C7E`, lime `#C8FF3D`, violet `#9D8CFF`/`#BDB2FF`, orange `#FF9B7A`; Unbounded 700/900 display, Geist body, Geist Mono numbers; pill buttons; panels radius 32px.
- Lists are flat divider rows, not cards. UI copy is plain, with no hyphens or dashes.
- Every page works at 390px wide. Touch targets at least 44px.
- The server never holds a user key and never signs user transactions.
- Admin routes require the session cookie from `/api/admin/session`.
- Minimal comments, only for non-obvious constraints.

## Review Focus

1. A wallet rejects signing, or the launch transaction fails after `prepare`: the form stays filled, shows the error, and a retry prepares a fresh transaction (new mint) without a stuck state (Task 7).
2. The chart source rate limits (429) or has no data yet for a brand new pool: the token page renders with an empty chart state, not an error page (Task 9).
3. A staker adds to a position that is still locked: the stake page says the whole position's lock restarts before they sign (Task 12).
4. An admin session cookie is replayed after the wallet is removed from `ADMIN_WALLETS`: admin routes refuse it (Task 13).
5. Someone uploads a non-square, oversized or non-image file: `/api/metadata` rejects it with a readable message before anything reaches Pinata (Task 5).

---

## File Structure

```
src/app/
  layout.tsx, globals.css, page.tsx (Launch), explore/page.tsx, t/[mint]/page.tsx, t/[mint]/stake/page.tsx, admin/page.tsx
  api/health/route.ts
  api/metadata/route.ts
  api/tokens/search/route.ts
  api/launch/prepare/route.ts, api/launch/confirm/route.ts
  api/launches/route.ts, api/launches/[mint]/route.ts, api/launches/[mint]/positions/route.ts
  api/chart/[mint]/route.ts
  api/stake/[action]/route.ts
  api/admin/nonce/route.ts, api/admin/session/route.ts, api/admin/settings/route.ts, api/admin/status/route.ts, api/admin/basket/route.ts
src/web/
  server/context.ts      WebContext, getContext, setContextForTests
  server/http.ts         json, jsonError, readJson
  server/pinata.ts       PinataPort + PinataRest
  server/image.ts        validateImage
  server/launch.ts       prepareWithSwap (OURTOKEN first buy)
  server/reads.ts        listLaunches, launchDetail, positions
  server/chart.ts        GeckoChart with cache
  server/admin.ts        nonce + session (jose, tweetnacl)
  ui/                    tokens.ts, format.ts, Button.tsx, Field.tsx, Avatar.tsx, Header.tsx, Segmented.tsx, FlatRow.tsx
  wallet/Providers.tsx, wallet/send.ts, wallet/test-wallet.ts
  launch/LaunchForm.tsx, launch/BasketPicker.tsx
  token/Chart.tsx, token/TradePanel.tsx
  stake/StakePanel.tsx, stake/Positions.tsx
  admin/AdminApp.tsx
tests/web/…              mirrors src/web/server
e2e/smoke.spec.ts        Playwright
deploy/Caddyfile, deploy/quants-web.service, deploy/quants-keeper.service
```

---

### Task 1: Jupiter API host and key

The keyless `lite-api.jup.ag` host is being retired. Move the keeper and token search to `api.jup.ag` with an optional API key.

**Files:**
- Modify: `src/jupiter/port.ts`, `src/env.ts`, `src/keeper/main.ts`, `.env.example`
- Test: `tests/jupiter/port.test.ts`

**Interfaces:**
- Produces: `new JupiterLive(baseUrl: string, chain: SolanaChain, fetchFn?: Fetch, apiKey?: string)`; `JupiterPort.buildUnsignedSwap(q: SwapQuote, user: string): Promise<{ base64: string; lastValidBlockHeight: bigint }>`; `JupiterPort.searchVerified(query: string): Promise<{ mint: string; symbol: string; name: string; icon: string | null; decimals: number; tokenProgram: string }[]>`

- [ ] **Step 1: Failing tests** (append to `tests/jupiter/port.test.ts`)

```ts
test("sends the api key header when one is set", async () => {
  let seen: string | null = null;
  const j = new JupiterLive("https://api.jup.ag/swap/v1", {} as any, async (_url, init) => {
    seen = new Headers(init?.headers).get("x-api-key");
    return new Response(JSON.stringify({ inAmount: "1", outAmount: "2", priceImpactPct: "0" }));
  }, "k123");
  await j.quote("a", "b", 1n, 100);
  expect(seen).toBe("k123");
});

test("searchVerified keeps verified classic SPL tokens only", async () => {
  const j = new JupiterLive("https://api.jup.ag/swap/v1", {} as any, async () => new Response(JSON.stringify([
    { id: "A", symbol: "AAA", name: "A", icon: "https://i/a.png", decimals: 6, isVerified: true, tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
    { id: "B", symbol: "BBB", name: "B", icon: null, decimals: 6, isVerified: false, tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
    { id: "C", symbol: "CCC", name: "C", icon: null, decimals: 6, isVerified: true, tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" },
  ])));
  expect((await j.searchVerified("a")).map((t) => t.mint)).toEqual(["A"]);
});
```

- [ ] **Step 2: Run** `bun test --timeout 30000 tests/jupiter` — Expected: FAIL (constructor ignores key; `searchVerified` missing).

- [ ] **Step 3: Implement.** In `src/jupiter/port.ts`: add `apiKey?: string` as the 4th constructor parameter; a private `headers()` returning `{ "x-api-key": apiKey }` when set; pass `headers` on every fetch (merge with `content-type` on POST). Derive the token host from the swap base: `const tokensBase = new URL(baseUrl).origin + "/tokens/v2"`; `isVerified` and the new `searchVerified` call `${tokensBase}/search?query=`. `searchVerified` maps `{ id, symbol, name, icon, decimals, tokenProgram }` and keeps `isVerified === true && tokenProgram === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"`. Add `buildUnsignedSwap(q, user)` posting to `/swap` with `userPublicKey: user` and returning `{ base64: swapTransaction, lastValidBlockHeight: BigInt(lastValidBlockHeight) }` without signing. Add both to the `JupiterPort` interface and to `tests/helpers/fake-jupiter.ts` (`searchVerified` returns `[]`; `buildUnsignedSwap` returns `{ base64: "c3dhcA==", lastValidBlockHeight: 1n }`) and the e2e stand-in in `scripts/e2e-local.ts`.
  `src/env.ts`: `JUPITER_BASE_URL` default becomes `https://api.jup.ag/swap/v1`; add `JUPITER_API_KEY: z.string().optional()`. `src/keeper/main.ts` passes `env.JUPITER_API_KEY`. `.env.example` gets `JUPITER_API_KEY=`.

- [ ] **Step 4: Run** `bun test --timeout 30000 tests/jupiter tests/keeper` — Expected: PASS.

- [ ] **Step 5: Commit** `git commit -am "Move Jupiter calls to api.jup.ag with an optional key"`

---

### Task 2: Next.js shell, design tokens, fonts, header, wallet

**Files:**
- Create: `next.config.ts`, `postcss.config.mjs`, `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx` (placeholder until Task 7), `src/app/api/health/route.ts`, `src/web/ui/Header.tsx`, `src/web/ui/Button.tsx`, `src/web/ui/Avatar.tsx`, `src/web/ui/format.ts`, `src/web/wallet/Providers.tsx`, `src/web/wallet/WalletButton.tsx`
- Modify: `package.json` (scripts, deps), `tsconfig.json`, `.gitignore` (`.next`, `next-env.d.ts`)
- Test: `tests/web/format.test.ts`, `tests/web/health.test.ts`

**Interfaces:**
- Produces: `fmtAmount(base: bigint | string, decimals: number, maxFrac?: number): string` (thousands separators, trims trailing zeros), `fmtCompact(n: number): string` (`1.2K`, `41.2M`), `shortAddr(a: string): string` (`7xKq…f3Ra`), `avatarGradient(seed: string): [string, string]` (deterministic from the mint), components `Button({ variant: "lime" | "violet" | "ghost" | "danger", size?: "md" | "lg" })`, `Avatar({ seed, label, size })`, `Header({ active })`.

- [ ] **Step 1: Install and configure**

```bash
bun add next@16.3.8 react@19.3.0 react-dom@19.3.0 @solana/wallet-adapter-react@0.15.40 @solana/wallet-adapter-react-ui@0.9.40 @solana/wallet-adapter-base lightweight-charts@5.2.1 jose@6 tweetnacl image-size@2
bun add -d @types/react @types/react-dom tailwindcss@4.3.3 @tailwindcss/postcss@4.3.3 @playwright/test@1.63.0
```

`package.json` scripts add `"dev": "bun --bun next dev"`, `"build": "bun --bun next build"`, `"start": "bun --bun next start"`.

`next.config.ts`:

```ts
import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: ["@kamino-finance/farms-sdk", "@meteora-ag/dynamic-bonding-curve-sdk", "@meteora-ag/cp-amm-sdk", "@coral-xyz/anchor"],
};
export default config;
```

`postcss.config.mjs`: `export default { plugins: { "@tailwindcss/postcss": {} } };`

`tsconfig.json`: add `"jsx": "preserve"`, `"plugins": [{ "name": "next" }]`, `"paths": { "@/*": ["./src/*"] }`, `"allowJs": false`, `"incremental": true`; `include` adds `"next-env.d.ts", ".next/types/**/*.ts"`.

- [ ] **Step 2: Failing tests**

`tests/web/format.test.ts`:

```ts
import { test, expect } from "bun:test";
import { fmtAmount, fmtCompact, shortAddr, avatarGradient } from "../../src/web/ui/format";

test("fmtAmount formats base units", () => {
  expect(fmtAmount(4_812_330_000_000n, 6)).toBe("4,812,330");
  expect(fmtAmount("1500000000", 9)).toBe("1.5");
  expect(fmtAmount(412_000_000n, 9, 3)).toBe("0.412");
  expect(fmtAmount(0n, 6)).toBe("0");
});
test("fmtCompact", () => {
  expect(fmtCompact(41_200_000)).toBe("41.2M");
  expect(fmtCompact(418_000)).toBe("418K");
  expect(fmtCompact(950)).toBe("950");
});
test("shortAddr", () => expect(shortAddr("7xKqAbCdEfGhf3Ra")).toBe("7xKq…f3Ra"));
test("avatarGradient is stable per seed", () => {
  expect(avatarGradient("mintA")).toEqual(avatarGradient("mintA"));
  expect(avatarGradient("mintA")).not.toEqual(avatarGradient("mintB"));
});
```

`tests/web/health.test.ts`:

```ts
import { test, expect } from "bun:test";
import { GET } from "../../src/app/api/health/route";
test("health reports the database answers", async () => {
  process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL;
  const r = await GET();
  expect(await r.json()).toEqual({ ok: true });
});
```

Run `bun test --timeout 30000 tests/web` — Expected: FAIL (modules missing).

- [ ] **Step 3: Implement**

`src/web/ui/format.ts`:

```ts
export function fmtAmount(base: bigint | string, decimals: number, maxFrac = 4): string {
  const v = typeof base === "string" ? BigInt(base) : base;
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const unit = 10n ** BigInt(decimals);
  const whole = (abs / unit).toLocaleString("en-US");
  let frac = (abs % unit).toString().padStart(decimals, "0").slice(0, maxFrac).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

export function fmtCompact(n: number): string {
  const units: [number, string][] = [[1e9, "B"], [1e6, "M"], [1e3, "K"]];
  for (const [v, s] of units) if (Math.abs(n) >= v) return `${(n / v).toFixed(1).replace(/\.0$/, "")}${s}`;
  return String(Math.round(n));
}

export const shortAddr = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

const PAIRS: [string, string][] = [
  ["#FFB86B", "#FF7A59"], ["#F9D976", "#F4B400"], ["#FFC1E3", "#FF7AB6"], ["#9FE7FF", "#4FB8FF"],
  ["#C8FF3D", "#7BD61F"], ["#BDB2FF", "#8B7BFF"], ["#A7F3D0", "#34D399"],
];
export function avatarGradient(seed: string): [string, string] {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PAIRS[h % PAIRS.length]!;
}
```

`src/app/api/health/route.ts`:

```ts
import { db } from "@/db/client";
export const dynamic = "force-dynamic";
const sql = db();
export async function GET() {
  const [r] = await sql`select 1 as ok`;
  return Response.json({ ok: r.ok === 1 });
}
```

Note: tests import route modules with relative paths, so `@/` imports must resolve under Bun too — add `"paths"` to `tsconfig.json` (Bun reads it).

`src/app/globals.css`:

```css
@import "tailwindcss";

@theme {
  --color-ground: #0A0A0F;
  --color-surface: #111018;
  --color-raised: #16151E;
  --color-raised-2: #1B1A24;
  --color-ink: #F4F2EE;
  --color-muted: #9A97A8;
  --color-faint: #6F6C7E;
  --color-lime: #C8FF3D;
  --color-violet: #9D8CFF;
  --color-violet-light: #BDB2FF;
  --color-burn: #FF9B7A;
  --font-display: var(--font-unbounded), sans-serif;
  --font-sans: var(--font-geist), system-ui, sans-serif;
  --font-mono: var(--font-geist-mono), monospace;
  --radius-panel: 32px;
}

html, body { background: var(--color-ground); color: var(--color-ink); }
body { font-family: var(--font-sans); -webkit-font-smoothing: antialiased; }
.line { border-color: rgba(255,255,255,0.07); }
.glow-lime { box-shadow: 0 0 40px rgba(200,255,61,0.35), inset 0 -5px 0 rgba(0,0,0,0.16); }
.glow-violet { box-shadow: 0 0 36px rgba(157,140,255,0.45), inset 0 -5px 0 rgba(0,0,0,0.15); }
.puff { box-shadow: inset 0 -5px 0 rgba(0,0,0,0.15); }
.panel { background: linear-gradient(180deg, #16151E, #111018); border: 1px solid rgba(255,255,255,0.08); border-radius: 32px; box-shadow: 0 40px 80px rgba(0,0,0,0.45); }
.wallet-adapter-button { font-family: var(--font-geist-mono) !important; border-radius: 999px !important; background: #1B1A24 !important; border: 1px solid rgba(255,255,255,0.10) !important; height: 44px !important; font-size: 14px !important; }
.wallet-adapter-modal-wrapper { background: #111018 !important; border-radius: 32px !important; }
```

`src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
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
      </body>
    </html>
  );
}
```

`src/web/wallet/Providers.tsx`:

```tsx
"use client";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ConnectionProvider endpoint={process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8899"}>
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
```

`src/web/wallet/WalletButton.tsx`:

```tsx
"use client";
import dynamic from "next/dynamic";
export const WalletButton = dynamic(() => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton), { ssr: false });
```

`src/web/ui/Button.tsx`:

```tsx
import type { ButtonHTMLAttributes } from "react";

const variants = {
  lime: "bg-lime text-ground glow-lime",
  violet: "bg-violet-light text-ground glow-violet",
  ghost: "bg-raised-2 text-ink border border-white/10",
  danger: "bg-transparent text-burn border border-burn/45",
};
const sizes = { md: "px-5 py-3 text-[15px] min-h-11", lg: "py-5 text-xl w-full min-h-14" };

export function Button({ variant = "lime", size = "md", className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants; size?: keyof typeof sizes }) {
  return (
    <button
      type="button"
      {...rest}
      className={`rounded-full font-display font-black tracking-tight cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`}
    />
  );
}
```

`src/web/ui/Avatar.tsx`:

```tsx
import { avatarGradient } from "./format";

export function Avatar({ seed, label, size = 44, image }: { seed: string; label: string; size?: number; image?: string | null }) {
  const [a, b] = avatarGradient(seed);
  const radius = Math.round(size * 0.31);
  if (image) return <img src={image} alt="" width={size} height={size} style={{ borderRadius: radius }} className="object-cover puff" />;
  return (
    <span
      aria-hidden
      className="inline-flex items-center justify-center font-display font-black text-ground puff shrink-0"
      style={{ width: size, height: size, borderRadius: radius, fontSize: size * 0.4, background: `linear-gradient(145deg, ${a}, ${b})` }}
    >
      {label.slice(0, 1).toUpperCase()}
    </span>
  );
}
```

`src/web/ui/Header.tsx`:

```tsx
import Link from "next/link";
import { WalletButton } from "@/web/wallet/WalletButton";

const links = [{ href: "/", label: "Launch" }, { href: "/explore", label: "Explore" }];

export function Header({ active }: { active: "launch" | "explore" | "token" | "admin" }) {
  return (
    <header className="flex items-center justify-between px-5 md:px-16 py-5 md:py-7 border-b line">
      <div className="flex items-center gap-8 md:gap-12">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="w-7 h-7 rounded-[10px] bg-lime" style={{ boxShadow: "0 0 24px rgba(200,255,61,0.45), inset 0 -4px 0 rgba(0,0,0,0.18)" }} />
          <span className="font-display font-black text-2xl tracking-tight">quants</span>
        </Link>
        <nav className="hidden md:flex gap-8 text-[15px] font-medium">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className={(active === "launch" && l.href === "/") || (active === "explore" && l.href === "/explore") ? "text-ink" : "text-muted hover:text-ink"}>{l.label}</Link>
          ))}
        </nav>
      </div>
      <WalletButton />
    </header>
  );
}
```

`src/app/page.tsx` (placeholder): renders `<Header active="launch" />` and an `h1` "Launch a token." in `font-display font-black`.

- [ ] **Step 4: Run** `bun test --timeout 30000 tests/web` — Expected: PASS. Then `bun run build` — Expected: build succeeds.

- [ ] **Step 5: Commit** `git add -A && git commit -m "Add Next.js shell with design tokens, fonts, header and wallet"`

---

### Task 3: Web server context and HTTP helpers

**Files:**
- Create: `src/web/server/context.ts`, `src/web/server/http.ts`
- Test: `tests/web/http.test.ts`, `tests/helpers/web-context.ts`

**Interfaces:**
- Produces:

```ts
export interface WebContext {
  sql: SQL;
  conn: Connection;
  meteora: MeteoraPort;
  staking: StakingAdapter;
  jupiter: JupiterPort;
  pinata: PinataPort;
  chart: ChartSource;
  configKeys: Record<string, string>;
  keeperAddress: string;
  spillWallet: PublicKey;
  ourtokenMint: string;
  adminWallets: Set<string>;
  sessionSecret: Uint8Array;
  tokenProgramOf(mint: string): Promise<string>;
}
export function getContext(): WebContext;           // built once from env
export function setContextForTests(c: WebContext | null): void;
export const json: (data: unknown, status?: number) => Response;   // bigint-safe
export function jsonError(e: unknown): Response;    // LaunchError → 400, AuthError → 401/403, ZodError → 400, else 500
export async function readJson<T>(req: Request): Promise<T>;       // throws BadRequest on invalid JSON
export class AuthError extends Error { constructor(public status: 401 | 403, message: string) }
```

(`PinataPort` and `ChartSource` types are declared here as imports from Tasks 5 and 9; this task defines them as minimal interfaces in their own files with no implementation: `src/web/server/pinata.ts` exports `interface PinataPort { uploadFile(file: File, name: string): Promise<string>; uploadJson(data: object, name: string): Promise<string> }` returning the CID; `src/web/server/chart.ts` exports `interface ChartSource { candles(pool: string, tf: "1H" | "1D" | "1W"): Promise<Candle[]>; market(pool: string): Promise<Market | null> }` with `Candle = { time: number; open: number; high: number; low: number; close: number }` and `Market = { priceUsd: number; fdvUsd: number; change24h: number }`.)

- [ ] **Step 1: Failing test** `tests/web/http.test.ts`

```ts
import { test, expect } from "bun:test";
import { z } from "zod";
import { json, jsonError, AuthError } from "../../src/web/server/http";
import { LaunchError } from "../../src/launch/prepare";

test("json serialises bigints as strings", async () => {
  expect(await json({ a: 5n }).json()).toEqual({ a: "5" });
});

test("jsonError maps known errors", async () => {
  const cases: [unknown, number, string][] = [
    [new LaunchError("dev_buy_too_large", "too big"), 400, "dev_buy_too_large"],
    [new AuthError(401, "sign in"), 401, "unauthorized"],
    [new AuthError(403, "not admin"), 403, "forbidden"],
    [z.object({ a: z.string() }).safeParse({}).error, 400, "invalid_input"],
    [new Error("boom"), 500, "internal"],
  ];
  for (const [e, status, code] of cases) {
    const r = jsonError(e);
    expect(r.status).toBe(status);
    expect((await r.json()).error.code).toBe(code);
  }
});

test("500 responses do not leak the message", async () => {
  expect((await jsonError(new Error("db password xyz")).json()).error.message).toBe("Something went wrong");
});
```

Run — Expected: FAIL.

- [ ] **Step 2: Implement** `src/web/server/http.ts`:

```ts
import { ZodError } from "zod";
import { LaunchError } from "@/launch/prepare";

export class AuthError extends Error {
  constructor(public status: 401 | 403, message: string) { super(message); }
}

const replacer = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);
export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data, replacer), { status, headers: { "content-type": "application/json" } });

export function jsonError(e: unknown): Response {
  if (e instanceof LaunchError) return json({ error: { code: e.code, message: e.message } }, 400);
  if (e instanceof AuthError) return json({ error: { code: e.status === 401 ? "unauthorized" : "forbidden", message: e.message } }, e.status);
  if (e instanceof ZodError) return json({ error: { code: "invalid_input", message: e.issues.map((i) => i.message).join("; ") } }, 400);
  console.error(e);
  return json({ error: { code: "internal", message: "Something went wrong" } }, 500);
}

export async function readJson<T>(req: Request): Promise<T> {
  try { return (await req.json()) as T; } catch { throw new LaunchError("invalid_input", "Body must be JSON"); }
}
```

`src/web/server/context.ts`:

```ts
import type { SQL } from "bun";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { db } from "@/db/client";
import { SolanaChain } from "@/chain/solana";
import { MeteoraLive, type MeteoraPort } from "@/meteora/port";
import { KaminoBackend } from "@/staking/kamino";
import type { StakingAdapter } from "@/staking/adapter";
import { JupiterLive, type JupiterPort } from "@/jupiter/port";
import { PinataRest, type PinataPort } from "./pinata";
import { GeckoChart, type ChartSource } from "./chart";

export interface WebContext { /* as in Interfaces */ }

let ctx: WebContext | null = null;
export const setContextForTests = (c: WebContext | null) => { ctx = c; };

export function getContext(): WebContext {
  if (ctx) return ctx;
  const e = process.env;
  const conn = new Connection(e.RPC_URL!, "confirmed");
  // The web server never signs: these throwaway keypairs only satisfy constructors whose signing paths it never calls.
  const chain = new SolanaChain(conn, Keypair.generate(), Keypair.generate());
  ctx = {
    sql: db(e.DATABASE_URL),
    conn,
    meteora: new MeteoraLive(chain, e.DAMM_V2_MIGRATION_CONFIG!),
    staking: new KaminoBackend(chain, e.RPC_URL!, e.KAMINO_GLOBAL_CONFIG!),
    jupiter: new JupiterLive(e.JUPITER_BASE_URL ?? "https://api.jup.ag/swap/v1", chain, fetch, e.JUPITER_API_KEY),
    pinata: new PinataRest(e.PINATA_JWT!),
    chart: new GeckoChart(e.GECKO_BASE ?? "https://api.geckoterminal.com/api/v2"),
    configKeys: JSON.parse(require("node:fs").readFileSync(e.CONFIG_KEYS_PATH ?? "config-keys.json", "utf8")),
    keeperAddress: e.KEEPER_ADDRESS!,
    spillWallet: new PublicKey(e.SPILL_ADDRESS!),
    ourtokenMint: e.OURTOKEN_MINT!,
    adminWallets: new Set((e.ADMIN_WALLETS ?? "").split(",").map((s) => s.trim()).filter(Boolean)),
    sessionSecret: new TextEncoder().encode(e.ADMIN_SESSION_SECRET!),
    tokenProgramOf: async (mint) => (await conn.getAccountInfo(new PublicKey(mint)))?.owner.toBase58() ?? "",
  };
  return ctx;
}
```

`tests/helpers/web-context.ts` builds a `WebContext` from `freshDb()`, `FakeMeteora`, `FakeStaking`, `FakeJupiter`, a `FakePinata` (records uploads, returns `"cid-<n>"`), a `FakeChart` (returns fixed candles or throws when `fail = true`), `configKeys = { "<SOL>:200": "CfgSol200" }`, `keeperAddress`, `spillWallet = Keypair.generate().publicKey`, `ourtokenMint = OURS`, `adminWallets = new Set([ADMIN.publicKey.toBase58()])` where `ADMIN` is an exported `Keypair`, `sessionSecret` 32 random bytes, `tokenProgramOf = async () => "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"`, and calls `setContextForTests`.

`.env.example` adds: `KEEPER_ADDRESS=`, `SPILL_ADDRESS=`, `PINATA_JWT=`, `PINATA_GATEWAY=`, `ADMIN_WALLETS=`, `ADMIN_SESSION_SECRET=`, `CONFIG_KEYS_PATH=config-keys.json`, `GECKO_BASE=https://api.geckoterminal.com/api/v2`, `NEXT_PUBLIC_RPC_URL=`, `NEXT_PUBLIC_OURTOKEN_MINT=`, `NEXT_PUBLIC_OURTOKEN_SYMBOL=`.

- [ ] **Step 3: Run** `bun test --timeout 30000 tests/web` — Expected: PASS.
- [ ] **Step 4: Commit** `git add -A && git commit -m "Add web server context and HTTP helpers"`

---

### Task 4: Pinata upload

**Files:**
- Modify: `src/web/server/pinata.ts`
- Test: `tests/web/pinata.test.ts`

**Interfaces:**
- Produces: `class PinataRest implements PinataPort { constructor(jwt: string, fetchFn?: Fetch) }`; `gatewayUrl(cid: string): string` returning `https://${PINATA_GATEWAY}/ipfs/${cid}` (falls back to `https://ipfs.io/ipfs/${cid}` when `PINATA_GATEWAY` is unset).

- [ ] **Step 1: Failing test**

```ts
import { test, expect } from "bun:test";
import { PinataRest, gatewayUrl } from "../../src/web/server/pinata";

test("uploads a file publicly with the bearer token and returns the cid", async () => {
  let seen: { url: string; auth: string | null; network: FormDataEntryValue | null } | null = null;
  const p = new PinataRest("jwt1", async (url, init) => {
    const body = init!.body as FormData;
    seen = { url: String(url), auth: new Headers(init!.headers).get("authorization"), network: body.get("network") };
    return new Response(JSON.stringify({ data: { cid: "bafy123" } }));
  });
  expect(await p.uploadFile(new File(["x"], "a.png", { type: "image/png" }), "a.png")).toBe("bafy123");
  expect(seen).toEqual({ url: "https://uploads.pinata.cloud/v3/files", auth: "Bearer jwt1", network: "public" });
});

test("uploads json as a file", async () => {
  let type = "";
  const p = new PinataRest("jwt1", async (_u, init) => {
    type = ((init!.body as FormData).get("file") as File).type;
    return new Response(JSON.stringify({ data: { cid: "bafyjson" } }));
  });
  expect(await p.uploadJson({ a: 1 }, "m.json")).toBe("bafyjson");
  expect(type).toBe("application/json");
});

test("throws on a failed upload", async () => {
  const p = new PinataRest("jwt1", async () => new Response("nope", { status: 401 }));
  await expect(p.uploadJson({}, "m.json")).rejects.toThrow("pinata upload failed: 401");
});

test("gatewayUrl", () => {
  delete process.env.PINATA_GATEWAY;
  expect(gatewayUrl("bafy")).toBe("https://ipfs.io/ipfs/bafy");
  process.env.PINATA_GATEWAY = "g.mypinata.cloud";
  expect(gatewayUrl("bafy")).toBe("https://g.mypinata.cloud/ipfs/bafy");
});
```

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
type Fetch = (url: string | URL, init?: RequestInit) => Promise<Response>;

export interface PinataPort {
  uploadFile(file: File, name: string): Promise<string>;
  uploadJson(data: object, name: string): Promise<string>;
}

export const gatewayUrl = (cid: string) =>
  process.env.PINATA_GATEWAY ? `https://${process.env.PINATA_GATEWAY}/ipfs/${cid}` : `https://ipfs.io/ipfs/${cid}`;

export class PinataRest implements PinataPort {
  constructor(private jwt: string, private fetchFn: Fetch = fetch) {}

  async uploadFile(file: File, name: string): Promise<string> {
    const body = new FormData();
    body.set("file", file, name);
    body.set("network", "public");
    body.set("name", name);
    const res = await this.fetchFn("https://uploads.pinata.cloud/v3/files", { method: "POST", headers: { authorization: `Bearer ${this.jwt}` }, body });
    if (!res.ok) throw new Error(`pinata upload failed: ${res.status}`);
    return ((await res.json()) as { data: { cid: string } }).data.cid;
  }

  uploadJson(data: object, name: string): Promise<string> {
    return this.uploadFile(new File([JSON.stringify(data)], name, { type: "application/json" }), name);
  }
}
```

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** `git add -A && git commit -m "Add Pinata upload"`

---

### Task 5: Image validation and metadata route

**Files:**
- Create: `src/web/server/image.ts`, `src/app/api/metadata/route.ts`
- Test: `tests/web/metadata.test.ts`, fixtures generated in the test with `sharp`-free PNG bytes (see below)

**Interfaces:**
- Produces: `validateImage(file: File): Promise<void>` throwing `LaunchError("invalid_input", …)`; route `POST /api/metadata` (multipart: `image`, `name`, `symbol`, `description?`, `website?`, `x?`, `telegram?`) → `{ uri, image }`.

Metadata JSON written to Pinata (Metaplex token standard shape):

```json
{ "name": "...", "symbol": "...", "description": "...", "image": "<gateway url>", "extensions": { "website": "...", "twitter": "...", "telegram": "..." } }
```

- [ ] **Step 1: Failing test**

```ts
import { test, expect } from "bun:test";
import { makeWebContext, FakePinata } from "../helpers/web-context";
import { POST } from "../../src/app/api/metadata/route";

// Minimal valid PNG header with IHDR for a w×h image; image-size only reads the header.
function png(w: number, h: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
}
const form = (fields: Record<string, string | File>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return new Request("http://x/api/metadata", { method: "POST", body: f });
};

test("uploads image then metadata and returns the uri", async () => {
  const c = await makeWebContext();
  const r = await POST(form({ image: new File([png(512, 512)], "cat.png", { type: "image/png" }), name: "Cat", symbol: "CAT", website: "https://cat.xyz" }));
  expect(r.status).toBe(200);
  const body = await r.json();
  expect(body.uri).toContain("ipfs/cid-2");
  const meta = (c.pinata as FakePinata).json[0]!;
  expect(meta).toMatchObject({ name: "Cat", symbol: "CAT", extensions: { website: "https://cat.xyz" } });
  expect(meta.image).toContain("ipfs/cid-1");
});

test("rejects non square, too large, wrong type and bad links before uploading", async () => {
  const c = await makeWebContext();
  const cases = [
    form({ image: new File([png(512, 300)], "a.png", { type: "image/png" }), name: "Cat", symbol: "CAT" }),
    form({ image: new File([png(512, 512), new Uint8Array(2 * 1024 * 1024)], "a.png", { type: "image/png" }), name: "Cat", symbol: "CAT" }),
    form({ image: new File(["GIF89a"], "a.gif", { type: "image/gif" }), name: "Cat", symbol: "CAT" }),
    form({ image: new File([png(64, 64)], "a.png", { type: "image/png" }), name: "Cat", symbol: "CAT", x: "https://evil.com/cat" }),
    form({ name: "Cat", symbol: "CAT" }),
  ];
  for (const req of cases) {
    const r = await POST(req);
    expect(r.status).toBe(400);
    expect((await r.json()).error.message.length).toBeGreaterThan(0);
  }
  expect((c.pinata as FakePinata).files.length).toBe(0);
});
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

`src/web/server/image.ts`:

```ts
import { imageSize } from "image-size";
import { LaunchError } from "@/launch/prepare";

const TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX = 2 * 1024 * 1024;

export async function validateImage(file: File | null): Promise<void> {
  if (!file || typeof file === "string") throw new LaunchError("invalid_input", "Add an image");
  if (!TYPES.has(file.type)) throw new LaunchError("invalid_input", "Image must be PNG, JPEG or WebP");
  if (file.size > MAX) throw new LaunchError("invalid_input", "Image must be 2 MB or smaller");
  let dims: { width?: number; height?: number };
  try { dims = imageSize(new Uint8Array(await file.arrayBuffer())); } catch { throw new LaunchError("invalid_input", "We could not read that image"); }
  if (!dims.width || dims.width !== dims.height) throw new LaunchError("invalid_input", "Image must be square");
}
```

`src/app/api/metadata/route.ts`:

```ts
import { z } from "zod";
import { getContext } from "@/web/server/context";
import { json, jsonError } from "@/web/server/http";
import { validateImage } from "@/web/server/image";
import { gatewayUrl } from "@/web/server/pinata";

export const dynamic = "force-dynamic";

const link = (hosts: string[] | null) => z.string().url().max(200).refine((v) => {
  const u = new URL(v);
  return u.protocol === "https:" && !u.username && !u.password && !u.port && (!hosts || (hosts.includes(u.hostname) && u.pathname.length > 1));
}, "Links must be public HTTPS addresses");

const Fields = z.object({
  name: z.string().trim().min(1).max(32),
  symbol: z.string().regex(/^[A-Za-z0-9]{1,10}$/, "Symbol is 1 to 10 letters or numbers"),
  description: z.string().max(500).optional(),
  website: link(null).optional(),
  x: link(["x.com", "twitter.com"]).optional(),
  telegram: link(["t.me"]).optional(),
});

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const image = form.get("image") as File | null;
    const raw = Object.fromEntries([...form.entries()].filter(([k, v]) => k !== "image" && v !== ""));
    const fields = Fields.parse(raw);
    await validateImage(image);
    const { pinata } = getContext();
    const imageCid = await pinata.uploadFile(image!, `${fields.symbol}.${image!.type.split("/")[1]}`);
    const imageUrl = gatewayUrl(imageCid);
    const metaCid = await pinata.uploadJson({
      name: fields.name, symbol: fields.symbol, description: fields.description ?? "", image: imageUrl,
      extensions: { website: fields.website, twitter: fields.x, telegram: fields.telegram },
    }, `${fields.symbol}.json`);
    return json({ uri: gatewayUrl(metaCid), image: imageUrl });
  } catch (e) {
    return jsonError(e);
  }
}
```

(Fields are validated before the image so a bad link is rejected without reading the file; the order in the test covers both.)

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** `git add -A && git commit -m "Add metadata upload route with image checks"`

---

### Task 6: Launch API routes and OURTOKEN first buy

**Files:**
- Create: `src/web/server/launch.ts`, `src/app/api/launch/prepare/route.ts`, `src/app/api/launch/confirm/route.ts`, `src/app/api/tokens/search/route.ts`
- Test: `tests/web/launch-routes.test.ts`

**Interfaces:**
- Consumes: `prepareLaunch`, `confirmLaunch` (plan 1), `JupiterPort.quote/buildUnsignedSwap`.
- Produces: `POST /api/launch/prepare` body `{ name, symbol, uri, creator, quoteMint, feeTierBps, basket, devBuySol? }` → `{ mint, pool, settingsVersion, transactions: { base64: string; versioned: boolean }[] }` (swap first when present, launch last); `POST /api/launch/confirm` `{ signature, mint }` → `{ launchId }`; `GET /api/tokens/search?q=` → verified classic SPL tokens.

`prepareWithSwap(ctx, body)`: when `quoteMint === ourtokenMint` and `devBuySol > 0`, quote SOL→OURTOKEN for `devBuySol` lamports with the latest settings' `slippageBps`; the launch's `devBuyQuoteAmount` = `quote.outAmount * (10000 - slippageBps) / 10000` (so the first buy never exceeds what the swap guarantees); prepend `jupiter.buildUnsignedSwap(quote, creator)`. For SOL pairs, `devBuyQuoteAmount = devBuySol`. `devBuyMinOut` is always `"0"` from the UI in v1 (the curve price is deterministic within the same slot; the cap check uses `devBuyMinOut`, so the route computes it with `swapQuote` in a later iteration — see Deferred).

- [ ] **Step 1: Failing test**

```ts
import { test, expect } from "bun:test";
import { makeWebContext, OURS } from "../helpers/web-context";
import { POST as prepare } from "../../src/app/api/launch/prepare/route";
import { POST as confirm } from "../../src/app/api/launch/confirm/route";
import { GET as search } from "../../src/app/api/tokens/search/route";
import { NATIVE_MINT } from "../../src/domain/types";

const body = (over: object = {}) => ({
  name: "Cat", symbol: "CAT", uri: "https://ipfs.io/ipfs/x", creator: "Creator111111111111111111111111111111111111",
  quoteMint: NATIVE_MINT, feeTierBps: 200, basket: [{ mint: "Zec1111111111111111111111111111111111111111", weightBps: 10000 }], ...over,
});
const post = (h: (r: Request) => Promise<Response>, b: object) => h(new Request("http://x", { method: "POST", body: JSON.stringify(b) }));

test("SOL launch returns one legacy transaction", async () => {
  await makeWebContext();
  const r = await post(prepare, body({ devBuySol: "1000000000" }));
  const j = await r.json();
  expect(r.status).toBe(200);
  expect(j.transactions.map((t: any) => t.versioned)).toEqual([false]);
});

test("OURTOKEN launch with a first buy puts the Jupiter swap first and caps the buy by slippage", async () => {
  const c = await makeWebContext();
  (c.jupiter as any).rates.set(OURS, 2);
  const r = await post(prepare, body({ quoteMint: OURS, devBuySol: "1000000000", feeTierBps: 200 }));
  const j = await r.json();
  expect(j.transactions.map((t: any) => t.versioned)).toEqual([true, false]);
  expect((c.meteora as any).launches[0].devBuyQuoteAmount).toBe(1_980_000_000n);
});

test("prepare maps validation errors to 400", async () => {
  await makeWebContext();
  const r = await post(prepare, body({ symbol: "TOO LONG SYMBOL" }));
  expect(r.status).toBe(400);
  expect((await r.json()).error.code).toBe("invalid_input");
});

test("confirm returns 400 with a readable code for an unknown mint", async () => {
  await makeWebContext();
  const r = await post(confirm, { signature: "5".repeat(64), mint: "Mint1111111111111111111111111111111111111111" });
  expect(r.status).toBe(400);
  expect((await r.json()).error.code).toBe("not_found_on_chain");
});

test("token search proxies verified tokens", async () => {
  const c = await makeWebContext();
  (c.jupiter as any).searchVerified = async () => [{ mint: "Z", symbol: "ZEC", name: "Zcash", icon: null, decimals: 8, tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }];
  const r = await search(new Request("http://x/api/tokens/search?q=zec"));
  expect((await r.json()).tokens[0].symbol).toBe("ZEC");
});
```

`FakeJupiter` needs `rates` keyed by output mint (already) and `buildUnsignedSwap` from Task 1. Add `OURS` export and `(c.meteora as FakeMeteora).launches` access in the helper.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

`src/web/server/launch.ts`:

```ts
import { z } from "zod";
import type { WebContext } from "./context";
import { prepareLaunch } from "@/launch/prepare";
import { loadLatestSettings } from "@/domain/settings";
import { NATIVE_MINT } from "@/domain/types";
import { LaunchError } from "@/launch/prepare";

const Body = z.object({ devBuySol: z.string().regex(/^\d+$/).default("0") }).passthrough();

export async function prepareWithSwap(ctx: WebContext, raw: unknown) {
  const { devBuySol, ...rest } = Body.parse(raw);
  const sol = BigInt(devBuySol);
  const transactions: { base64: string; versioned: boolean }[] = [];
  let devBuyQuoteAmount = sol;
  if ((rest as any).quoteMint === ctx.ourtokenMint && sol > 0n) {
    const { slippageBps } = await loadLatestSettings(ctx.sql);
    const q = await ctx.jupiter.quote(NATIVE_MINT, ctx.ourtokenMint, sol, slippageBps);
    if (!q) throw new LaunchError("invalid_input", "No route to buy the pair token right now");
    devBuyQuoteAmount = (q.outAmount * BigInt(10_000 - slippageBps)) / 10_000n;
    transactions.push({ base64: (await ctx.jupiter.buildUnsignedSwap(q, (rest as any).creator)).base64, versioned: true });
  }
  const p = await prepareLaunch(
    { sql: ctx.sql, meteora: ctx.meteora, configKeys: ctx.configKeys, ourtokenMint: ctx.ourtokenMint, keeperAddress: ctx.keeperAddress,
      isVerified: ctx.jupiter.isVerified.bind(ctx.jupiter), tokenProgramOf: ctx.tokenProgramOf },
    { ...rest, devBuyQuoteAmount: devBuyQuoteAmount.toString(), devBuyMinOut: "0" },
  );
  transactions.push({ base64: p.transaction, versioned: false });
  return { mint: p.mint, pool: p.pool, settingsVersion: p.settingsVersion, transactions };
}
```

`src/app/api/launch/prepare/route.ts`:

```ts
import { getContext } from "@/web/server/context";
import { json, jsonError, readJson } from "@/web/server/http";
import { prepareWithSwap } from "@/web/server/launch";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  try { return json(await prepareWithSwap(getContext(), await readJson(req))); } catch (e) { return jsonError(e); }
}
```

`src/app/api/launch/confirm/route.ts`:

```ts
import { z } from "zod";
import { getContext } from "@/web/server/context";
import { json, jsonError, readJson } from "@/web/server/http";
import { confirmLaunch } from "@/launch/confirm";
export const dynamic = "force-dynamic";
const Body = z.object({ signature: z.string().min(32), mint: z.string().min(32) });
export async function POST(req: Request) {
  try {
    const c = getContext();
    const b = Body.parse(await readJson(req));
    return json({ launchId: await confirmLaunch({ sql: c.sql, conn: c.conn, meteora: c.meteora, spillWallet: c.spillWallet }, b) });
  } catch (e) { return jsonError(e); }
}
```

`src/app/api/tokens/search/route.ts`:

```ts
import { getContext } from "@/web/server/context";
import { json, jsonError } from "@/web/server/http";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
    if (q.length < 2) return json({ tokens: [] });
    return json({ tokens: (await getContext().jupiter.searchVerified(q)).slice(0, 20) });
  } catch (e) { return jsonError(e); }
}
```

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** `git add -A && git commit -m "Add launch, confirm and token search routes"`

---

### Task 7: Launch page

**Files:**
- Create: `src/web/wallet/send.ts`, `src/web/ui/Field.tsx`, `src/web/ui/Segmented.tsx`, `src/web/launch/LaunchForm.tsx`, `src/web/launch/BasketPicker.tsx`
- Modify: `src/app/page.tsx`
- Test: `tests/web/send.test.ts`

**Interfaces:**
- Produces: `signAndSendAll(wallet: WalletContextState, conn: Connection, txs: { base64: string; versioned: boolean }[]): Promise<string[]>` — deserialises each, calls `wallet.signAllTransactions` once, sends in order, waits for each to confirm before sending the next, returns signatures; throws `SendError` with a readable message on rejection (`"You cancelled in your wallet"`) or failure (`"The transaction failed: <reason>"`).

- [ ] **Step 1: Failing test** `tests/web/send.test.ts` (uses a fake wallet and fake connection):

```ts
import { test, expect } from "bun:test";
import { Keypair, Transaction, SystemProgram } from "@solana/web3.js";
import { signAndSendAll, SendError } from "../../src/web/wallet/send";

const kp = Keypair.generate();
const legacy = () => {
  const t = new Transaction({ feePayer: kp.publicKey, recentBlockhash: "11111111111111111111111111111111" })
    .add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: kp.publicKey, lamports: 1 }));
  return { base64: t.serialize({ requireAllSignatures: false }).toString("base64"), versioned: false };
};
const wallet = (reject = false) => ({
  publicKey: kp.publicKey,
  signAllTransactions: async (txs: any[]) => { if (reject) throw new Error("User rejected the request."); txs.forEach((t) => t.partialSign(kp)); return txs; },
}) as any;
const conn = (fail = false) => {
  const sent: string[] = [];
  return {
    sent,
    sendRawTransaction: async () => { sent.push(`sig${sent.length}`); return `sig${sent.length - 1}`; },
    confirmTransaction: async () => ({ value: { err: fail ? { InstructionError: [0, "Custom"] } : null } }),
    getLatestBlockhash: async () => ({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 10 }),
  } as any;
};

test("signs once and sends in order", async () => {
  const c = conn();
  expect(await signAndSendAll(wallet(), c, [legacy(), legacy()])).toEqual(["sig0", "sig1"]);
});
test("a rejection becomes a readable error", async () => {
  await expect(signAndSendAll(wallet(true), conn(), [legacy()])).rejects.toThrow(new SendError("You cancelled in your wallet"));
});
test("an on-chain failure stops the sequence", async () => {
  const c = conn(true);
  await expect(signAndSendAll(wallet(), c, [legacy(), legacy()])).rejects.toBeInstanceOf(SendError);
  expect(c.sent.length).toBe(1);
});
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** `src/web/wallet/send.ts`:

```ts
import { Transaction, VersionedTransaction, type Connection } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";

export class SendError extends Error {}

export async function signAndSendAll(wallet: WalletContextState, conn: Connection, txs: { base64: string; versioned: boolean }[]): Promise<string[]> {
  if (!wallet.publicKey || !wallet.signAllTransactions) throw new SendError("Connect a wallet first");
  const decoded = txs.map((t) => {
    const bytes = Buffer.from(t.base64, "base64");
    return t.versioned ? VersionedTransaction.deserialize(bytes) : Transaction.from(bytes);
  });
  let signed: (Transaction | VersionedTransaction)[];
  try {
    signed = await wallet.signAllTransactions(decoded);
  } catch {
    throw new SendError("You cancelled in your wallet");
  }
  const sigs: string[] = [];
  for (const tx of signed) {
    const sig = await conn.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    const res = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    if (res.value.err) throw new SendError(`The transaction failed: ${JSON.stringify(res.value.err)}`);
    sigs.push(sig);
  }
  return sigs;
}
```

`src/web/ui/Field.tsx`: `Field({ label, children, hint })` renders `<label className="flex flex-col gap-2.5 text-[13px] text-muted">`; `TextInput` with classes `font-sans text-xl text-ink bg-surface border border-white/10 rounded-2xl px-5 py-[18px] outline-none focus:border-lime/60 w-full`, and a `mono` / `display` prop switching the font as in the canvas.

`src/web/ui/Segmented.tsx`: `Segmented<T extends string>({ options: { value: T; label: string }[]; value: T; onChange })` renders pill buttons exactly as the canvas `pill(active)` style (active lime with glow, inactive surface with white/10 border), `aria-pressed` set on each.

`src/web/launch/BasketPicker.tsx` (client): list of up to 3 rows (Avatar, symbol and name, weight bar, weight number input 1 to 100, remove button with `aria-label="Remove token"`); an "Add token" search field that fetches `/api/tokens/search?q=` (debounced 250 ms) and shows results as flat rows; "Split evenly" link resets weights to 100/n with the remainder on the first; props `value: { mint, symbol, name, icon, weight }[]`, `onChange`. Shows "Weights add up to 100" in orange when they do not.

`src/web/launch/LaunchForm.tsx` (client): the canvas layout, fluid:
- Grid `lg:grid-cols-[minmax(0,1fr)_440px]`, one column below `lg`.
- Section 01: image drop zone (`<input type="file" accept="image/png,image/jpeg,image/webp">` hidden behind a styled label; preview after pick; client checks size and squareness with `createImageBitmap` and shows the same messages as the server), Name, Symbol.
- Section 02: `Segmented` for pair (`SOL`, `process.env.NEXT_PUBLIC_OURTOKEN_SYMBOL`) and fee (`1%`,`2%`,`3%`,`5%` → 100/200/300/500 bps).
- Section 03: `BasketPicker`.
- Section 04: First buy amount in SOL (text input, decimal; converted with `BigInt(Math.round(x * 1e9))`) with the "You get about … of supply" line omitted until a quote endpoint exists (Deferred).
- Section 05: Description (textarea, 500 max), Website, X, Telegram.
- Summary aside (`.panel`): avatar preview, fee split bar and rows (reads `GET /api/admin/settings/public`? No: the split and tiers come from a server component prop — `page.tsx` is a server component that loads `loadLatestSettings(getContext().sql)` and passes `split`, `tiers`, `launchFeeLamports`, `maxPenaltyBps` to `LaunchForm`), lock tier tiles, launch fee, graduation target (from `NEXT_PUBLIC_SOL_GRADUATION` / `NEXT_PUBLIC_OURTOKEN_GRADUATION`), Launch button (`size="lg"`).
- Submit: disabled until wallet connected and form valid; states `idle → uploading → preparing → signing → confirming → done`, shown as the button label ("Uploading image", "Preparing", "Approve in your wallet", "Confirming"); on success `router.push("/t/" + mint)`; on any error show the message in an orange line above the button and return to `idle` with all fields kept. Each submit calls prepare again, so a retry gets a fresh mint.

`src/app/page.tsx`:

```tsx
import { Header } from "@/web/ui/Header";
import { LaunchForm } from "@/web/launch/LaunchForm";
import { getContext } from "@/web/server/context";
import { loadLatestSettings } from "@/domain/settings";

export const dynamic = "force-dynamic";

export default async function LaunchPage() {
  const s = await loadLatestSettings(getContext().sql);
  return (
    <div className="min-h-screen" style={{ background: "radial-gradient(900px 500px at 78% -10%, rgba(200,255,61,0.10), transparent 60%), radial-gradient(700px 500px at 0% 100%, rgba(157,140,255,0.10), transparent 60%), #0A0A0F" }}>
      <Header active="launch" />
      <LaunchForm split={s.split} tiers={s.tiers} launchFeeLamports={s.launchFeeLamports.toString()} maxPenaltyBps={s.maxPenaltyBps} />
    </div>
  );
}
```

- [ ] **Step 4: Run** `bun test --timeout 30000 tests/web` — PASS; `bun run build` — succeeds.
- [ ] **Step 5: Commit** `git add -A && git commit -m "Add launch page"`

---

### Task 8: Read endpoints

**Files:**
- Create: `src/web/server/reads.ts`, `src/app/api/launches/route.ts`, `src/app/api/launches/[mint]/route.ts`
- Modify: `src/meteora/port.ts` (add `curveProgress(pool): Promise<{ quoteReserve: bigint; threshold: bigint; migrated: boolean }>`), `tests/helpers/fake-meteora.ts`
- Test: `tests/web/reads.test.ts`, extend `tests/meteora/port.test.ts` with one `curveProgress` assertion

**Interfaces:**
- Produces:

```ts
listLaunches(sql, opts: { graduated?: boolean; limit?: number }): Promise<LaunchListItem[]>
// { mint, symbol?, pool, quoteMint, feeTierBps, status, createdAt, basket: string[] (reward mints), burned: string }
launchDetail(ctx: WebContext, mint: string): Promise<LaunchDetail | null>
// { launch, basket: { mint, weightBps, paidOut: string }[], tiers: { tierId, lockSeconds, multiplierBps, farm, staked: string, sharePct: number }[],
//   burned: string, curve: { quoteReserve: string; threshold: string; migrated: boolean } }
```

`paidOut` per reward mint = sum of confirmed `fund` rows' `detail->>'amount'` for that mint. `burned` = sum of confirmed `burn` rows. `sharePct` = tier weight `staked × multiplier` over the total, rounded to a whole percent (0 when nobody staked). Symbol and name come from the metadata. Migration `004_launch_meta.sql`:

```sql
alter table prepared_launches add column name text, add column symbol text, add column uri text, add column image text;
alter table launches add column name text, add column symbol text, add column uri text, add column image text;
alter table baskets add column symbol text, add column decimals int;
```

`prepareLaunch` accepts an optional `image` field and basket items with optional `symbol` and `decimals` (the launch form passes what the token search returned), stores them in `prepared_launches` (basket JSON keeps them), and `confirmLaunch` copies `name, symbol, uri, image` into `launches` and `symbol, decimals` into `baskets`.

- [ ] **Step 1: Failing tests** in `tests/web/reads.test.ts`: seed two launches through `prepareLaunch`/`confirmLaunch` with the fake context, add confirmed `fund` rows (ZEC 100 and 50) and a `burn` row (300) with `beginStep`/`confirmStep`, set `FakeStaking.staked` for two tiers (100 at 1x, 100 at 3x) and `FakeMeteora.progress` for the pool; assert `listLaunches` returns both newest first with `symbol`, `launchDetail` returns `paidOut: "150"` for ZEC, `burned: "300"`, tier shares `[25, 0, 0, 75]` in lock order, and `curve` strings; assert `launchDetail(ctx, "unknown")` is `null`; assert `GET /api/launches/[mint]` returns 404 JSON for an unknown mint.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** the migration, the `prepareLaunch`/`confirmLaunch` column additions (plan 1 tests keep passing: `prepared_launches` insert gains `name, symbol, uri`), `curveProgress` in `MeteoraLive` (`p.poolState.quoteReserve`, `cfg.migrationQuoteThreshold`, `p.poolState.isMigrated !== 0`) and the fake, `reads.ts` with SQL:

```sql
select l.mint, l.name, l.symbol, l.image, l.pool, l.quote_mint, l.fee_tier_bps, l.status, l.created_at,
  coalesce((select json_agg(b.reward_mint order by b.weight_bps desc) from baskets b where b.launch_id = l.id), '[]') as basket,
  coalesce((select sum((d.detail->>'amount')::numeric) from distributions d where d.launch_id = l.id and d.kind = 'burn' and d.status = 'confirmed'), 0)::text as burned
from launches l
where (${graduated}::boolean is null or (l.status = 'graduated') = ${graduated})
order by l.id desc limit ${limit}
```

and the two route handlers (`[mint]` route returns `json({ error: { code: "not_found", message: "No token here" } }, 404)` when null). Route params in Next 16 are async: `export async function GET(_req: Request, { params }: { params: Promise<{ mint: string }> })`.

- [ ] **Step 4: Run** `bun test --timeout 60000 tests/web tests/launch tests/meteora` — PASS.
- [ ] **Step 5: Commit** `git add -A && git commit -m "Add launch list and detail reads"`

---

### Task 9: Chart and market data

**Files:**
- Modify: `src/web/server/chart.ts`
- Create: `src/app/api/chart/[mint]/route.ts`, `src/web/token/Chart.tsx`
- Test: `tests/web/chart.test.ts`

**Interfaces:**
- Produces: `class GeckoChart implements ChartSource { constructor(base: string, fetchFn?: Fetch, ttlMs = 120_000) }`. `candles(pool, tf)` maps `1H → minute?aggregate=1&limit=60`, `1D → minute?aggregate=15&limit=96`, `1W → hour?aggregate=4&limit=42`, reverses GeckoTerminal's newest-first list, returns `[]` on 404 or 429 or network error. `market(pool)` reads `/networks/solana/pools/{pool}` → `{ priceUsd: Number(base_token_price_usd), fdvUsd: Number(fdv_usd), change24h: Number(price_change_percentage.h24) }`, `null` on failure. Both cache per key for `ttlMs` and serve the last good value when a refresh fails. Route `GET /api/chart/[mint]?tf=1D` → `{ candles, market }`, choosing the DAMM pool when the launch is graduated.

- [ ] **Step 1: Failing tests**:

```ts
import { test, expect } from "bun:test";
import { GeckoChart } from "../../src/web/server/chart";

const ok = (list: number[][]) => new Response(JSON.stringify({ data: { attributes: { ohlcv_list: list } } }));

test("maps timeframes and returns oldest first", async () => {
  let url = "";
  const g = new GeckoChart("https://gt", async (u) => { url = String(u); return ok([[200, 1, 2, 0.5, 1.5, 9], [100, 1, 1, 1, 1, 1]]); });
  const c = await g.candles("P", "1D");
  expect(url).toBe("https://gt/networks/solana/pools/P/ohlcv/minute?aggregate=15&limit=96&currency=usd");
  expect(c.map((x) => x.time)).toEqual([100, 200]);
});

test("rate limits and errors give an empty chart, then the cache serves the last good data", async () => {
  let n = 0;
  const g = new GeckoChart("https://gt", async () => (n++ === 0 ? ok([[100, 1, 1, 1, 1, 1]]) : new Response("", { status: 429 })), 0);
  expect((await g.candles("P", "1H")).length).toBe(1);
  expect((await g.candles("P", "1H")).length).toBe(1);
  const fresh = new GeckoChart("https://gt", async () => new Response("", { status: 429 }), 0);
  expect(await fresh.candles("Q", "1H")).toEqual([]);
  expect(await fresh.market("Q")).toBeNull();
});

test("cache avoids a second request inside the ttl", async () => {
  let n = 0;
  const g = new GeckoChart("https://gt", async () => { n++; return ok([]); }, 60_000);
  await g.candles("P", "1W");
  await g.candles("P", "1W");
  expect(n).toBe(1);
});
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** `GeckoChart` with a `Map<string, { at: number; value: unknown }>` cache; on fetch failure return the cached value if any, else the empty result. `Chart.tsx` (client) uses `lightweight-charts` v5:

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { createChart, AreaSeries, ColorType, type UTCTimestamp } from "lightweight-charts";

type Candle = { time: number; open: number; high: number; low: number; close: number };

export function Chart({ mint }: { mint: string }) {
  const el = useRef<HTMLDivElement>(null);
  const [tf, setTf] = useState<"1H" | "1D" | "1W">("1D");
  const [candles, setCandles] = useState<Candle[] | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/chart/${mint}?tf=${tf}`).then((r) => r.json()).then((j) => live && setCandles(j.candles ?? [])).catch(() => live && setCandles([]));
    return () => { live = false; };
  }, [mint, tf]);

  useEffect(() => {
    if (!el.current || !candles?.length) return;
    const chart = createChart(el.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#9A97A8", fontFamily: "var(--font-geist-mono)" },
      grid: { vertLines: { visible: false }, horzLines: { color: "rgba(255,255,255,0.05)" } },
      rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false },
    });
    const s = chart.addSeries(AreaSeries, { lineColor: "#C8FF3D", lineWidth: 3, topColor: "rgba(200,255,61,0.28)", bottomColor: "rgba(200,255,61,0)" });
    s.setData(candles.map((c) => ({ time: c.time as UTCTimestamp, value: c.close })));
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [candles]);

  return (
    <div className="flex flex-col gap-4 bg-surface border line rounded-[32px] px-5 md:px-7 py-6">
      <div className="flex justify-between items-center">
        <span className="font-display font-bold">Price</span>
        <div className="flex gap-1.5 font-mono text-[13px]">
          {(["1H", "1D", "1W"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTf(t)} aria-pressed={tf === t}
              className={`px-3.5 py-2 min-h-11 rounded-full ${tf === t ? "bg-raised-2 text-ink border border-white/10" : "text-muted"}`}>{t}</button>
          ))}
        </div>
      </div>
      {candles && candles.length === 0
        ? <div className="h-[340px] flex items-center justify-center text-muted text-sm">No trades to chart yet</div>
        : <div ref={el} className="h-[340px]" aria-label="Price chart" role="img" />}
    </div>
  );
}
```

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** `git add -A && git commit -m "Add price chart with cached GeckoTerminal data"`

---

### Task 10: Explore and token pages

**Files:**
- Create: `src/app/explore/page.tsx`, `src/app/t/[mint]/page.tsx`, `src/web/token/TradePanel.tsx`, `src/web/ui/FlatRow.tsx`
- Modify: `src/app/layout.tsx` (Jupiter plugin script)

**Interfaces:**
- Consumes: `listLaunches`, `launchDetail`, `Chart`.
- Produces: pages only.

- [ ] **Step 1: Explore page** (server component, `dynamic = "force-dynamic"`): Header active "explore"; `h1` "Explore" in display 900; filter links "All" / "Graduated" (`?graduated=1`); flat rows per launch linking to `/t/[mint]`: Avatar (image or gradient), symbol and name, pair and fee chips, status ("Graduated" in lime or "On the curve" in muted), basket symbols from `baskets.symbol` (shortened mint when missing), burned amount. Empty state: "Nothing launched yet" with a link to Launch.

- [ ] **Step 2: Token page** (server component) loads `launchDetail(getContext(), mint)` (`notFound()` when null) and renders the canvas layout, fluid: header block (Avatar 96px, symbol `h1`, name, chips for pair, fee, shortened mint with a copy button), stats (price, market cap, 24h change from `/api/chart` market loaded client side inside a small `MarketStats` client component; graduation progress bar `quoteReserve / threshold` as a percent, or "Graduated" when migrated), `Chart`, `TradePanel`, "Stake {symbol}, earn" flat rows (Avatar, symbol, weight, paid out with `fmtAmount` using `baskets.decimals`), the burned panel (orange, flame icon), lock tier rows with multiplier, lock, staked, share bar and percent, and a "Stake now" link to `/t/[mint]/stake`.

- [ ] **Step 3: Trade panel** `TradePanel.tsx` (client): loads `https://plugin.jup.ag/plugin-v1.js` once via `next/script` in the layout (`strategy="afterInteractive"`), then in an effect calls:

```ts
window.Jupiter.init({
  displayMode: "integrated",
  integratedTargetId: "jupiter-plugin",
  enableWalletPassthrough: true,
  passthroughWalletContextState: wallet,
  formProps: { initialInputMint: quoteMint, initialOutputMint: mint, fixedMint: mint },
});
```

and `window.Jupiter.syncProps({ passthroughWalletContextState: wallet })` whenever the wallet state changes. Wrap in `<div id="jupiter-plugin" className="panel p-3 min-h-[420px]" />`. Declare `window.Jupiter` in `src/web/types/jupiter.d.ts`.

- [ ] **Step 4: Verify** `bun run build` succeeds; run `bun run dev` against the local validator database seeded by `scripts/e2e-local.ts` and load `/explore` and `/t/<mint>` at 1440 and 390 widths.
- [ ] **Step 5: Commit** `git add -A && git commit -m "Add explore and token pages"`

---

### Task 11: Staking user transactions

**Files:**
- Modify: `src/staking/adapter.ts`, `src/staking/kamino.ts`, `tests/helpers/fake-staking.ts`
- Test: `tests/staking/kamino-user.test.ts` (local validator)

**Interfaces:**
- Produces (on `StakingAdapter`):

```ts
position(owner: string, farm: string): Promise<{ staked: bigint; activeShares: bigint; lastStakeTs: number; lockSeconds: number; pending: { mint: string; amount: bigint }[] } | null>
buildStakeTx(owner: string, farm: string, stakeMint: string, amount: bigint): Promise<string>   // base64 legacy, fee payer owner, unsigned; adds createNewUserIx when the user state does not exist
buildClaimTx(owner: string, farm: string): Promise<string>
buildExitTx(owner: string, farm: string, stakeMint: string): Promise<string>  // unstakeIx(activeStakeScaled) + withdrawUnstakedDepositIx in one tx
buildWithdrawTx(owner: string, farm: string, stakeMint: string): Promise<string>  // same pair after unlock (no penalty)
```

`staked` = `activeStakeScaled / 10^18`. `pending` via `farms.getUserPendingRewards(userState, farmState, new Decimal(nowSeconds), null)` mapped to reward mints.

- [ ] **Step 1: Failing validator test**: create a farm with two reward mints via the existing backend helpers (as `tests/staking/kamino.test.ts` does), fund reward 0, then as a user wallet: `buildStakeTx` → sign with the user keypair → send → `position()` shows `staked` equal to the amount and `lastStakeTs` set; wait 3 seconds; `position().pending[0].amount > 0`; `buildClaimTx` → sign/send → the user's reward ATA balance grew; `buildExitTx` → sign/send → user gets back `amount − slashed` and the farm's `slashedAmountCurrent > 0`; `position()` returns `staked: 0n`.

- [ ] **Step 2: Run** `bun test --timeout 60000 tests/staking` — FAIL.

- [ ] **Step 3: Implement** in `KaminoBackend` with a private `unsigned(ixs: TransactionInstruction[], feePayer: PublicKey)` that sets a fresh blockhash and returns `tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64")`. Use `farms.getUserStatesForUserAndFarm(owner, farm)` to find the state; `kitSigner` equivalent for an address the server does not hold: `createNoopSigner(address(owner))`. Claim uses `claimForUserForFarmAllRewardsIx(noopSigner(owner), address(owner), farm, false)` (it also returns ATA create ixs). Add the same methods to `FakeStaking` returning `"dHg="` and a `positions` map.

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** `git add -A && git commit -m "Add staking user transactions"`

---

### Task 12: Stake API and stake page

**Files:**
- Create: `src/app/api/launches/[mint]/positions/route.ts`, `src/app/api/stake/[action]/route.ts`, `src/app/t/[mint]/stake/page.tsx`, `src/web/stake/StakePanel.tsx`, `src/web/stake/Positions.tsx`
- Modify: `src/web/server/reads.ts` (`positions(ctx, mint, owner)`)
- Test: `tests/web/stake-routes.test.ts`

**Interfaces:**
- Produces: `GET /api/launches/[mint]/positions?owner=` → `{ positions: { tierId, farm, multiplierBps, lockSeconds, staked, unlocksAt, locked: boolean, pending: { mint, symbol, amount }[], exitPreview: { back, burned, penaltyBps } | null }[] }`; `POST /api/stake/[action]` with `action ∈ stake|claim|exit|withdraw`, body `{ mint, tierId, owner, amount? }` → `{ transaction: { base64, versioned: false } }`.
- `exitPreview` uses plan 1's `earlyExitPenalty(staked, maxPenaltyBps, lockSeconds, secondsRemaining)`; `penaltyBps` is the floored rate the same function computes.

- [ ] **Step 1: Failing tests**: with the fake context and a ready stake pool, `positions` returns a locked position with an exit preview (`staked 1_000_000`, 30% max, half the lock left → `burned "150000"`, `back "850000"`); `stake` with a non numeric amount → 400; `stake` for an unknown tier → 400 `invalid_input`; `exit` on an unlocked position → 400 with message "This stake is unlocked, withdraw it instead"; `withdraw` on a locked position → 400 "This stake is still locked"; a valid `stake` returns a base64 transaction.

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** the reads, routes and pages. `StakePanel` (client): tier tiles (violet selected state with glow, as the canvas), amount input with Max (reads the user's token balance with `conn.getTokenAccountBalance`), rows for "Unlocks on" (now + lock), "Reward weight", "Leave early: up to {max}% burned"; when the user already holds a locked position in the chosen tier, an orange line above the button: "Adding to this stake restarts its {lock} lock for the whole position." Button "Stake for {lock}". `Positions` (client): flat rows per position with multiplier, amount, unlock text, pending rewards per basket token, Claim, Exit early (opens the confirmation block from the canvas: "You get back", "Burned", the explanation "The penalty is {p}% because {d} of your {D} days are left. It shrinks every day you stay. Rewards you already earned are yours to keep. Burned tokens are gone for good, and quants never receives them.", buttons "Exit and burn {x} {symbol}" and "Keep staking"), or Withdraw when unlocked. All actions go through `signAndSendAll` then refetch positions.
- [ ] **Step 4: Run** tests — PASS; `bun run build` succeeds.
- [ ] **Step 5: Commit** `git add -A && git commit -m "Add stake page and routes"`

---

### Task 13: Admin

**Files:**
- Create: `src/web/server/admin.ts`, `src/app/api/admin/nonce/route.ts`, `src/app/api/admin/session/route.ts`, `src/app/api/admin/settings/route.ts`, `src/app/api/admin/status/route.ts`, `src/app/api/admin/basket/route.ts`, `src/app/admin/page.tsx`, `src/web/admin/AdminApp.tsx`
- Test: `tests/web/admin.test.ts`

**Interfaces:**
- Produces:

```ts
issueNonce(ctx): Promise<{ message: string; cookie: string }>      // message "Sign in to quants admin\nNonce: <hex>\nIssued: <iso>"; nonce cookie is a 5 minute JWT
openSession(ctx, req, { wallet, signature }): Promise<string>       // verifies nonce cookie, ed25519 signature over the message, wallet in ADMIN_WALLETS → 8 hour session JWT cookie
requireAdmin(ctx, req): Promise<string>                              // returns wallet; AuthError 401 no/invalid cookie, 403 wallet not (or no longer) in ADMIN_WALLETS
```

Cookies: `httpOnly; Secure; SameSite=Strict; Path=/`. `requireAdmin` re-checks the allowlist on every request.

- [ ] **Step 1: Failing tests**: full sign-in with `ADMIN` keypair (`nacl.sign.detached`) returns a session cookie and `GET /api/admin/settings` works with it; a signature from a non-admin keypair → 403; a signature over a different nonce → 401; a nonce cookie older than 5 minutes → 401; **a valid session cookie after the wallet is removed from `adminWallets` → 403**; `POST /api/admin/settings` with a split not summing to 100% → 400 and no new version; a valid save → new version returned by `loadLatestSettings`; `GET /api/admin/status` lists failed distributions with their errors and the last run time; `POST /api/admin/basket` replaces a launch's basket (weights must sum to 10000, max 3, classic SPL) and is refused once the stake pool is `ready` (farms already carry reward mints) with 400 "Farms already exist for this launch".
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** with `jose` (`SignJWT`/`jwtVerify`, HS256 with `sessionSecret`) and `tweetnacl` (`nacl.sign.detached.verify(message, sig, pubkey.toBytes())`). `AdminApp` (client): sign in button (wallet `signMessage`), then tabs Settings (form for every setting with inline validation, "Save as new version"), Keeper (last run, launches skipped for in-flight steps, failed steps as flat rows with kind, launch, error, time), Baskets (search a launch by mint, edit basket while its pool is pending).
- [ ] **Step 4: Run** — PASS; build succeeds.
- [ ] **Step 5: Commit** `git add -A && git commit -m "Add admin sign in, settings, status and basket override"`

---

### Task 14: Test wallet and Playwright smoke

**Files:**
- Create: `src/web/wallet/test-wallet.ts`, `playwright.config.ts`, `e2e/smoke.spec.ts`, `scripts/e2e-seed.ts`
- Modify: `src/web/wallet/Providers.tsx` (register the test wallet when `NEXT_PUBLIC_TEST_WALLET_SECRET` is set)

**Interfaces:**
- `registerTestWallet(secret: Uint8Array)` registers a Wallet Standard wallet named "Test Wallet" supporting `standard:connect`, `standard:events`, `solana:signTransaction`, `solana:signAndSendTransaction` (not needed), `solana:signMessage`, signing with `nacl`/web3.js `Keypair`. Only compiled into builds where the env var is set; `next.config.ts` fails the build when both `NODE_ENV=production` and the variable are set.

- [ ] **Step 1: Seed script** `scripts/e2e-seed.ts`: like `scripts/e2e-local.ts` steps 1 to 3 (fund wallets, DBC config, Kamino global config, migrate, settings), writes `.env.e2e` with every web env var and a funded test wallet secret, plus `config-keys.json`. The Pinata port is replaced by a local stub when `PINATA_JWT=stub` (returns a data URL for the image and a same-origin `/api/metadata/stub/<id>` URI served from memory).
- [ ] **Step 2: Smoke spec** (`e2e/smoke.spec.ts`):
  1. Open `/`, connect "Test Wallet", fill name, symbol, upload `e2e/fixtures/cat.png`, pick pair SOL and fee 2%, add a basket token (the seed registers a local mint in the stub token search), submit, expect redirect to `/t/<mint>` within 30 seconds.
  2. On the token page, expect the symbol heading, the "Stake CAT, earn" rows and the lock tier rows.
  3. Run one keeper pass (the spec calls `bun scripts/keeper-once.ts` via `child_process`) so farms exist.
  4. Open the stake page, pick 30 days, stake a buy amount (the seed bought CAT for the test wallet), expect a position row.
  5. Exit early, confirm, expect the position gone and, after another keeper pass, the token page burned panel shows a non zero amount.
  6. Repeat steps 1 and 2 at a 390 × 844 viewport for visual layout only (no horizontal scroll: `document.documentElement.scrollWidth <= 390`).
- [ ] **Step 3: Run** `solana-test-validator …` (flags from the runbook), `bun scripts/e2e-seed.ts`, `bunx playwright install chromium`, `bunx playwright test` — Expected: all steps pass.
- [ ] **Step 4: Commit** `git add -A && git commit -m "Add test wallet and Playwright smoke run"`

---

### Task 15: Deploy files and runbook

**Files:**
- Create: `deploy/Caddyfile`, `deploy/quants-web.service`, `deploy/quants-keeper.service`, `scripts/keeper-once.ts` (if not created in Task 14)
- Modify: `docs/runbook.md`

- [ ] **Step 1: Write the files.**

`deploy/Caddyfile`:

```
{$QUANTS_DOMAIN} {
  encode zstd gzip
  reverse_proxy 127.0.0.1:3000
}
```

`deploy/quants-web.service`:

```
[Unit]
Description=quants web
After=network-online.target postgresql.service

[Service]
WorkingDirectory=/opt/quants
EnvironmentFile=/opt/quants/.env
ExecStart=/usr/local/bin/bun --bun next start -p 3000
Restart=always
User=quants

[Install]
WantedBy=multi-user.target
```

`deploy/quants-keeper.service`: same shape, `ExecStart=/usr/local/bin/bun src/keeper/main.ts`, `Restart=on-failure`, `RestartSec=30` (a `ReconcileError` exit restarts slowly and shows in `journalctl`).

- [ ] **Step 2: Runbook** additions: VPS setup (Bun, Postgres 16, Caddy), clone to `/opt/quants`, `.env` with every variable from `.env.example`, `bun install`, `bun run migrate`, `bun run build`, enable both services, `journalctl -u quants-keeper -f` to watch runs; web env vars that must never be set in production (`NEXT_PUBLIC_TEST_WALLET_SECRET`).
- [ ] **Step 3: Verify** `bun run build && bun test --timeout 60000 && bun run typecheck` — all pass.
- [ ] **Step 4: Commit** `git add -A && git commit -m "Add deploy files and runbook"`

---

## Deferred (not in this plan)

- First buy output estimate on the launch form ("You get about … of supply") using the DBC `swapQuote` helper server side, and a real `devBuyMinOut` for the cap check.
- Explore market caps (needs a price source that does not rate limit at 10 per minute).
- Stitching the pre and post graduation chart series.
