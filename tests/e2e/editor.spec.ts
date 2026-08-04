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
}, testInfo) => {
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
  await expect(page.locator(".tag-row.is-selected")).toHaveCount(2);

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
  await expect(page.locator(".success-toast")).toContainText("2件を");

  await page.locator(".success-toast").getByRole("button", { name: "元に戻す" }).click();
  await expect(page.getByText("移動を元に戻しました")).toBeVisible();
  await page.getByRole("button", { name: "やり直す" }).click();
  await page.getByText("アクセサリー", { exact: true }).click();
  await expect(page.getByLabel("one：移動済み")).toBeVisible();
  await expect(page.getByLabel("two：移動済み")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("tags-changed.png"), animations: "disabled" });

  await page.getByRole("button", { name: "新しいファイルとして書き出す" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("dialog").getByRole("button", { name: "新しいファイルとして書き出す" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^sample-tag-catalog_edited_\d{8}_\d{6}\.json$/u);
  expect(download.suggestedFilename()).not.toBe("tag_catalog.json");
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

test("centers the tag drag preview and shows motion and exact insertion feedback", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const source = page.getByRole("button", { name: "long_hairをドラッグ", exact: true });
  const targetRow = page.locator('[data-tag-id="tag:hair-style:5"]');
  const sourceBox = await source.boundingBox();
  const targetBox = await targetRow.boundingBox();
  if (!sourceBox || !targetBox) throw new Error("Tag drag controls are not visible");

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(sourceBox.x + sourceBox.width / 2 + 12, sourceBox.y + sourceBox.height / 2 + 8, {
    steps: 3,
  });
  const pointerX = targetBox.x + targetBox.width / 2;
  const pointerY = targetBox.y + targetBox.height / 2;
  await page.mouse.move(pointerX, pointerY, { steps: 10 });

  const overlay = page.locator(".drag-overlay.tag");
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveClass(/has-trail/u);
  const overlayBox = await overlay.boundingBox();
  if (!overlayBox) throw new Error("Tag drag preview is not visible");
  expect(Math.abs(overlayBox.x + overlayBox.width / 2 - pointerX)).toBeLessThan(4);
  expect(Math.abs(overlayBox.y + overlayBox.height / 2 - pointerY)).toBeLessThan(4);
  await expect(targetRow).toHaveClass(/is-drop-before/u);
  await expect(targetRow.locator(".tag-drop-marker")).toBeVisible();
  await expect(page.locator('[data-category-id="hair-style"]')).not.toHaveClass(/is-tag-drop-target/u);
  await page.screenshot({ path: testInfo.outputPath("tag-drag-focus.png") });
  await page.mouse.up();

  await expect(page.locator(".success-toast")).toContainText("タグを移動しました");
  await expect(page.locator(".success-toast").getByRole("button", { name: "元に戻す" })).toBeVisible();
  await expect(page.locator(".tag-row.is-recently-moved")).toBeVisible();
});

test("edits the tag name and Japanese translation directly in the row", async ({ page }) => {
  await page.goto("/");
  await page.getByText("long_hair", { exact: true }).dblclick();

  const promptInput = page.getByRole("textbox", { name: "long_hairのタグ名" });
  const translationInput = page.getByRole("textbox", { name: "long_hairの日本語訳" });
  await expect(promptInput).toBeFocused();
  await promptInput.fill("long_hair_edited");
  await translationInput.fill("とても長い髪の日本語訳を折り返して表示");
  await page.screenshot({
    path: path.resolve("docs/implementation-inline-edit-1440x1024.png"),
    animations: "disabled",
  });
  await page.getByRole("button", { name: "long_hairの変更を保存" }).click();

  await expect(page.getByText("long_hair_edited", { exact: true })).toBeVisible();
  await expect(page.getByText("とても長い髪の日本語訳を折り返して表示", { exact: true })).toBeVisible();
  await expect(page.getByLabel("long_hair_edited：編集済み")).toBeVisible();
});

test("keeps insertion feedback while reduced motion removes the trail", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const source = page.getByRole("button", { name: "long_hairをドラッグ", exact: true });
  const targetRow = page.locator('[data-tag-id="tag:hair-style:5"]');
  const sourceBox = await source.boundingBox();
  const targetBox = await targetRow.boundingBox();
  if (!sourceBox || !targetBox) throw new Error("Tag drag controls are not visible");

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
    steps: 10,
  });
  const overlay = page.locator(".drag-overlay.tag");
  await expect(overlay).toBeVisible();
  expect(await overlay.evaluate((element) => getComputedStyle(element, "::before").display)).toBe("none");
  await expect(targetRow).toHaveClass(/is-drop-before/u);
  await page.mouse.up();
});

test("renders the actual source catalog without changing it", async ({ page }) => {
  const beforeHash = await sha256(realCatalogPath);
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(realCatalogPath);
  await expect(page.getByText("tag_catalog.json を読み込みました")).toBeVisible();
  await page.locator('[data-category-id="legacy_medium:02:wearables"]').click();
  await expect(page.getByRole("button", { name: "小分類を右へスクロール" })).toBeVisible();
  await expect(page.locator(".kanban-lane")).toHaveCount(23);
  const laneScroller = page.locator(".kanban-grid");
  await expect.poll(() => laneScroller.evaluate((element) => element.scrollLeft)).toBe(0);
  await page.getByRole("button", { name: "小分類を右へスクロール" }).click();
  await expect.poll(() => laneScroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await page.screenshot({
    path: path.resolve("docs/implementation-1440x1024.png"),
    animations: "disabled",
  });
  expect(await sha256(realCatalogPath)).toBe(beforeHash);
});

test("aligns the category drag preview with the pointer and shows an insertion line", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const source = page.getByRole("button", { name: "髪カテゴリをドラッグ", exact: true });
  const targetHandle = page.getByRole("button", { name: "身分カテゴリをドラッグ", exact: true });
  const sourceBox = await source.boundingBox();
  const targetBox = await targetHandle.boundingBox();
  if (!sourceBox || !targetBox) throw new Error("Category drag controls are not visible");

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(sourceBox.x + sourceBox.width / 2 - 8, sourceBox.y + sourceBox.height / 2, {
    steps: 3,
  });
  await expect(page.locator(".drag-overlay.category")).toBeVisible();
  const pointerX = targetBox.x + targetBox.width / 2;
  const pointerY = targetBox.y + targetBox.height / 2;
  await page.mouse.move(pointerX, pointerY, { steps: 8 });

  const overlay = page.locator(".drag-overlay.category");
  const overlayBox = await overlay.boundingBox();
  if (!overlayBox) throw new Error("Category drag preview is not visible");
  expect(Math.abs(overlayBox.x + overlayBox.width / 2 - pointerX)).toBeLessThan(4);
  expect(Math.abs(overlayBox.y + overlayBox.height / 2 - pointerY)).toBeLessThan(4);
  await expect(targetHandle.locator("xpath=ancestor::*[contains(@class, 'category-row')]")).toHaveClass(
    /is-drop-before/u,
  );
  await page.screenshot({ path: testInfo.outputPath("category-drag.png"), animations: "disabled" });
  await page.mouse.up();
  await expect(page.getByLabel("髪：変更済み")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("category-changed.png"), animations: "disabled" });
});
