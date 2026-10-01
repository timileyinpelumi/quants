import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";

const keeperPass = () => execSync("bun --env-file=.env.local scripts/keeper-once.ts", { stdio: "pipe", timeout: 180_000 }).toString();
const symbol = `E${Math.random().toString(36).slice(2, 8).toUpperCase().replace(/[^A-Z0-9]/g, "X")}`;

async function connect(page: Page) {
  const btn = page.getByRole("button", { name: "Connect wallet" }).first();
  if (await btn.isVisible()) {
    await btn.click();
    await page.getByRole("button", { name: /Test Wallet/ }).click();
  }
  await expect(page.getByRole("button", { name: /^Wallet / })).toBeVisible();
}

test("launch, see the token, stake, exit early and see the burn", async ({ page }) => {
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
  await page.getByPlaceholder("0").first().fill("1");
  await page.getByRole("button", { name: `Launch ${symbol}` }).click();
  await page.waitForURL(/\/t\/[1-9A-HJ-NP-Za-km-z]{32,44}$/, { timeout: 120_000 });
  const mint = page.url().split("/t/")[1]!;

  await expect(page.getByRole("heading", { name: symbol, level: 1 })).toBeVisible();
  await expect(page.getByText(`Stake ${symbol}, earn`)).toBeVisible();
  await expect(page.getByText("180 days")).toBeVisible();

  keeperPass();
  await page.goto(`/t/${mint}/stake`);
  await expect(page.getByText("Staking opens a few minutes after launch")).toHaveCount(0);
  await page.getByRole("button", { name: /2x\s*30 days/ }).click();
  await page.getByRole("button", { name: "Max" }).click();
  await page.getByRole("button", { name: "Stake for 30 days" }).click();
  await expect(page.getByText(/30 days, unlocks/)).toBeVisible();

  await page.getByRole("button", { name: "Exit early" }).click();
  await expect(page.getByText("You get back")).toBeVisible();
  await page.getByRole("button", { name: /Exit and burn/ }).click();
  await expect(page.getByText(/No stakes yet/)).toBeVisible();

  keeperPass();
  await page.goto(`/t/${mint}`);
  await expect(page.getByText(new RegExp(`^[1-9][\\d,]* ${symbol} burned`))).toBeVisible();
});

test("pages fit a phone screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/", "/launch", "/explore", `/t/${process.env.SEED_CAT_MINT ?? ""}`, `/t/${process.env.SEED_CAT_MINT ?? ""}/stake`, "/admin"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(390);
  }
});
