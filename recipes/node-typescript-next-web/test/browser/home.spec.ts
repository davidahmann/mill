import { expect, test } from "@playwright/test";

test("renders the approved product title and a healthy API", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    __MILL_PRODUCT_TITLE_LITERAL__,
  );
  const response = await request.get("/api/health");
  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toEqual({ status: "ok" });
});
