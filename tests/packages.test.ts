import assert from "node:assert/strict";
import test from "node:test";
import { parseCatalogText } from "../src/domain/catalog.ts";
import { getWorkbenchMeta, itemOrigin, markLocal } from "../src/domain/lineage.ts";
import { deleteTags } from "../src/domain/operations.ts";
import { createSharePackage, parsePackageZip, packageToZip, previewImport, readZip } from "../src/domain/packages.ts";
import { parseTagSetText } from "../src/domain/tagSets.ts";

const catalogSource = JSON.stringify(
  {
    schema_version: 1,
    generated_at: "factory-v1",
    major_categories: [
      {
        id: "major",
        label_ja: "Major",
        medium_categories: [
          {
            id: "medium",
            label_ja: "Medium",
            small_categories: [
              {
                id: "small",
                label_ja: "Small",
                tags: [
                  { id: "A", name: "a" },
                  { id: "B", name: "b" },
                  { id: "C", name: "c" },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  null,
  2,
);

const tagSetSource = JSON.stringify(
  {
    schema_version: 1,
    major_categories: [
      {
        id: "ts-major",
        label_ja: "TS Major",
        medium_categories: [
          {
            id: "ts-medium",
            label_ja: "TS Medium",
            small_categories: [
              {
                id: "ts-small",
                label_ja: "TS Small",
                sets: [{ id: "set-a", name: "Set A", tags: ["a"] }],
              },
            ],
          },
        ],
      },
    ],
  },
  null,
  2,
);

test("share packages do not revive a default tag deleted by the importing user", () => {
  const baseline = parseCatalogText(catalogSource, "tag_catalog.json");
  const exporter = structuredClone(baseline);
  const tagB = exporter.tags.find((tag) => tag.sourceId === "B")!;
  tagB.translationJa = "changed by package";
  exporter.tags.push({
    uid: "tag:small:D",
    sourceId: "D",
    categoryId: "small",
    prompt: "d",
    translationJa: "",
    aliases: [],
    order: 3,
    raw: markLocal({ id: "D", name: "d" }),
  });

  const importingUser = deleteTags(
    baseline,
    baseline.tags.filter((tag) => tag.sourceId === "B").map((tag) => tag.uid),
  );
  const pkg = createSharePackage({
    packageName: "Shared",
    packageId: "pkg-1",
    packageVersion: 1,
    includeCatalog: true,
    includeTagSets: false,
    catalogBaseline: baseline,
    catalogDocument: exporter,
  });

  const preview = previewImport({ pkg, catalogDocument: importingUser });

  assert.deepEqual(preview.issues, []);
  assert.deepEqual(preview.nextCatalog?.tags.map((tag) => tag.prompt).sort(), ["a", "c", "d"]);
  assert.equal(preview.nextCatalog?.tags.some((tag) => tag.sourceId === "B"), false);
});

test("share packages allow importing only one included data type from a full package", () => {
  const catalog = parseCatalogText(catalogSource, "tag_catalog.json");
  const tagSets = parseTagSetText(tagSetSource, "tag_sets.json");
  const nextCatalog = structuredClone(catalog);
  nextCatalog.tags.push({
    uid: "tag:small:D",
    sourceId: "D",
    categoryId: "small",
    prompt: "d",
    translationJa: "",
    aliases: [],
    order: 3,
    raw: markLocal({ id: "D", name: "d" }),
  });
  const nextTagSets = structuredClone(tagSets);
  nextTagSets.majorCategories[0].mediumCategories[0].smallCategories[0].sets.push({
    id: "set-b",
    name: "Set B",
    nameJa: "Set B",
    nameEn: "",
    creator: "",
    sourceUrl: "",
    imageUrl: "",
    imagePath: "",
    tags: ["b"],
    raw: markLocal({ id: "set-b", name: "Set B", tags: ["b"] }),
  });

  const pkg = createSharePackage({
    packageName: "Full",
    packageId: "pkg-full",
    packageVersion: 2,
    includeCatalog: true,
    includeTagSets: true,
    catalogBaseline: catalog,
    catalogDocument: nextCatalog,
    tagSetBaseline: tagSets,
    tagSetDocument: nextTagSets,
  });
  const renamedZipPackage = parsePackageZip(packageToZip(pkg));
  const preview = previewImport({
    pkg: renamedZipPackage,
    catalogDocument: catalog,
    tagSetDocument: tagSets,
    selection: { catalog: false, tagsets: true },
  });

  assert.equal(preview.nextCatalog, undefined);
  assert.deepEqual(preview.nextTagSets?.majorCategories[0].mediumCategories[0].smallCategories[0].sets.map((item) => item.id), [
    "set-a",
    "set-b",
  ]);
});

test("share package zip includes tag set image assets", () => {
  const tagSets = parseTagSetText(tagSetSource, "tag_sets.json");
  const nextTagSets = structuredClone(tagSets);
  nextTagSets.majorCategories[0].mediumCategories[0].smallCategories[0].sets[0].imagePath =
    "/prompt-workbench-data/tag-set-images/set-a.webp";
  nextTagSets.majorCategories[0].mediumCategories[0].smallCategories[0].sets[0].imageUrl =
    "/prompt-workbench-data/tag-set-images/set-a.webp";
  nextTagSets.majorCategories[0].mediumCategories[0].smallCategories[0].sets[0].raw = markLocal(
    nextTagSets.majorCategories[0].mediumCategories[0].smallCategories[0].sets[0].raw,
  );
  const pkg = createSharePackage({
    packageName: "Images",
    packageId: "pkg-images",
    packageVersion: 1,
    includeCatalog: false,
    includeTagSets: true,
    tagSetBaseline: tagSets,
    tagSetDocument: nextTagSets,
  });
  pkg.imageAssets = [
    {
      tagSetId: "set-a",
      fileName: "set-a.webp",
      path: "/prompt-workbench-data/tag-set-images/set-a.webp",
      zipPath: "assets/tag-set-images/set-a.webp",
      contentType: "image/webp",
      bytes: new Uint8Array([1, 2, 3]),
    },
  ];

  const files = readZip(packageToZip(pkg));
  const parsed = parsePackageZip(packageToZip(pkg));

  assert.deepEqual([...files["assets/tag-set-images/set-a.webp"]], [1, 2, 3]);
  assert.equal(parsed.manifest.assets?.tagset_images?.[0].tagset_id, "set-a");
  assert.equal(parsed.imageAssets?.[0].zipPath, "assets/tag-set-images/set-a.webp");
});

test("share package manifest keeps an importer note", () => {
  const baseline = parseCatalogText(catalogSource, "tag_catalog.json");
  const exporter = structuredClone(baseline);
  exporter.tags[0].translationJa = "package note test";
  exporter.tags[0].raw = markLocal(exporter.tags[0].raw);
  const pkg = createSharePackage({
    packageName: "Notes",
    packageId: "pkg-notes",
    packageVersion: 1,
    packageNote: "モデルA向けです。\n既存の服装タグと一緒に使ってください。",
    includeCatalog: true,
    includeTagSets: false,
    catalogBaseline: baseline,
    catalogDocument: exporter,
  });

  const parsed = parsePackageZip(packageToZip(pkg));

  assert.equal(parsed.manifest.note, "モデルA向けです。\n既存の服装タグと一緒に使ってください。");
});

test("share package import rejects unsafe image asset paths", () => {
  const tagSets = parseTagSetText(tagSetSource, "tag_sets.json");
  const pkg = createSharePackage({
    packageName: "BadImages",
    packageId: "pkg-bad-images",
    packageVersion: 1,
    includeCatalog: false,
    includeTagSets: true,
    tagSetBaseline: tagSets,
    tagSetDocument: structuredClone(tagSets),
  });
  pkg.manifest.assets = {
    tagset_images: [
      {
        tagset_id: "set-a",
        file_name: "set-a.webp",
        path: "/prompt-workbench-data/tag-set-images/set-a.webp",
        zip_path: "assets/../set-a.webp",
        content_type: "image/webp",
        size: 3,
      },
    ],
  };

  assert.throws(() => parsePackageZip(packageToZip(pkg)));
});

test("share package export excludes delete operations", () => {
  const baseline = parseCatalogText(catalogSource, "tag_catalog.json");
  const exporter = deleteTags(
    baseline,
    baseline.tags.filter((tag) => tag.sourceId === "B").map((tag) => tag.uid),
  );

  const pkg = createSharePackage({
    packageName: "NoDeletes",
    packageId: "pkg-no-deletes",
    packageVersion: 1,
    includeCatalog: true,
    includeTagSets: false,
    catalogBaseline: baseline,
    catalogDocument: exporter,
  });

  assert.deepEqual(pkg.catalogPatch?.operations.map((operation) => operation.type), []);
  assert.equal(pkg.changesCsv.includes("削除"), false);
});

test("share package export excludes deleted categories and tag sets", () => {
  const catalog = parseCatalogText(catalogSource, "tag_catalog.json");
  const tagSets = parseTagSetText(tagSetSource, "tag_sets.json");
  const catalogWithDeletedCategory = structuredClone(catalog);
  catalogWithDeletedCategory.categories = catalogWithDeletedCategory.categories.filter((category) => category.id !== "small");
  catalogWithDeletedCategory.tags = catalogWithDeletedCategory.tags.filter((tag) => tag.categoryId !== "small");
  const tagSetsWithDeletedSet = structuredClone(tagSets);
  tagSetsWithDeletedSet.majorCategories[0].mediumCategories[0].smallCategories[0].sets = [];

  const pkg = createSharePackage({
    packageName: "NoDeletedItems",
    packageId: "pkg-no-deleted-items",
    packageVersion: 1,
    includeCatalog: true,
    includeTagSets: true,
    catalogBaseline: catalog,
    catalogDocument: catalogWithDeletedCategory,
    tagSetBaseline: tagSets,
    tagSetDocument: tagSetsWithDeletedSet,
  });
  const operationTypes = [...(pkg.catalogPatch?.operations ?? []), ...(pkg.tagsetPatch?.operations ?? [])].map(
    (operation) => operation.type,
  );

  assert.equal(operationTypes.some((type) => type.startsWith("delete_")), false);
  assert.equal(pkg.changesCsv.includes("small"), false);
  assert.equal(pkg.changesCsv.includes("set-a"), false);
});

test("share package export defaults to local-only catalog operations", () => {
  const baseline = parseCatalogText(catalogSource, "tag_catalog.json");
  const exporter = structuredClone(baseline);
  const localCategory = exporter.categories.find((category) => category.id === "medium")!;
  localCategory.labelJa = "Local Medium";
  localCategory.raw = markLocal(localCategory.raw);
  const defaultCategory = exporter.categories.find((category) => category.id === "small")!;
  defaultCategory.labelJa = "Default Small Changed";
  const importedCategory = { ...defaultCategory, id: "imported-small", labelJa: "Imported Small", raw: { id: "imported-small", prompt_workbench_meta: { origin: "imported" } } };
  exporter.categories.push(importedCategory);
  const localTag = exporter.tags.find((tag) => tag.sourceId === "A")!;
  localTag.translationJa = "local tag";
  localTag.raw = markLocal(localTag.raw);
  const defaultTag = exporter.tags.find((tag) => tag.sourceId === "B")!;
  defaultTag.translationJa = "default tag";
  const importedTag = exporter.tags.find((tag) => tag.sourceId === "C")!;
  importedTag.translationJa = "imported tag";
  importedTag.raw = { ...importedTag.raw, prompt_workbench_meta: { origin: "imported" } };
  exporter.tags.push({
    uid: "tag:imported-small:D",
    sourceId: "D",
    categoryId: "imported-small",
    prompt: "d",
    translationJa: "",
    aliases: [],
    order: 0,
    raw: markLocal({ id: "D", name: "d" }),
  });

  const pkg = createSharePackage({
    packageName: "LocalCatalog",
    packageId: "pkg-local-catalog",
    packageVersion: 1,
    includeCatalog: true,
    includeTagSets: false,
    catalogBaseline: baseline,
    catalogDocument: exporter,
  });
  const operations = pkg.catalogPatch?.operations ?? [];

  assert.deepEqual(operations.map((operation) => `${operation.type}:${operation.target_id}`).sort(), [
    "update_category:medium",
    "update_tag:A",
  ]);
  assert.equal(pkg.exportSummary?.excludedCatalog, 5);
});

test("share package export defaults to local-only tag set operations and skips imported category paths", () => {
  const baseline = parseTagSetText(tagSetSource, "tag_sets.json");
  const exporter = structuredClone(baseline);
  const medium = exporter.majorCategories[0].mediumCategories[0];
  const defaultSmall = medium.smallCategories[0];
  defaultSmall.labelJa = "Default TS Small Changed";
  defaultSmall.sets[0].tags = ["default set change"];
  const localSmall = {
    ...structuredClone(defaultSmall),
    id: "ts-local-small",
    labelJa: "TS Local Small",
    raw: markLocal({ id: "ts-local-small", label_ja: "TS Local Small" }),
    sets: [
      {
        id: "set-local",
        name: "Set Local",
        nameJa: "Set Local",
        nameEn: "",
        creator: "",
        sourceUrl: "",
        imageUrl: "",
        imagePath: "",
        tags: ["local"],
        raw: markLocal({ id: "set-local", name: "Set Local", tags: ["local"] }),
      },
    ],
  };
  const importedSmall = {
    ...structuredClone(defaultSmall),
    id: "ts-imported-small",
    labelJa: "TS Imported Small",
    raw: { id: "ts-imported-small", label_ja: "TS Imported Small", prompt_workbench_meta: { origin: "imported" } },
    sets: [
      {
        id: "set-local-under-imported",
        name: "Set Local Under Imported",
        nameJa: "Set Local Under Imported",
        nameEn: "",
        creator: "",
        sourceUrl: "",
        imageUrl: "",
        imagePath: "",
        tags: ["local"],
        raw: markLocal({ id: "set-local-under-imported", name: "Set Local Under Imported", tags: ["local"] }),
      },
      {
        id: "set-imported",
        name: "Set Imported",
        nameJa: "Set Imported",
        nameEn: "",
        creator: "",
        sourceUrl: "",
        imageUrl: "",
        imagePath: "",
        tags: ["imported"],
        raw: { id: "set-imported", name: "Set Imported", tags: ["imported"], prompt_workbench_meta: { origin: "imported" } },
      },
    ],
  };
  medium.smallCategories.push(localSmall, importedSmall);

  const pkg = createSharePackage({
    packageName: "LocalTagSets",
    packageId: "pkg-local-tagsets",
    packageVersion: 1,
    includeCatalog: false,
    includeTagSets: true,
    tagSetBaseline: baseline,
    tagSetDocument: exporter,
  });
  const operations = pkg.tagsetPatch?.operations ?? [];

  assert.deepEqual(operations.map((operation) => `${operation.type}:${operation.target_id}`).sort(), [
    "add_tagset:set-local",
    "add_tagset_category:small:ts-local-small",
  ]);
  assert.equal(pkg.exportSummary?.excludedTagSets, 5);
});

test("share package changes CSV has a Japanese header and UTF-8 BOM", () => {
  const catalog = parseCatalogText(catalogSource, "tag_catalog.json");
  const nextCatalog = structuredClone(catalog);
  nextCatalog.tags.push({
    uid: "tag:small:D",
    sourceId: "D",
    categoryId: "small",
    prompt: "d",
    translationJa: "",
    aliases: [],
    order: 3,
    raw: markLocal({ id: "D", name: "d" }),
  });

  const pkg = createSharePackage({
    packageName: "Csv",
    packageId: "pkg-csv",
    packageVersion: 1,
    includeCatalog: true,
    includeTagSets: false,
    catalogBaseline: catalog,
    catalogDocument: nextCatalog,
  });

  assert.equal(pkg.changesCsv.charCodeAt(0), 0xfeff);
  assert.equal(pkg.changesCsv.startsWith("\uFEFF\"変更種別\",\"データ種別\",\"ID\""), true);
});

test("share package import can skip conflicting operations", () => {
  const baseline = parseCatalogText(catalogSource, "tag_catalog.json");
  const exporter = structuredClone(baseline);
  const packageTagA = exporter.tags.find((tag) => tag.sourceId === "A")!;
  packageTagA.translationJa = "package change";
  packageTagA.raw = markLocal(packageTagA.raw);
  exporter.tags.push({
    uid: "tag:small:D",
    sourceId: "D",
    categoryId: "small",
    prompt: "d",
    translationJa: "",
    aliases: [],
    order: 3,
    raw: markLocal({ id: "D", name: "d" }),
  });

  const importer = structuredClone(baseline);
  const localTagA = importer.tags.find((tag) => tag.sourceId === "A")!;
  localTagA.translationJa = "local change";

  const pkg = createSharePackage({
    packageName: "Conflict",
    packageId: "pkg-conflict",
    packageVersion: 1,
    includeCatalog: true,
    includeTagSets: false,
    catalogBaseline: baseline,
    catalogDocument: exporter,
  });
  const preview = previewImport({ pkg, catalogDocument: importer, conflictResolution: "skip" });

  assert.equal(preview.conflicts.length, 1);
  assert.equal(preview.nextCatalog?.tags.find((tag) => tag.sourceId === "A")?.translationJa, "local change");
  assert.equal(preview.nextCatalog?.tags.some((tag) => tag.sourceId === "D"), true);
});

test("catalog import preserves explicit default origin but keeps ordinary imports marked imported", () => {
  const baseline = parseCatalogText(catalogSource, "tag_catalog.json");
  const pkg = parsePackageZip(packageToZip({
    manifest: {
      format_version: 1,
      package_id: "pkg-catalog-origin",
      package_name: "CatalogOrigin",
      package_version: 3,
      contains: { catalog: true, tagsets: false },
      created_at: "2026-08-25T00:00:00.000Z",
    },
    catalogPatch: {
      operations: [
        {
          type: "add_tag",
          target_type: "tag",
          target_id: "D",
          tag: {
            uid: "tag:small:D",
            sourceId: "D",
            categoryId: "small",
            prompt: "d",
            translationJa: "",
            aliases: [],
            order: 3,
            raw: { id: "D", name: "d", prompt_workbench_meta: { origin: "default" } },
          },
        },
        {
          type: "add_tag",
          target_type: "tag",
          target_id: "E",
          tag: {
            uid: "tag:small:E",
            sourceId: "E",
            categoryId: "small",
            prompt: "e",
            translationJa: "",
            aliases: [],
            order: 4,
            raw: { id: "E", name: "e" },
          },
        },
      ],
    },
    imageAssets: [],
    changesCsv: "",
  }));
  const preview = previewImport({ pkg, catalogDocument: baseline, selection: { catalog: true, tagsets: false } });
  const importedTags = new Map(preview.nextCatalog?.tags.map((item) => [item.prompt, item]) ?? []);

  assert.equal(itemOrigin(importedTags.get("d")!.raw), "default");
  assert.equal(importedTags.get("d")!.raw.prompt_workbench_meta?.package_id, "pkg-catalog-origin");
  assert.equal(importedTags.get("d")!.raw.prompt_workbench_meta?.package_version, 3);
  assert.equal(itemOrigin(importedTags.get("e")!.raw), "imported");
});

test("tag set import preserves only explicit default origin while recording package metadata", () => {
  const baseline = parseTagSetText(tagSetSource, "tag_sets.json");
  const origins = [
    ["set-default", "default"],
    ["set-unset", undefined],
    ["set-local", "local"],
    ["set-imported", "imported"],
    ["set-invalid", "custom"],
  ] as const;
  const pkg = parsePackageZip(packageToZip({
    manifest: {
      format_version: 1,
      package_id: "pkg-origin",
      package_name: "Origin",
      package_version: 7,
      contains: { catalog: false, tagsets: true },
      created_at: "2026-08-25T00:00:00.000Z",
    },
    tagsetPatch: {
      operations: origins.map(([id, origin], order) => ({
        type: "add_tagset",
        target_type: "tagset",
        target_id: id,
        tagset: {
          id,
          smallId: "ts-small",
          order: order + 1,
          name: id,
          nameJa: id,
          nameEn: "",
          creator: "",
          sourceUrl: "",
          imageUrl: "",
          imagePath: "",
          tags: [id],
          raw: {
            id,
            name: id,
            tags: [id],
            ...(origin ? { prompt_workbench_meta: { origin } } : {}),
          },
        },
      })),
    },
    imageAssets: [],
    changesCsv: "",
  }));
  const preview = previewImport({
    pkg,
    tagSetDocument: baseline,
    selection: { catalog: false, tagsets: true },
  });
  const importedSets = new Map(
    preview.nextTagSets?.majorCategories[0].mediumCategories[0].smallCategories[0].sets.map((item) => [item.id, item]) ?? [],
  );

  assert.equal(itemOrigin(importedSets.get("set-default")!.raw), "default");
  assert.equal(itemOrigin(importedSets.get("set-unset")!.raw), "imported");
  assert.equal(itemOrigin(importedSets.get("set-local")!.raw), "imported");
  assert.equal(itemOrigin(importedSets.get("set-imported")!.raw), "imported");
  assert.equal(itemOrigin(importedSets.get("set-invalid")!.raw), "imported");
  assert.equal(importedSets.get("set-default")!.raw.prompt_workbench_meta?.package_id, "pkg-origin");
  assert.equal(importedSets.get("set-default")!.raw.prompt_workbench_meta?.package_version, 7);
});

test("developer import mode treats catalog payloads as default without import history", () => {
  const baseline = parseCatalogText(catalogSource, "tag_catalog.json");
  const pkg = parsePackageZip(packageToZip({
    manifest: {
      format_version: 1,
      package_id: "pkg-catalog-dev-default",
      package_name: "CatalogDevDefault",
      package_version: 1,
      contains: { catalog: true, tagsets: false },
      created_at: "2026-08-25T00:00:00.000Z",
    },
    catalogPatch: {
      operations: [
        {
          type: "add_tag",
          target_type: "tag",
          target_id: "D",
          tag: {
            uid: "tag:small:D",
            sourceId: "D",
            categoryId: "small",
            prompt: "d",
            translationJa: "",
            aliases: [],
            order: 3,
            raw: {
              id: "D",
              name: "d",
              prompt_workbench_meta: { origin: "imported", package_id: "old", package_version: 99 },
            },
          },
        },
      ],
    },
    imageAssets: [],
    changesCsv: "",
  }));
  const preview = previewImport({
    pkg,
    catalogDocument: baseline,
    selection: { catalog: true, tagsets: false },
    importAsDefault: true,
  });
  const imported = preview.nextCatalog!.tags.find((item) => item.prompt === "d")!;

  assert.equal(itemOrigin(imported.raw), "default");
  assert.equal(imported.raw.prompt_workbench_meta?.package_id, undefined);
  assert.deepEqual(getWorkbenchMeta(preview.nextCatalog!.original).imports, {});
});

test("developer import mode treats tag set payloads as default without import history", () => {
  const baseline = parseTagSetText(tagSetSource, "tag_sets.json");
  const pkg = parsePackageZip(packageToZip({
    manifest: {
      format_version: 1,
      package_id: "pkg-tagset-dev-default",
      package_name: "TagSetDevDefault",
      package_version: 1,
      contains: { catalog: false, tagsets: true },
      created_at: "2026-08-25T00:00:00.000Z",
    },
    tagsetPatch: {
      operations: [
        {
          type: "add_tagset",
          target_type: "tagset",
          target_id: "set-dev-default",
          tagset: {
            id: "set-dev-default",
            smallId: "ts-small",
            order: 1,
            name: "set-dev-default",
            nameJa: "set-dev-default",
            nameEn: "",
            creator: "",
            sourceUrl: "",
            imageUrl: "",
            imagePath: "",
            tags: ["dev"],
            raw: {
              id: "set-dev-default",
              name: "set-dev-default",
              tags: ["dev"],
              prompt_workbench_meta: { origin: "local", package_id: "old", package_version: 99 },
            },
          },
        },
      ],
    },
    imageAssets: [],
    changesCsv: "",
  }));
  const preview = previewImport({
    pkg,
    tagSetDocument: baseline,
    selection: { catalog: false, tagsets: true },
    importAsDefault: true,
  });
  const imported = preview.nextTagSets!.majorCategories[0].mediumCategories[0].smallCategories[0].sets.find(
    (item) => item.id === "set-dev-default",
  )!;

  assert.equal(itemOrigin(imported.raw), "default");
  assert.equal(imported.raw.prompt_workbench_meta?.package_id, undefined);
  assert.deepEqual(getWorkbenchMeta(preview.nextTagSets!.original).imports, {});
});

test("tag set import conflicts show category path instead of internal ids", () => {
  const baseline = parseTagSetText(tagSetSource, "tag_sets.json");
  const baseMajor = baseline.majorCategories[0];
  const baseMedium = baseMajor.mediumCategories[0];
  const baseSmall = baseMedium.smallCategories[0];
  const baseSet = baseSmall.sets[0];
  baseMajor.labelJa = "人物";
  baseMedium.labelJa = "人数";
  baseSmall.labelJa = "ソロ";
  baseSet.id = "tagset_major:people:medium:2:small:1:set:1";
  baseSet.nameJa = "一人の人物";
  baseSet.name = "one person";
  const exporter = structuredClone(baseline);
  exporter.majorCategories[0].mediumCategories[0].smallCategories[0].sets[0].tags = ["package change"];
  exporter.majorCategories[0].mediumCategories[0].smallCategories[0].sets[0].raw = markLocal(
    exporter.majorCategories[0].mediumCategories[0].smallCategories[0].sets[0].raw,
  );
  const importer = structuredClone(baseline);
  importer.majorCategories[0].mediumCategories[0].smallCategories[0].sets[0].tags = ["local change"];

  const pkg = createSharePackage({
    packageName: "TagSetConflict",
    packageId: "pkg-tagset-conflict",
    packageVersion: 1,
    includeCatalog: false,
    includeTagSets: true,
    tagSetBaseline: baseline,
    tagSetDocument: exporter,
  });
  const preview = previewImport({
    pkg,
    tagSetDocument: importer,
    selection: { catalog: false, tagsets: true },
  });

  assert.equal(preview.conflicts.length, 1);
  assert.match(preview.conflicts[0], /タグセット「一人の人物」/u);
  assert.match(preview.conflicts[0], /大分類: 人物 › 中分類: 人数 › 小分類: ソロ/u);
  assert.equal(preview.conflicts[0].includes("tagset_major:people:medium:2:small:1:set:1"), false);
});

test("share package import keeps local default tombstones when a package adds new default-era data", () => {
  const oldDefault = parseCatalogText(catalogSource, "tag_catalog.json");
  const newDefault = structuredClone(oldDefault);
  newDefault.tags.push({
    uid: "tag:small:D",
    sourceId: "D",
    categoryId: "small",
    prompt: "d",
    translationJa: "",
    aliases: [],
    order: 3,
    raw: markLocal({ id: "D", name: "d" }),
  });
  const importingUser = deleteTags(
    oldDefault,
    oldDefault.tags.filter((tag) => tag.sourceId === "B").map((tag) => tag.uid),
  );
  const pkg = createSharePackage({
    packageName: "DefaultUpdate",
    packageId: "pkg-default-update",
    packageVersion: 1,
    includeCatalog: true,
    includeTagSets: false,
    catalogBaseline: oldDefault,
    catalogDocument: newDefault,
  });

  const preview = previewImport({ pkg, catalogDocument: importingUser });

  assert.deepEqual(preview.nextCatalog?.tags.map((tag) => tag.prompt).sort(), ["a", "c", "d"]);
  assert.equal(preview.nextCatalog?.tags.some((tag) => tag.sourceId === "B"), false);
});
