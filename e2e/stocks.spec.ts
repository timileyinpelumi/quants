import { test, expect, type Page } from "@playwright/test";

const symbol = `S${Math.random().toString(36).slice(2, 8).toUpperCase().replace(/[^A-Z0-9]/g, "X")}`;

async function connect(page: Page) {
  const btn = page.getByRole("button", { name: "Connect wallet" }).first();
  if (await btn.isVisible()) {
    await btn.click();
    await page.getByRole("button", { name: /Test Wallet/ }).click();
  }
  await expect(page.getByRole("button", { name: /^Wallet / })).toBeVisible();
}

test("a token paired with a stock launches trading only", async ({ page }) => {
  await page.goto("/launch");
  await connect(page);
  await expect(page.getByRole("tab", { name: /xStocks\s*1/ })).toBeVisible();
  await page.getByRole("tab", { name: /xStocks/ }).click();
  await page.getByRole("radio", { name: /NVDAx/ }).click();
  await expect(page.getByText("No reward basket")).toBeVisible();
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
  await expect(page.getByText(/Balance [\d,.]+ NVDAx/)).toBeVisible();

  await page.goto("/explore?sort=new");
  await expect(page.getByText("Trading only").first()).toBeVisible();
});
