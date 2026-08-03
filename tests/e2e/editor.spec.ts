import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const samplePath = path.resolve("test-data/sample-tag-catalog.json");
const realCatalogPath = path.resolve("../ComfyUI-Prompt-Workbench/data/tag_catalog.json");
const sha256 = async (file: string) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex");

test("loads, selects, drags, undoes, redoes, exports and reloads without changing source", async ({
  page,
}) => {
  const beforeHash = await sha256(samplePath);
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(samplePath);
  await expect(page.getByText("sample-tag-catalog.json を読み込みました")).toBeVisible();
  await page.screenshot({
    path: path.resolve("docs/implementation-1440x1024.png"),
    animations: "disabled",
  });

  await page.getByText("one", { exact: true }).click();
  await page.getByText("two", { exact: true }).click({ modifiers: ["Control"] });
  await expect(page.getByText("2件を選択中")).toBeVisible();

  const source = page.getByRole("button", { name: "oneをドラッグ" });
  const target = page.locator('[data-category-id="small-c"]');
  const sourceBox = await source.boundingBox();
  if (!sourceBox) throw new Error("Drag source is not visible");
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(sourceBox.x + sourceBox.width / 2 + 8, sourceBox.y + sourceBox.height / 2 + 8, {
    steps: 3,
  });
  await expect(page.getByText("移動先を選択")).toBeVisible();
  const targetBox = await target.boundingBox();
  if (!targetBox) throw new Error("Drag destination is not visible");
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByText(/2件のタグを/u)).toBeVisible();

  await page.getByRole("button", { name: "元に戻す" }).click();
  await page.getByRole("button", { name: "やり直す" }).click();

  await page.getByRole("button", { name: "差分を確認" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("dialog").getByRole("button", { name: "新しいファイルとして書き出す" }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator('input[type="file"]').setInputFiles({
    name: "reloaded.json",
    mimeType: "application/json",
    buffer: await readFile(downloadPath!),
  });
  await expect(page.getByText(/を読み込みました/u)).toBeVisible();
  expect(await sha256(samplePath)).toBe(beforeHash);
});

test("renders the actual source catalog without changing it", async ({ page }) => {
  const beforeHash = await sha256(realCatalogPath);
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(realCatalogPath);
  await expect(page.getByText("tag_catalog.json を読み込みました")).toBeVisible();
  await page.screenshot({
    path: path.resolve("docs/implementation-1440x1024.png"),
    animations: "disabled",
  });
  expect(await sha256(realCatalogPath)).toBe(beforeHash);
});
