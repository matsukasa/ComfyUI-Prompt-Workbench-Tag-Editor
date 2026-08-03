import type {
  CatalogDocument,
  CategoryLevel,
  CategoryNode,
  ChangeSummary,
  FormatMetadata,
  JsonObject,
  JsonValue,
  TagOccurrence,
  ValidationIssue,
} from "./types";

const encoder = new TextEncoder();

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asArray(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

function text(value: JsonValue | undefined): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: JsonValue | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function detectFormatMetadata(source: string): FormatMetadata {
  const content = source.startsWith("\uFEFF") ? source.slice(1) : source;
  const indentMatch = content.match(/\n( +)\S/u);
  return {
    bom: source.startsWith("\uFEFF"),
    newline: content.includes("\r\n") ? "\r\n" : "\n",
    indent: indentMatch ? Math.min(indentMatch[1].length, 8) : 2,
    finalNewline: /(?:\r?\n)$/u.test(content),
  };
}

function uniqueUid(base: string, used: Set<string>): string {
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${base}:${suffix++}`;
  used.add(candidate);
  return candidate;
}

function parseBundled(root: JsonObject, fileName: string, formatMeta: FormatMetadata): CatalogDocument {
  const categories: CategoryNode[] = [];
  const tags: TagOccurrence[] = [];
  const usedUids = new Set<string>();
  let categoryOrder = 0;

  for (const majorValue of asArray(root.major_categories)) {
    if (!isObject(majorValue)) continue;
    const majorId = text(majorValue.id);
    if (!majorId) continue;
    categories.push({
      id: majorId,
      level: "major",
      parentId: "",
      labelJa: text(majorValue.label_ja) || majorId,
      labelEn: text(majorValue.label_en),
      descriptionJa: text(majorValue.description_ja),
      order: categoryOrder++,
      raw: clone(majorValue),
    });
    for (const mediumValue of asArray(majorValue.medium_categories)) {
      if (!isObject(mediumValue)) continue;
      const mediumId = text(mediumValue.id);
      if (!mediumId) continue;
      categories.push({
        id: mediumId,
        level: "medium",
        parentId: majorId,
        labelJa: text(mediumValue.label_ja) || mediumId,
        labelEn: text(mediumValue.label_en),
        descriptionJa: text(mediumValue.description_ja),
        order: categoryOrder++,
        raw: clone(mediumValue),
      });
      for (const smallValue of asArray(mediumValue.small_categories)) {
        if (!isObject(smallValue)) continue;
        const smallId = text(smallValue.id);
        if (!smallId) continue;
        categories.push({
          id: smallId,
          level: "small",
          parentId: mediumId,
          labelJa: text(smallValue.label_ja) || smallId,
          labelEn: text(smallValue.label_en),
          descriptionJa: text(smallValue.description_ja),
          order: categoryOrder++,
          raw: clone(smallValue),
        });
        let tagOrder = 0;
        for (const tagValue of asArray(smallValue.tags)) {
          if (!isObject(tagValue)) continue;
          const prompt = text(tagValue.name);
          if (!prompt) continue;
          const sourceId = tagValue.id;
          const uid = uniqueUid(`tag:${smallId}:${String(sourceId ?? prompt)}`, usedUids);
          tags.push({
            uid,
            sourceId,
            categoryId: smallId,
            prompt,
            translationJa: text(tagValue.translation_ja),
            aliases: asArray(tagValue.aliases).filter((item): item is string => typeof item === "string"),
            postCount: numberValue(tagValue.post_count),
            order: tagOrder++,
            raw: clone(tagValue),
          });
        }
      }
    }
  }
  if (!categories.length) throw new Error("major_categories に有効なカテゴリがありません。");
  return { fileName, format: "bundled", formatMeta, original: clone(root), categories, tags };
}

function storedLevel(value: JsonValue | undefined): CategoryLevel {
  return value === "major" || value === "medium" || value === "small" ? value : "small";
}

function parseStored(root: JsonObject, fileName: string, formatMeta: FormatMetadata): CatalogDocument {
  const categories: CategoryNode[] = [];
  for (const [order, value] of asArray(root.categories).entries()) {
    if (!isObject(value)) continue;
    const id = text(value.id);
    if (!id) continue;
    categories.push({
      id,
      level: storedLevel(value.level),
      parentId: text(value.parentId),
      labelJa: text(value.ja) || id,
      labelEn: text(value.en),
      descriptionJa: text(value.descriptionJa),
      order,
      raw: clone(value),
    });
  }
  const usedUids = new Set<string>();
  const tags: TagOccurrence[] = [];
  for (const [index, value] of asArray(root.tags).entries()) {
    if (!isObject(value)) continue;
    const prompt = text(value.prompt);
    if (!prompt) continue;
    const categoryId = text(value.categoryId);
    const sourceId = value.id;
    const uid = uniqueUid(`tag:${categoryId}:${String(sourceId ?? prompt)}:${index}`, usedUids);
    tags.push({
      uid,
      sourceId,
      categoryId,
      prompt,
      translationJa: text(value.ja),
      aliases: asArray(value.aliases).filter((item): item is string => typeof item === "string"),
      postCount: numberValue(value.postCount),
      order: numberValue(value.order) ?? index,
      raw: clone(value),
    });
  }
  if (!categories.length) throw new Error("categories に有効なカテゴリがありません。");
  return { fileName, format: "stored", formatMeta, original: clone(root), categories, tags };
}

export function parseCatalogText(source: string, fileName = "catalog.json"): CatalogDocument {
  const formatMeta = detectFormatMetadata(source);
  const clean = source.startsWith("\uFEFF") ? source.slice(1) : source;
  let value: unknown;
  try {
    value = JSON.parse(clean);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "不明な構文エラー";
    throw new Error(`JSONを解析できません。${detail}。末尾のカンマや引用符を確認してください。`, {
      cause: error,
    });
  }
  if (!isObject(value)) throw new Error("ルート要素はJSONオブジェクトである必要があります。");
  if (value.schema === "prompt-workbench/tag-catalog" && value.version === 1) {
    return parseStored(value, fileName, formatMeta);
  }
  if (typeof value.schema_version === "number" && Array.isArray(value.major_categories)) {
    return parseBundled(value, fileName, formatMeta);
  }
  throw new Error("対応していない形式です。Prompt Workbenchの同梱またはユーザーカタログを選んでください。");
}

export async function parseCatalogFile(file: File): Promise<CatalogDocument> {
  if (!file.name.toLowerCase().endsWith(".json")) throw new Error("対応形式はJSON（.json）のみです。");
  if (file.size > 8 * 1024 * 1024) throw new Error("ファイルが8MBを超えています。");
  const bytes = await file.arrayBuffer();
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return parseCatalogText(source, file.name);
}

function updateBundledCategory(category: CategoryNode, children: JsonObject[] | undefined): JsonObject {
  const output = clone(category.raw);
  output.id = category.id;
  output.label_ja = category.labelJa;
  if (category.labelEn || "label_en" in output) output.label_en = category.labelEn;
  if (category.descriptionJa || "description_ja" in output) output.description_ja = category.descriptionJa;
  if (category.level === "major") output.medium_categories = children ?? [];
  if (category.level === "medium") output.small_categories = children ?? [];
  return output;
}

function bundledTag(tag: TagOccurrence): JsonObject {
  const output = clone(tag.raw);
  if (tag.sourceId !== undefined) output.id = tag.sourceId;
  output.name = tag.prompt;
  if (tag.translationJa || "translation_ja" in output) output.translation_ja = tag.translationJa;
  if (tag.aliases.length || "aliases" in output) output.aliases = [...tag.aliases];
  if (tag.postCount !== undefined || "post_count" in output) output.post_count = tag.postCount ?? 0;
  return output;
}

function serializeBundled(document: CatalogDocument): JsonObject {
  const root = clone(document.original);
  const sorted = [...document.categories].sort((a, b) => a.order - b.order);
  const tagsByCategory = new Map<string, TagOccurrence[]>();
  for (const tag of document.tags) {
    const list = tagsByCategory.get(tag.categoryId) ?? [];
    list.push(tag);
    tagsByCategory.set(tag.categoryId, list);
  }
  const smallObjects = new Map<string, JsonObject>();
  for (const category of sorted.filter((item) => item.level === "small")) {
    const output = updateBundledCategory(category, undefined);
    output.tags = (tagsByCategory.get(category.id) ?? []).sort((a, b) => a.order - b.order).map(bundledTag);
    smallObjects.set(category.id, output);
  }
  const mediumObjects = new Map<string, JsonObject>();
  for (const category of sorted.filter((item) => item.level === "medium")) {
    const children = sorted
      .filter((item) => item.level === "small" && item.parentId === category.id)
      .map((item) => smallObjects.get(item.id)!)
      .filter(Boolean);
    mediumObjects.set(category.id, updateBundledCategory(category, children));
  }
  root.major_categories = sorted
    .filter((item) => item.level === "major")
    .map((category) => {
      const children = sorted
        .filter((item) => item.level === "medium" && item.parentId === category.id)
        .map((item) => mediumObjects.get(item.id)!)
        .filter(Boolean);
      return updateBundledCategory(category, children);
    });
  if (isObject(root.stats)) {
    root.stats.tags = document.tags.length;
    root.stats.major_categories = sorted.filter((item) => item.level === "major").length;
    root.stats.medium_categories = sorted.filter((item) => item.level === "medium").length;
    root.stats.small_categories = sorted.filter((item) => item.level === "small").length;
  }
  return root;
}

function serializeStored(document: CatalogDocument): JsonObject {
  const root = clone(document.original);
  root.schema = "prompt-workbench/tag-catalog";
  root.version = 1;
  root.categories = [...document.categories]
    .sort((a, b) => a.order - b.order)
    .map((category) => ({
      ...clone(category.raw),
      id: category.id,
      level: category.level,
      parentId: category.parentId,
      en: category.labelEn,
      ja: category.labelJa,
    }));
  root.tags = [...document.tags]
    .sort((a, b) => a.order - b.order)
    .map((tag) => ({
      ...clone(tag.raw),
      ...(tag.sourceId !== undefined ? { id: tag.sourceId } : {}),
      categoryId: tag.categoryId,
      prompt: tag.prompt,
      ja: tag.translationJa,
      order: tag.order,
    }));
  return root;
}

export function serializeCatalog(document: CatalogDocument): string {
  const data = document.format === "bundled" ? serializeBundled(document) : serializeStored(document);
  let output = JSON.stringify(data, null, document.formatMeta.indent);
  if (document.formatMeta.newline === "\r\n") output = output.replace(/\n/gu, "\r\n");
  if (document.formatMeta.finalNewline) output += document.formatMeta.newline;
  if (document.formatMeta.bom) output = `\uFEFF${output}`;
  return output;
}

export function validateCatalog(document: CatalogDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const categories = new Map(document.categories.map((item) => [item.id, item]));
  const ids = new Set<string>();
  for (const category of document.categories) {
    if (!category.id.trim())
      issues.push({ severity: "error", code: "empty-category-id", message: "空のカテゴリIDがあります。" });
    if (ids.has(category.id))
      issues.push({
        severity: "error",
        code: "duplicate-category-id",
        message: `カテゴリID ${category.id} が重複しています。`,
        targetId: category.id,
      });
    ids.add(category.id);
    if (category.level !== "major" && !categories.has(category.parentId)) {
      issues.push({
        severity: "error",
        code: "missing-parent",
        message: `${category.labelJa} の親カテゴリがありません。`,
        targetId: category.id,
      });
    }
  }
  const seen = new Map<string, number>();
  for (const tag of document.tags) {
    if (!tag.prompt.trim())
      issues.push({
        severity: "error",
        code: "empty-tag",
        message: "空文字タグがあります。",
        targetId: tag.uid,
      });
    const category = categories.get(tag.categoryId);
    if (!category || category.level !== "small")
      issues.push({
        severity: "error",
        code: "invalid-tag-category",
        message: `${tag.prompt} の所属先が小分類ではありません。`,
        targetId: tag.uid,
      });
    const key = tag.prompt.toLocaleLowerCase();
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [prompt, count] of seen) {
    if (count > 1)
      issues.push({
        severity: "warning",
        code: "duplicate-tag",
        message: `${prompt} が ${count} 件あります。`,
      });
  }
  return issues;
}

export function duplicateMap(tags: TagOccurrence[]): Map<string, TagOccurrence[]> {
  const result = new Map<string, TagOccurrence[]>();
  for (const tag of tags) {
    const key = tag.prompt.toLocaleLowerCase();
    const list = result.get(key) ?? [];
    list.push(tag);
    result.set(key, list);
  }
  for (const [key, value] of result) if (value.length < 2) result.delete(key);
  return result;
}

export function outputFileName(fileName: string, now = new Date()): string {
  const base = fileName.replace(/\.json$/iu, "") || "catalog";
  const part = (value: number) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}${part(now.getMonth() + 1)}${part(now.getDate())}_${part(now.getHours())}${part(now.getMinutes())}${part(now.getSeconds())}`;
  return `${base}_edited_${stamp}.json`;
}

export function exportBytes(document: CatalogDocument): Uint8Array {
  return encoder.encode(serializeCatalog(document));
}

export function summarizeChanges(before: CatalogDocument, after: CatalogDocument): ChangeSummary {
  const beforeTags = new Map(before.tags.map((tag) => [tag.uid, tag]));
  const afterTags = new Map(after.tags.map((tag) => [tag.uid, tag]));
  let movedTags = 0;
  let renamedTags = 0;
  for (const [uid, tag] of afterTags) {
    const previous = beforeTags.get(uid);
    if (!previous) continue;
    if (previous.categoryId !== tag.categoryId || previous.order !== tag.order) movedTags++;
    if (previous.prompt !== tag.prompt || previous.translationJa !== tag.translationJa) renamedTags++;
  }
  const beforeCategories = new Map(before.categories.map((item) => [item.id, item]));
  let changedCategories = Math.abs(before.categories.length - after.categories.length);
  for (const category of after.categories) {
    const previous = beforeCategories.get(category.id);
    if (
      previous &&
      (previous.parentId !== category.parentId ||
        previous.order !== category.order ||
        previous.labelJa !== category.labelJa ||
        previous.labelEn !== category.labelEn)
    )
      changedCategories++;
  }
  return {
    movedTags,
    addedTags: [...afterTags.keys()].filter((key) => !beforeTags.has(key)).length,
    deletedTags: [...beforeTags.keys()].filter((key) => !afterTags.has(key)).length,
    renamedTags,
    changedCategories,
    duplicateDelta: duplicateMap(after.tags).size - duplicateMap(before.tags).size,
  };
}

export function comparableCatalog(document: CatalogDocument): string {
  return JSON.stringify({ categories: document.categories, tags: document.tags }, (_key, value) =>
    _key === "raw" ? undefined : value,
  );
}
