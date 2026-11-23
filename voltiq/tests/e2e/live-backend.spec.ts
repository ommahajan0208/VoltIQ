import { test, expect } from "@playwright/test";

const dataset = "ds_27f913dfd790465d9cf7120232074fad";
const version = "v_db146bde0c54c24a70f7019c2ecc036324659ace1de7ba9089759d31b5117794";
const run = "run_188c0803092c8577bcc6d5393c81991f";

const params = new URLSearchParams({
  mode: "api",
  dataset,
  version,
  run,
  from: "2007-05-14T00:00:00",
  to: "2007-05-15T00:00:00",
  origin: "2007-05-14T00:00:00",
  horizon: "4",
  model: "chronos_bolt_tiny",
  forecast_mode: "backtest",
});

const live = (path: string) => `${path}?${params}`;

const pages = [
  ["/overview", "See the whole picture."],
  ["/consumption", "Find your daily rhythm."],
  ["/forecasting", "What comes next?"],
  ["/anomalies", "Unusual. Worth a closer look."],
  ["/peak-load", "Find the moments that matter."],
  ["/data", "Good evidence starts here."],
  ["/models", "Know what produced the result."],
  ["/recommendations", "Actions backed by evidence."],
  ["/reports", "Evidence you can share."],
] as const;

test.describe("VoltIQ live FastAPI journeys", () => {
  test("Next proxy exposes the real backend health envelope", async ({ request }) => {
    const response = await request.get("/api/v1/health");
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.data.api).toBe("ready");
    expect(body.meta).toEqual({
      schema_version: "2.0",
      time_basis: "source_local_naive",
    });
  });

  for (const [path, title] of pages) {
    test(`${path} renders data from a successful FastAPI run`, async ({ page }) => {
      const serverFailures: string[] = [];
      page.on("response", (response) => {
        if (response.url().includes("/api/v1/") && response.status() >= 500)
          serverFailures.push(`${response.status()} ${response.url()}`);
      });
      await page.goto(live(path));
      await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("Local API mode", { exact: true })).toBeVisible();
      await expect(page.getByLabel("Dataset")).toHaveValue(dataset);
      await expect(page.getByLabel("Run")).toHaveValue(run);
      expect(serverFailures).toEqual([]);
    });
  }

  test("overview shows real metrics and navigates into live forecasting", async ({ page }) => {
    await page.goto(live("/overview"));
    await expect(page.getByText("Observed energy", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Candidate events", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open forecasting" })).toBeVisible();
    await page.getByRole("link", { name: "Open forecasting" }).click();
    await expect(page).toHaveURL(/\/forecasting\?/);
    await expect(page.getByRole("heading", { name: "What comes next?" })).toBeVisible();
    await expect(page.getByText("Local API mode", { exact: true })).toBeVisible();
  });

  test("forecast horizon and date range controls remain connected to live state", async ({ page }) => {
    await page.goto(live("/forecasting"));
    await expect(page.getByLabel("Dataset")).toHaveValue(dataset);
    await expect(page.getByLabel("Run")).toHaveValue(run);
    const horizon = page.locator("label.field.inline").filter({ hasText: "Horizon" }).locator("select");
    await expect(horizon).toHaveValue("4");
    await horizon.selectOption("1");
    await expect(page).toHaveURL(/horizon=1/);
    await expect(horizon).toHaveValue("1");

    await page.goto(live("/overview"));
    await page.locator("#range-from").fill("2007-05-15");
    await page.locator("#range-to").fill("2007-05-16");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/from=2007-05-15T00%3A00%3A00/);
    await expect(page).toHaveURL(/to=2007-05-17T00%3A00%3A00/);
  });
});
