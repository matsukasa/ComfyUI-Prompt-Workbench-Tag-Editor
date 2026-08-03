import { describe, expect, it } from "vitest";
import {
  isSafeOutputFileName,
  outputFileName,
  parseCatalogText,
  serializeCatalog,
  validateCatalog,
} from "../src/domain/catalog";
import {
  addCategory,
  addTags,
  changeCategoryLevel,
  deleteCategory,
  moveCategory,
  moveTags,
  renameCategory,
  renameTag,
} from "../src/domain/operations";

const bundled = `\uFEFF{\r\n  "schema_version": 1,\r\n  "unknown_root": {"keep": true},\r\n  "major_categories": [\r\n    {"id":"major-a","label_ja":"大A","extra":"major","medium_categories":[\r\n      {"id":"medium-a","label_ja":"中A","small_categories":[\r\n        {"id":"small-a","label_ja":"小A","extra_small":7,"tags":[\r\n          {"id":1,"name":"one","translation_ja":"一","custom":{"x":1}},\r\n          {"id":2,"name":"two","translation_ja":"二"},\r\n          {"id":3,"name":"same","translation_ja":"重複"}\r\n        ]},\r\n        {"id":"small-b","label_ja":"小B","tags":[{"id":4,"name":"three"},{"id":5,"name":"same"}]}\r\n      ]}\r\n    ]},\r\n    {"id":"major-b","label_ja":"大B","medium_categories":[{"id":"medium-b","label_ja":"中B","small_categories":[{"id":"small-c","label_ja":"小C","tags":[]}]}]}\r\n  ]\r\n}\r\n`;

describe("catalog parser and serializer", () => {
  it("reads the bundled hierarchy and preserves encoding style and unknown fields", () => {
    const document = parseCatalogText(bundled, "tags.json");
    expect(document.format).toBe("bundled");
    expect(document.formatMeta).toEqual({ bom: true, newline: "\r\n", indent: 2, finalNewline: true });
    expect(document.categories).toHaveLength(7);
    expect(document.tags).toHaveLength(5);
    const output = serializeCatalog(document);
    expect(output.startsWith("\uFEFF")).toBe(true);
    expect(output).toContain("\r\n");
    const raw = JSON.parse(output.slice(1));
    expect(raw.unknown_root).toEqual({ keep: true });
    expect(raw.major_categories[0].extra).toBe("major");
    expect(raw.major_categories[0].medium_categories[0].small_categories[0].extra_small).toBe(7);
    expect(raw.major_categories[0].medium_categories[0].small_categories[0].tags[0].custom).toEqual({ x: 1 });
  });

  it("round-trips the stored catalog without deleting metadata", () => {
    const stored = JSON.stringify(
      {
        schema: "prompt-workbench/tag-catalog",
        version: 1,
        metadata: { keep: true },
        categories: [
          { id: "major", level: "major", parentId: "", ja: "大" },
          { id: "medium", level: "medium", parentId: "major", ja: "中" },
          { id: "small", level: "small", parentId: "medium", ja: "小", extra: 1 },
        ],
        tags: [{ id: "t1", categoryId: "small", prompt: "tag", ja: "タグ", order: 0, extra: 2 }],
      },
      null,
      4,
    );
    const document = parseCatalogText(stored, "stored.json");
    const raw = JSON.parse(serializeCatalog(document));
    expect(raw.metadata.keep).toBe(true);
    expect(raw.categories[2].extra).toBe(1);
    expect(raw.tags[0].extra).toBe(2);
  });

  it("reports syntax and schema errors in Japanese", () => {
    expect(() => parseCatalogText("{broken")).toThrow(/JSONを解析できません/u);
    expect(() => parseCatalogText('{"hello":1}')).toThrow(/対応していない形式/u);
  });
});

describe("catalog operations", () => {
  it("moves multiple tags in stable category and row order", () => {
    const document = parseCatalogText(bundled);
    const one = document.tags.find((tag) => tag.prompt === "one")!;
    const two = document.tags.find((tag) => tag.prompt === "two")!;
    const moved = moveTags(document, [two.uid, one.uid], "small-b");
    expect(moved.tags.filter((tag) => tag.categoryId === "small-b").map((tag) => tag.prompt)).toEqual([
      "three",
      "same",
      "one",
      "two",
    ]);
  });

  it("reorders within a category at a precise insertion point", () => {
    const document = parseCatalogText(bundled);
    const two = document.tags.find((tag) => tag.prompt === "two")!;
    const one = document.tags.find((tag) => tag.prompt === "one")!;
    const moved = moveTags(document, [two.uid], "small-a", one.uid);
    expect(moved.tags.filter((tag) => tag.categoryId === "small-a").map((tag) => tag.prompt)).toEqual([
      "two",
      "one",
      "same",
    ]);
  });

  it("moves medium and small categories across parents and blocks invalid levels", () => {
    const document = parseCatalogText(bundled);
    const mediumMoved = moveCategory(document, "medium-a", "major-b");
    expect(mediumMoved.categories.find((item) => item.id === "medium-a")?.parentId).toBe("major-b");
    const smallMoved = moveCategory(document, "small-a", "medium-b");
    expect(smallMoved.categories.find((item) => item.id === "small-a")?.parentId).toBe("medium-b");
    expect(() => moveCategory(document, "major-a", "small-c")).toThrow(/大分類/u);
  });

  it("changes empty major and medium levels and blocks categories with children", () => {
    let document = parseCatalogText(bundled);
    document = addCategory(document, "major", "", "空の大分類");
    const emptyMajor = document.categories.find((item) => item.labelJa === "空の大分類")!;
    document = addCategory(document, "medium", "major-a", "空の中分類");
    const emptyMedium = document.categories.find((item) => item.labelJa === "空の中分類")!;

    const promoted = changeCategoryLevel(document, emptyMedium.id, "major");
    expect(promoted.categories.find((item) => item.id === emptyMedium.id)).toMatchObject({
      level: "major",
      parentId: "",
    });

    const demoted = changeCategoryLevel(document, emptyMajor.id, "medium", "major-a");
    expect(demoted.categories.find((item) => item.id === emptyMajor.id)).toMatchObject({
      level: "medium",
      parentId: "major-a",
    });

    expect(() => changeCategoryLevel(document, "medium-a", "major")).toThrow(/先に子分類/u);
    expect(() => changeCategoryLevel(document, "major-a", "medium", "major-b")).toThrow(/先に子分類/u);
  });

  it("demotes an empty major by dropping it on a medium category", () => {
    let document = parseCatalogText(bundled);
    document = addCategory(document, "major", "", "ドラッグ対象");
    const active = document.categories.find((item) => item.labelJa === "ドラッグ対象")!;
    const moved = moveCategory(document, active.id, "medium-a");
    expect(moved.categories.find((item) => item.id === active.id)).toMatchObject({
      level: "medium",
      parentId: "major-a",
    });
  });

  it("adds, renames and safely deletes categories and tags", () => {
    let document = parseCatalogText(bundled);
    document = addCategory(document, "small", "medium-b", "追加先");
    const addedCategory = document.categories.find((item) => item.labelJa === "追加先")!;
    document = addTags(document, addedCategory.id, [" alpha ", "beta"]);
    const alpha = document.tags.find((item) => item.prompt === "alpha")!;
    document = renameTag(document, alpha.uid, "alpha_edited", "アルファ");
    document = renameCategory(document, addedCategory.id, "変更先", "Changed");
    expect(document.tags.find((item) => item.uid === alpha.uid)?.prompt).toBe("alpha_edited");
    expect(() => deleteCategory(document, addedCategory.id)).toThrow(/移動先/u);
    document = deleteCategory(document, addedCategory.id, "small-c");
    expect(document.tags.find((item) => item.uid === alpha.uid)?.categoryId).toBe("small-c");
  });

  it("detects duplicate warnings and blocks invalid tag destinations", () => {
    const document = parseCatalogText(bundled);
    expect(validateCatalog(document).filter((issue) => issue.code === "duplicate-tag")).toHaveLength(1);
    expect(() => moveTags(document, [document.tags[0].uid], "medium-a")).toThrow(/小分類/u);
  });
});

it("creates a safe timestamped output name", () => {
  const output = outputFileName("tags.json", new Date(2026, 7, 3, 1, 30, 0));
  expect(output).toBe("tags_edited_20260803_013000.json");
  expect(isSafeOutputFileName("tags.json", output)).toBe(true);
  expect(isSafeOutputFileName("tag_catalog.json", "tag_catalog.json")).toBe(false);
  expect(isSafeOutputFileName("renamed.json", "tag_catalog.json")).toBe(false);
  expect(isSafeOutputFileName("tags.json", "tags.json")).toBe(false);
});
