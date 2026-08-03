import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { parseCatalogText, serializeCatalog, validateCatalog } from "../src/domain/catalog";

it("round-trips the real Prompt Workbench bundled catalog", async () => {
  const sourcePath = path.resolve("..", "ComfyUI-Prompt-Workbench", "data", "tag_catalog.json");
  const source = await readFile(sourcePath, "utf8");
  const parsed = parseCatalogText(source, "tag_catalog.json");
  expect(parsed.categories.filter((item) => item.level === "major")).toHaveLength(10);
  expect(parsed.categories.filter((item) => item.level === "medium")).toHaveLength(34);
  expect(parsed.categories.filter((item) => item.level === "small")).toHaveLength(124);
  expect(parsed.tags).toHaveLength(3623);
  expect(validateCatalog(parsed).filter((issue) => issue.severity === "error")).toHaveLength(0);

  const reparsed = parseCatalogText(serializeCatalog(parsed), "tag_catalog_edited.json");
  expect(reparsed.categories.map((item) => item.id)).toEqual(parsed.categories.map((item) => item.id));
  expect(reparsed.tags.map((item) => [item.prompt, item.categoryId])).toEqual(
    parsed.tags.map((item) => [item.prompt, item.categoryId]),
  );
});
