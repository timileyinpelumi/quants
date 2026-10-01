# Quants web app design

Date: 2026-09-30
Status: draft
Builds on: `docs/specs/2026-09-30-quants-design.md` (core spec) and the backend on `main` (plan 1).
Visual reference: the approved design canvas "Quants design direction" (Launch, Token page, Stake and early exit, Phone).

## Summary

The web app for quants: launch a token, trade it, stake it, claim the reward basket, exit early, and an admin page for settings and keeper health. It runs the plan 1 backend functions from Next.js route handlers.

## Scope

In scope:

- Pages: Launch, Explore, Token (`/t/[mint]`), Stake (`/t/[mint]/stake`), Admin (`/admin`).
- API routes wrapping `prepareLaunch`, `confirmLaunch`, `saveSettings`, `loadLatestSettings`, the staking adapter's user transactions, and read endpoints over Postgres.
- Image and metadata upload to Pinata.
- Wallet connection with the Solana wallet adapter (Wallet Standard wallets detected automatically).
- Trading through Jupiter's embeddable plugin.
- Price chart from a public OHLCV source.
- Admin sign in with a signed message from an allowlisted wallet.
- Deploy: web app and keeper on one VPS behind Caddy.

Out of scope:

- Our own indexer for trades or prices.
- Notifications, email, social features, comments.
- Contract mode.

## Look and feel

From the approved canvas. Tokens:

| Token | Value |
|---|---|
| Ground | `#0A0A0F`, with soft radial glows (lime, violet, orange) per page |
| Surface | `#111018`, raised `#16151E` to `#1B1A24` |
| Line | `rgba(255,255,255,0.07)` |
| Text | `#F4F2EE`, muted `#9A97A8`, faint `#6F6C7E` |
| Lime (actions, earnings) | `#C8FF3D` with glow `rgba(200,255,61,0.35)` |
| Violet (tiers, multipliers) | `#9D8CFF`, light `#BDB2FF` |
| Orange (burns, penalties) | `#FF9B7A` |
| Display font | Unbounded 700/900, tight tracking |
| Body font | Geist 400/500/600 |
| Numbers | Geist Mono |
| Buttons | pills, inset bottom shadow, glow on primary |
| Radii | inputs 16 to 22 px, panels 32 px |

Lists are flat divider rows, never cards. Copy is plain and has no hyphens or dashes. Every page works at 390 px wide.

## Pages

### Launch (`/`)

Numbered sections as in the canvas: token (image, name, symbol), pair and fee, reward basket, first buy, then links (website, X, Telegram) and description. A summary panel shows the fee split, lock tiers, the farm setup the stakers' share pays before staking opens, graduation target and the Launch button. There is no launch fee.

Flow: upload image and metadata (`POST /api/metadata`) → `POST /api/launch/prepare` → wallet signs (with a Jupiter SOL to OURTOKEN swap first when the pair is OURTOKEN and there is a first buy; both signed in one approval) → send → `POST /api/launch/confirm` → go to the token page.

Basket token picker: search the Jupiter token list, verified tokens only, classic SPL only (the server checks too).

### Explore (`/explore`)

Flat rows of launches: avatar, symbol, pair, market cap, graduation progress, basket symbols, total staked. Newest first, with a filter for graduated.

### Token (`/t/[mint]`)

As in the canvas: header, price and market cap, graduation progress (DBC quote reserve over threshold) or "Graduated" with the DAMM pool, chart, trade panel (Jupiter plugin fixed to this mint), "Stake CAT, earn" basket rows with amounts paid out, burned counter, lock tier rows with total staked and share of rewards.

### Stake (`/t/[mint]/stake`)

Tier picker, amount, unlock date, reward weight, stake button. Positions list with pending rewards per basket token, Claim, Exit early (with confirmation showing amount back, amount burned and why), Withdraw after unlock. Adding to an existing position shows that the whole position's lock restarts (spike finding).

### Admin (`/admin`)

Sign in with an allowlisted wallet. Sections: settings form (every setting from the core spec, saved as a new version), keeper status (last run time from the latest `distributions` row, launches skipped for in-flight steps), failed steps list with error text, basket override per launch.

## API

| Route | Does |
|---|---|
| `POST /api/metadata` | multipart image plus fields → uploads image and metadata JSON to Pinata → `{ uri, image }` |
| `POST /api/launch/prepare` | `prepareLaunch` → `{ transaction, mint, pool, settingsVersion }` |
| `POST /api/launch/confirm` | `confirmLaunch({ signature, mint })` → `{ launchId }` |
| `GET /api/launches` | Explore list |
| `GET /api/launches/[mint]` | token page data: launch, basket, tiers with totals, paid out per reward mint, burned total, curve progress |
| `GET /api/launches/[mint]/positions?owner=` | staker positions per tier with pending rewards |
| `POST /api/stake/[action]` | `stake`, `claim`, `exit`, `withdraw` → unsigned transaction (base64) for the wallet |
| `GET /api/chart/[mint]?tf=` | OHLCV proxy with a short cache |
| `POST /api/admin/session` | verify signed nonce message from an allowlisted wallet → httpOnly session cookie |
| `GET/POST /api/admin/settings` | load latest / save new version |
| `GET /api/admin/status` | keeper status and failed steps |
| `POST /api/admin/basket` | override a launch's basket |

Errors return `{ error: { code, message } }` with 400 for `LaunchError` codes, 401/403 for admin, 500 otherwise.

## Invariants

- The server never signs for a user. User transactions are built server side and returned unsigned.
- Admin routes require a valid session cookie; the cookie is issued only for allowlisted wallets after a fresh signed nonce.
- Everything the token and stake pages show about rewards and burns comes from the ledger (`distributions`, `escrow`) or chain reads, never client input.

## Deploy

One VPS runs Postgres, the web app (`bun --bun next start`) and the keeper as systemd services, with Caddy for TLS. The web app uses `Bun.SQL`, so it runs on the Bun runtime; Vercel is not used.

## Testing

- Route handlers are unit tested with fakes (same ports as plan 1).
- Staking user transactions are tested on the local validator.
- One Playwright smoke run against the local validator: launch with a test wallet, see the token page, see staking progress below 100%, trade on the curve until staking opens, stake, exit early, check the burn row.
- `next build` and `tsc` pass.
