import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";

const keeperPass = () => execSync("bun --env-file=.env.local scripts/keeper-once.ts", { stdio: "pipe", timeout: 180_000 }).toString();
// Buy and sell rounds on the curve; at a 2% fee, 6 rounds of 5 SOL pay the stakers' share past the farm setup of 4 tiers and 2 rewards.
const trade = (mint: string, rounds: number) =>
  execSync(`bun --env-file=.env.local scripts/trade-curve.ts ${mint} ${rounds} 5`, { stdio: "pipe", timeout: 180_000 }).toString();
const symbol = `E${Math.random().toString(36).slice(2, 8).toUpperCase().replace(/[^A-Z0-9]/g, "X")}`;

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 768;

type WalletCalls = { signAndSend: number; sign: number; mostPerPrompt: number };
const walletCalls = (page: Page) => page.evaluate(() => ({ ...(window as unknown as { __testWalletCalls: WalletCalls }).__testWalletCalls }));

async function connect(page: Page) {
  const btn = page.getByRole("button", { name: "Connect wallet" }).first();
  if (await btn.isVisible()) {
    await btn.click();
    await page.getByRole("button", { name: /Test Wallet/ }).click();
  }
  await expect(page.getByRole("button", { name: /^Wallet / })).toBeVisible();
}

test("launch, trade until staking opens, stake, exit early and see the burn", async ({ page }) => {
  await page.goto("/launch");
  await connect(page);

  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/cat.png");
  await page.getByLabel("Name").fill("End To End");
  await page.getByLabel("Symbol").fill(symbol);
  await page.getByRole("button", { name: /Add reward tokens/ }).click();
  const picker = page.getByRole("dialog");
  await picker.getByRole("checkbox", { name: /ZEC/ }).click();
  await picker.getByRole("checkbox", { name: /CATE/ }).click();
  await picker.getByRole("button", { name: "Add 2 tokens" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText(/Staking opens once it covers that/)).toBeVisible();
  await expect(page.getByText("Launch fee")).toHaveCount(0);
  await page.getByPlaceholder("0").first().fill("1");
  await page.getByRole("button", { name: `Launch ${symbol}` }).click();
  await expect.poll(async () => (await walletCalls(page)).sign, { timeout: 120_000 }).toBeGreaterThan(0);
  // The launch carries the mint's signature, so the wallet only signs it and signs first; one transaction per prompt.
  const launchCalls = await walletCalls(page);
  expect(launchCalls.mostPerPrompt).toBe(1);
  expect(launchCalls.sign).toBe(1);
  await page.waitForURL(/\/t\/[1-9A-HJ-NP-Za-km-z]{32,44}$/, { timeout: 120_000 });
  const mint = page.url().split("/t/")[1]!;
  if (isPhone(page)) await page.getByRole("tab", { name: "Rewards" }).click();

  await expect(page.getByRole("heading", { name: symbol, level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Rewards and staking" })).toBeVisible();
  await expect(page.getByText("30 days").first()).toBeVisible();

  // The first buy's fees alone do not cover the farms, so staking stays closed and shows its progress.
  keeperPass();
  await page.goto(`/t/${mint}/stake`);
  await expect(page.getByText("Staking opens at 100%")).toBeVisible();
  const before = Number((await page.getByLabel("Staking progress").getByText(/^\d+%$/).textContent())!.replace("%", ""));
  expect(before).toBeGreaterThan(0);
  expect(before).toBeLessThan(100);
  await expect(page.getByText(/SOL .*to go/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Stake for / })).toBeDisabled();
  await page.goto("/explore?sort=new");
  await expect(page.getByText(`Staking at ${before}%`).first()).toBeVisible();

  trade(mint, 6);
  keeperPass();
  await page.goto(`/t/${mint}/stake`);
  await expect(page.getByText("Staking opens at 100%")).toHaveCount(0);
  await page.getByRole("button", { name: /2x\s*30 days/ }).click();
  await page.getByRole("button", { name: "Max" }).click();
  await page.getByRole("button", { name: "Stake for 30 days" }).click();
  await expect(page.getByText(/30 days, unlocks/)).toBeVisible();
  // A wallet only transaction goes through signAndSendTransaction, as Phantom wants.
  expect(await walletCalls(page)).toMatchObject({ signAndSend: 1, sign: 0, mostPerPrompt: 1 });

  await page.getByRole("button", { name: "Exit early" }).click();
  await expect(page.getByText("You get back")).toBeVisible();
  await page.getByRole("button", { name: /Exit and burn/ }).click();
  await expect(page.getByText(/No stakes yet/)).toBeVisible();

  keeperPass();
  await page.goto(`/t/${mint}${isPhone(page) ? "#rewards" : ""}`);
  await expect(page.getByText(new RegExp(`^[1-9][\\d,]* ${symbol} burned`))).toBeVisible();
});

test("pages fit a phone screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/", "/launch", "/explore", `/t/${process.env.SEED_CAT_MINT ?? ""}`, `/t/${process.env.SEED_STOCK_MINT ?? ""}`, `/t/${process.env.SEED_CAT_MINT ?? ""}/stake`, "/admin"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(390);
  }
});
