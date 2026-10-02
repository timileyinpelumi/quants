import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";

const symbol = `S${Math.random().toString(36).slice(2, 8).toUpperCase().replace(/[^A-Z0-9]/g, "X")}`;

async function connect(page: Page) {
  const btn = page.getByRole("button", { name: "Connect wallet" }).first();
  if (await btn.isVisible()) {
    await btn.click();
    await page.getByRole("button", { name: /Test Wallet/ }).click();
  }
  await expect(page.getByRole("button", { name: /^Wallet / })).toBeVisible();
}

// Stock pairs are off by default; turn them on in the admin settings (or seed STOCK_PAIRS=1 on a fresh database) and set STOCK_PAIRS=1 for this run.
test.skip(process.env.STOCK_PAIRS !== "1", "stock pairs are off");

test("a token paired with a stock launches trading only", async ({ page }) => {
  await page.goto("/launch");
  await connect(page);
  await expect(page.getByRole("tab", { name: /xStocks\s*1/ })).toBeVisible();
  await page.getByRole("tab", { name: /xStocks/ }).click();
  await page.getByRole("radio", { name: /NVDAx/ }).click();
  await expect(page.getByText("No reward basket", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Add reward tokens/ })).toHaveCount(0);
  await expect(page.getByText("Lock tiers for stakers")).toHaveCount(0);

  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/cat.png");
  await page.getByLabel("Name").fill("Stock End To End");
  await page.getByLabel("Symbol").fill(symbol);
  await page.getByRole("button", { name: `Launch ${symbol}` }).click();
  await page.waitForURL(/\/t\/[1-9A-HJ-NP-Za-km-z]{32,44}$/, { timeout: 120_000 });

  await expect(page.getByRole("heading", { name: symbol, level: 1 })).toBeVisible();
  await expect(page.getByText("Trading only").first()).toBeVisible();
  await expect(page.getByText(`${symbol} / NVDAx`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Stake", exact: true })).toHaveCount(0);
  await expect(page.getByText(`Stake ${symbol}, earn`)).toHaveCount(0);
  if ((page.viewportSize()?.width ?? 1280) < 768) await page.getByRole("button", { name: "Buy", exact: true }).click();
  await expect(page.getByText(/Balance [\d,.]+ NVDAx/)).toBeVisible();

  await page.getByLabel("Amount of NVDAx").fill("5");
  await expect(page.getByText(/You get about\s*[\d,.]+ /)).toBeVisible();
  await page.getByRole("button", { name: `Buy ${symbol}` }).click();
  await expect(page.getByText("Bought. Balances updated.")).toBeVisible();
  // A trade is wallet only: one signAndSendTransaction prompt, one transaction.
  const calls = await page.evaluate(() => ({ ...(window as unknown as { __testWalletCalls: { signAndSend: number; mostPerPrompt: number } }).__testWalletCalls }));
  expect(calls).toMatchObject({ signAndSend: 1, mostPerPrompt: 1 });

  // The keeper claims the fee in the stock token, splits it with no basket and pays the treasury, all with Token-2022 transfers.
  const run = JSON.parse(execSync("bun --env-file=.env.local scripts/keeper-once.ts", { stdio: "pipe", timeout: 180_000 }).toString().trim().split("\n").at(-1)!);
  expect(run.errors).toEqual([]);

  await page.goto("/explore?sort=new");
  await expect(page.getByText("Trading only").first()).toBeVisible();
});
