import { test, expect } from "@playwright/test";

const demo = (path: string) => `${path}${path.includes("?") ? "&" : "?"}mode=demo`;

const workspacePages = [
  ["/overview", "See the whole picture."],
  ["/consumption", "Find your daily rhythm."],
  ["/forecasting", "What comes next?"],
  ["/anomalies", "Unusual. Worth a closer look."],
  ["/peak-load", "Find the moments that matter."],
  ["/data", "Good evidence starts here."],
  ["/models", "Know what produced the result."],
  ["/reports", "Evidence you can share."],
  ["/recommendations", "Actions backed by evidence."],
] as const;

test.describe("VoltIQ browser journeys", () => {
  test("landing page exposes working demo and workspace entry points", async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /electricity patterns/i })).toBeVisible();
    await expect(page.getByText(/Synthetic demonstration · not UCI readings/)).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Landing navigation" }).getByRole("link", { name: /open workspace/i })).toHaveAttribute("href", "/data");

    await page.getByRole("link", { name: /interactive demonstration/i }).click();
    await expect(page).toHaveURL(/\/overview\?mode=demo/);
    await expect(page.getByRole("heading", { name: "See the whole picture." })).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  for (const [path, title] of workspacePages) {
    test(`${path} renders its primary screen in demo mode`, async ({ page }) => {
      const consoleErrors: string[] = [];
      const pageErrors: Error[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => pageErrors.push(error));
      await page.goto(demo(path));
      await expect(page.getByRole("heading", { name: title })).toBeVisible();
      await expect(page.getByText("Synthetic demonstration", { exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Overview" })).toBeVisible();
      expect(pageErrors).toEqual([]);
      expect(consoleErrors).toEqual([]);
    });
  }

  test("workspace navigation preserves demo mode and reaches another feature", async ({ page }) => {
    await page.goto(demo("/overview"));
    const forecastingLink = page.getByRole("link", { name: "Forecasting", exact: true });
    await expect(forecastingLink).toHaveAttribute("href", /\/forecasting/);
    await page.goto(await forecastingLink.getAttribute("href") as string);
    await expect(page).toHaveURL(/\/forecasting\?.*mode=demo/);
    await expect(page.getByRole("heading", { name: "What comes next?" })).toBeVisible();

    const dataLink = page.getByRole("link", { name: "Data & pipeline", exact: true });
    await page.goto(await dataLink.getAttribute("href") as string);
    await expect(page).toHaveURL(/\/data\?.*mode=demo/);
    await expect(page.getByRole("heading", { name: "Good evidence starts here." })).toBeVisible();
  });

  test("demo controls update durable URL state", async ({ page }) => {
    await page.goto(demo("/forecasting"));
    const horizon = page.locator("label.field.inline").filter({ hasText: "Horizon" }).locator("select");
    await expect(horizon).toBeVisible();
    await horizon.selectOption("4");
    await expect(page).toHaveURL(/horizon=4/);
    await expect(horizon).toHaveValue("4");
  });

  test("API mode shows a clear backend-unavailable state instead of fabricating data", async ({ page }) => {
    await page.goto("/overview?mode=api");
    await expect(page.getByText(/local api mode/i)).toBeVisible();
    await expect(page.getByText(/The local backend is unavailable\./)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Synthetic demonstration", { exact: true })).not.toBeVisible();
  });
});
