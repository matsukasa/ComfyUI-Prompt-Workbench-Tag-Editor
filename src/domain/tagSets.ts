import type {
  ChangeSummary,
  FormatMetadata,
  JsonObject,
  JsonValue,
  TagSetDocument,
  TagSetItem,
  TagSetMajorCategory,
  TagSetMediumCategory,
  TagSetSmallCategory,
} from "./types";

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asArray(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

function text(value: JsonValue | undefined): string {
  return typeof value === "string" ? value : "";
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

function parseSet(value: JsonObject, fallbackId: string): TagSetItem {
  const id = text(value.id) || fallbackId;
  const nameJa = text(value.name_ja) || text(value.name) || id;
  return {
    id,
    name: text(value.name) || nameJa,
    nameJa,
    nameEn: text(value.name_en),
    creator: text(value.creator),
    sourceUrl: text(value.source_url),
    imageUrl: text(value.image_url),
    imagePath: text(value.image_path),
    tags: asArray(value.tags).filter((item): item is string => typeof item === "string"),
    raw: clone(value),
  };
}

export function isTagSetRoot(value: unknown): value is JsonObject {
  if (!isObject(value) || value.schema_version !== 1 || !Array.isArray(value.major_categories)) return false;
  return asArray(value.major_categories).some((major) =>
    isObject(major) &&
    asArray(major.medium_categories).some((medium) =>
      isObject(medium) &&
      asArray(medium.small_categories).some((small) => isObject(small) && Array.isArray(small.sets)),
    ),
  );
}

export function parseTagSetText(source: string, fileName = "tag_sets.json"): TagSetDocument {
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
  if (!isTagSetRoot(value)) throw new Error("タグセットJSONではありません。schema_version: 1 と major_categories が必要です。");
  const majorCategories: TagSetMajorCategory[] = [];
  for (const [majorIndex, majorValue] of asArray(value.major_categories).entries()) {
    if (!isObject(majorValue)) continue;
    const majorId = text(majorValue.id) || `tagset_major:${majorIndex}`;
    const mediumCategories: TagSetMediumCategory[] = [];
    for (const [mediumIndex, mediumValue] of asArray(majorValue.medium_categories).entries()) {
      if (!isObject(mediumValue)) continue;
      const mediumId = text(mediumValue.id) || `${majorId}:medium:${mediumIndex}`;
      const smallCategories: TagSetSmallCategory[] = [];
      for (const [smallIndex, smallValue] of asArray(mediumValue.small_categories).entries()) {
        if (!isObject(smallValue)) continue;
        const smallId = text(smallValue.id) || `${mediumId}:small:${smallIndex}`;
        smallCategories.push({
          id: smallId,
          labelJa: text(smallValue.label_ja) || text(smallValue.name_ja) || text(smallValue.name) || smallId,
          labelEn: text(smallValue.label_en),
          sets: asArray(smallValue.sets)
            .filter(isObject)
            .map((item, setIndex) => parseSet(item, `${smallId}:set:${setIndex}`)),
          raw: clone(smallValue),
        });
      }
      mediumCategories.push({
        id: mediumId,
        labelJa: text(mediumValue.label_ja) || text(mediumValue.name_ja) || text(mediumValue.name) || mediumId,
        labelEn: text(mediumValue.label_en),
        smallCategories,
        raw: clone(mediumValue),
      });
    }
    majorCategories.push({
      id: majorId,
      labelJa: text(majorValue.label_ja) || text(majorValue.name_ja) || text(majorValue.name) || majorId,
      labelEn: text(majorValue.label_en),
      mediumCategories,
      raw: clone(majorValue),
    });
  }
  if (!majorCategories.length) throw new Error("有効な大分類がありません。");
  return { fileName, formatMeta, original: clone(value), majorCategories };
}

export async function parseTagSetFile(file: File, filePath?: string): Promise<TagSetDocument> {
  if (!file.name.toLowerCase().endsWith(".json")) throw new Error("対応形式はJSON（.json）のみです。");
  if (file.size > 8 * 1024 * 1024) throw new Error("ファイルが8MBを超えています。");
  const bytes = await file.arrayBuffer();
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const document = parseTagSetText(source, file.name);
  return filePath ? { ...document, filePath } : document;
}

function serializeSet(item: TagSetItem): JsonObject {
  const output = clone(item.raw);
  output.id = item.id;
  output.name = item.name;
  if (item.nameJa || "name_ja" in output) output.name_ja = item.nameJa;
  if (item.nameEn || "name_en" in output) output.name_en = item.nameEn;
  if (item.creator || "creator" in output) output.creator = item.creator;
  if (item.sourceUrl || "source_url" in output) output.source_url = item.sourceUrl;
  if (item.imageUrl || "image_url" in output) output.image_url = item.imageUrl;
  if (item.imagePath || "image_path" in output) output.image_path = item.imagePath;
  output.tags = item.tags.filter((tag) => tag.trim());
  return output;
}

export function serializeTagSetDocument(document: TagSetDocument): string {
  const root = clone(document.original);
  root.schema_version = 1;
  root.major_categories = document.majorCategories.map((major) => ({
    ...clone(major.raw),
    id: major.id,
    label_ja: major.labelJa,
    ...(major.labelEn || "label_en" in major.raw ? { label_en: major.labelEn } : {}),
    medium_categories: major.mediumCategories.map((medium) => ({
      ...clone(medium.raw),
      id: medium.id,
      label_ja: medium.labelJa,
      ...(medium.labelEn || "label_en" in medium.raw ? { label_en: medium.labelEn } : {}),
      small_categories: medium.smallCategories.map((small) => ({
        ...clone(small.raw),
        id: small.id,
        label_ja: small.labelJa,
        ...(small.labelEn || "label_en" in small.raw ? { label_en: small.labelEn } : {}),
        sets: small.sets.map(serializeSet),
      })),
    })),
  }));
  let output = JSON.stringify(root, null, document.formatMeta.indent);
  if (document.formatMeta.newline === "\r\n") output = output.replace(/\n/gu, "\r\n");
  if (document.formatMeta.finalNewline) output += document.formatMeta.newline;
  if (document.formatMeta.bom) output = `\uFEFF${output}`;
  return output;
}

export function comparableTagSetDocument(document: TagSetDocument): string {
  return JSON.stringify(document.majorCategories);
}

export function tagSetCounts(document: TagSetDocument): { majors: number; mediums: number; smalls: number; sets: number } {
  let mediums = 0;
  let smalls = 0;
  let sets = 0;
  for (const major of document.majorCategories) {
    mediums += major.mediumCategories.length;
    for (const medium of major.mediumCategories) {
      smalls += medium.smallCategories.length;
      for (const small of medium.smallCategories) sets += small.sets.length;
    }
  }
  return { majors: document.majorCategories.length, mediums, smalls, sets };
}

interface ComparableCategory {
  id: string;
  path: string;
  order: number;
  labelJa: string;
  labelEn: string;
}

interface ComparableSet {
  id: string;
  smallId: string;
  order: number;
  name: string;
  nameJa: string;
  nameEn: string;
  creator: string;
  sourceUrl: string;
  imageUrl: string;
  imagePath: string;
  tags: string;
}

function comparableCategories(document: TagSetDocument): Map<string, ComparableCategory> {
  const categories = new Map<string, ComparableCategory>();
  document.majorCategories.forEach((major, majorIndex) => {
    categories.set(`major:${major.id}`, {
      id: major.id,
      path: "",
      order: majorIndex,
      labelJa: major.labelJa,
      labelEn: major.labelEn,
    });
    major.mediumCategories.forEach((medium, mediumIndex) => {
      categories.set(`medium:${medium.id}`, {
        id: medium.id,
        path: major.id,
        order: mediumIndex,
        labelJa: medium.labelJa,
        labelEn: medium.labelEn,
      });
      medium.smallCategories.forEach((small, smallIndex) => {
        categories.set(`small:${small.id}`, {
          id: small.id,
          path: `${major.id}/${medium.id}`,
          order: smallIndex,
          labelJa: small.labelJa,
          labelEn: small.labelEn,
        });
      });
    });
  });
  return categories;
}

function comparableSets(document: TagSetDocument): Map<string, ComparableSet> {
  const sets = new Map<string, ComparableSet>();
  for (const major of document.majorCategories) {
    for (const medium of major.mediumCategories) {
      for (const small of medium.smallCategories) {
        small.sets.forEach((setItem, order) => {
          sets.set(setItem.id, {
            id: setItem.id,
            smallId: small.id,
            order,
            name: setItem.name,
            nameJa: setItem.nameJa,
            nameEn: setItem.nameEn,
      creator: setItem.creator,
      sourceUrl: setItem.sourceUrl,
      imageUrl: setItem.imageUrl,
      imagePath: setItem.imagePath,
      tags: JSON.stringify(setItem.tags),
          });
        });
      }
    }
  }
  return sets;
}

export function summarizeTagSetChanges(before: TagSetDocument, after: TagSetDocument): ChangeSummary {
  const beforeSets = comparableSets(before);
  const afterSets = comparableSets(after);
  const beforeCategories = comparableCategories(before);
  const afterCategories = comparableCategories(after);
  let movedTags = 0;
  let addedTags = 0;
  let deletedTags = 0;
  let renamedTags = 0;
  let changedCategories = 0;

  for (const [id, setItem] of afterSets) {
    const previous = beforeSets.get(id);
    if (!previous) {
      addedTags++;
      continue;
    }
    if (previous.smallId !== setItem.smallId || previous.order !== setItem.order) movedTags++;
    if (
      previous.name !== setItem.name ||
      previous.nameJa !== setItem.nameJa ||
      previous.nameEn !== setItem.nameEn ||
      previous.creator !== setItem.creator ||
      previous.sourceUrl !== setItem.sourceUrl ||
      previous.imageUrl !== setItem.imageUrl ||
      previous.imagePath !== setItem.imagePath ||
      previous.tags !== setItem.tags
    )
      renamedTags++;
  }
  for (const id of beforeSets.keys()) {
    if (!afterSets.has(id)) deletedTags++;
  }
  for (const [id, category] of afterCategories) {
    const previous = beforeCategories.get(id);
    if (!previous) {
      changedCategories++;
      continue;
    }
    if (
      previous.path !== category.path ||
      previous.order !== category.order ||
      previous.labelJa !== category.labelJa ||
      previous.labelEn !== category.labelEn
    )
      changedCategories++;
  }
  for (const id of beforeCategories.keys()) {
    if (!afterCategories.has(id)) changedCategories++;
  }
  return { movedTags, addedTags, deletedTags, renamedTags, changedCategories, duplicateDelta: 0 };
}
