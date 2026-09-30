import { test, expect, type Page } from "@playwright/test";

const CAT = process.env.SEED_CAT_MINT!;

async function connect(page: Page) {
  const btn = page.getByRole("button", { name: "Connect wallet" }).first();
  if (await btn.isVisible()) {
    await btn.click();
    await page.getByRole("button", { name: /Test Wallet/ }).click();
  }
  await expect(page.getByRole("button", { name: /^Wallet / })).toBeVisible();
}

test("trade widget buys and sells on the curve", async ({ page }) => {
  await page.goto(`/t/${CAT}`);
  await connect(page);
  await page.getByRole("button", { name: "0.1", exact: true }).click();
  await expect(page.getByText(/You get about/).locator("..").getByText(/CAT$/)).toBeVisible();
  await page.getByRole("button", { name: "Buy CAT" }).click();
  await expect(page.getByText("Bought. Balances updated.")).toBeVisible();

  await page.getByRole("button", { name: "sell", exact: true }).click();
  await page.getByRole("button", { name: "25%" }).click();
  await page.getByRole("button", { name: "Sell CAT" }).click();
  await expect(page.getByText("Sold. Balances updated.")).toBeVisible();
});

test("wallet modal shows SOL and token balances and links to stakes", async ({ page }) => {
  await page.goto("/");
  await connect(page);
  await page.getByRole("button", { name: /^Wallet / }).click();
  const dialog = page.getByRole("dialog", { name: "Your wallet" });
  await expect(dialog.getByText("SOL balance")).toBeVisible();
  await expect(dialog.getByText("CAT", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Launched here").first()).toBeVisible();
  await dialog.getByRole("link", { name: "Your stakes" }).click();
  await expect(page).toHaveURL(/\/portfolio$/);
  await expect(page.getByRole("heading", { name: "Portfolio" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Native" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tokens launched here" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Stakes" })).toBeVisible();
});

test("docs, terms, portfolio and 404 render", async ({ page }) => {
  await page.goto("/docs");
  await expect(page.getByRole("heading", { name: "Leaving early" })).toBeVisible();
  await expect(page.getByText(/100% of every penalty is burned/)).toBeVisible();
  await page.goto("/terms");
  await expect(page.getByRole("heading", { name: "Terms and risks", level: 1 })).toBeVisible();
  await page.goto("/portfolio");
  await expect(page.getByRole("heading", { name: "Portfolio" })).toBeVisible();
  const r = await page.goto("/t/NotARealMint111111111111111111111111111111");
  expect(r?.status()).toBe(404);
  await expect(page.getByText("Nothing here.")).toBeVisible();
});

test("admin sign in and settings load", async ({ page }) => {
  await page.goto("/admin");
  await connect(page);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(/Current version \d+/)).toBeVisible();
  await page.getByRole("button", { name: "Keeper" }).click();
  await expect(page.getByText("Last keeper activity")).toBeVisible();
});
