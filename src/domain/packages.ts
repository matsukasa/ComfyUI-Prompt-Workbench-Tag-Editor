import { serializeCatalog } from "./catalog";
import { addImportHistory, getWorkbenchMeta, markImported, writeWorkbenchMeta } from "./lineage";
import { serializeTagSetDocument } from "./tagSets";
import type {
  CatalogDocument,
  CategoryNode,
  ChangeSummary,
  JsonObject,
  JsonValue,
  TagOccurrence,
  TagSetDocument,
  TagSetItem,
  TagSetMajorCategory,
  TagSetMediumCategory,
  TagSetSmallCategory,
} from "./types";

export type PackageContentType = "Catalog" | "TagSets" | "Full";

export interface SharePackageManifest {
  format_version: 1;
  package_id: string;
  package_name: string;
  package_version: number;
  contains: {
    catalog: boolean;
    tagsets: boolean;
  };
  base_catalog_version?: string;
  base_tagset_version?: string;
  app_version?: string;
  created_at: string;
  assets?: {
    tagset_images?: SharePackageImageManifestEntry[];
  };
}

type PatchOperation = JsonObject & {
  type: string;
  target_type?: string;
  target_id?: string;
};

export interface SharePatch {
  operations: PatchOperation[];
}

export interface SharePackageImageManifestEntry {
  tagset_id: string;
  file_name: string;
  path: string;
  zip_path: string;
  content_type: string;
  size: number;
}

export interface SharePackageImageAsset {
  tagSetId: string;
  fileName: string;
  path: string;
  zipPath: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface SharePackage {
  manifest: SharePackageManifest;
  catalogPatch?: SharePatch;
  tagsetPatch?: SharePatch;
  imageAssets?: SharePackageImageAsset[];
  changesCsv: string;
}

export interface ImportPreview {
  pkg: SharePackage;
  nextCatalog?: CatalogDocument;
  nextTagSets?: TagSetDocument;
  summary: ChangeSummary;
  issues: string[];
  conflicts: string[];
}

export interface ImportSelection {
  catalog: boolean;
  tagsets: boolean;
}

export type ConflictResolution = "stop" | "import" | "skip";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const PACKAGE_ID_KEY = "prompt-workbench:share-package-id";
const PACKAGE_NAME_KEY = "prompt-workbench:share-package-name";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function asObject(value: JsonValue | undefined): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function stableId(value: JsonValue | undefined, fallback: string): string {
  return String(value ?? fallback);
}

function summaryZero(): ChangeSummary {
  return {
    movedTags: 0,
    addedTags: 0,
    deletedTags: 0,
    renamedTags: 0,
    changedCategories: 0,
    duplicateDelta: 0,
  };
}

function addSummary(left: ChangeSummary, right: ChangeSummary): ChangeSummary {
  return {
    movedTags: left.movedTags + right.movedTags,
    addedTags: left.addedTags + right.addedTags,
    deletedTags: left.deletedTags + right.deletedTags,
    renamedTags: left.renamedTags + right.renamedTags,
    changedCategories: left.changedCategories + right.changedCategories,
    duplicateDelta: left.duplicateDelta + right.duplicateDelta,
  };
}

function tagIdentity(tag: TagOccurrence): string {
  return stableId(tag.sourceId, tag.uid);
}

function catalogVersion(document?: CatalogDocument | null): string | undefined {
  const generated = document?.original?.generated_at;
  if (typeof generated === "string" && generated.trim()) return generated;
  const stats = document?.original?.stats;
  return stats && typeof stats === "object" && !Array.isArray(stats) ? JSON.stringify(stats) : undefined;
}

function tagSetVersion(document?: TagSetDocument | null): string | undefined {
  const generated = document?.original?.generated_at;
  if (typeof generated === "string" && generated.trim()) return generated;
  return document ? `${document.majorCategories.length}:${document.majorCategories.map((major) => major.id).join("|")}` : undefined;
}

function setIdentity(set: TagSetItem): string {
  return set.id;
}

function categoryPayload(category: CategoryNode): JsonObject {
  return {
    id: category.id,
    level: category.level,
    parentId: category.parentId,
    labelJa: category.labelJa,
    labelEn: category.labelEn,
    descriptionJa: category.descriptionJa,
    order: category.order,
    raw: clone(category.raw),
  };
}

function tagPayload(tag: TagOccurrence): JsonObject {
  return {
    uid: tag.uid,
    sourceId: tag.sourceId,
    categoryId: tag.categoryId,
    prompt: tag.prompt,
    translationJa: tag.translationJa,
    aliases: [...tag.aliases],
    postCount: tag.postCount,
    order: tag.order,
    raw: clone(tag.raw),
  };
}

function setPayload(set: TagSetItem, smallId: string, order: number): JsonObject {
  return {
    id: set.id,
    smallId,
    order,
    name: set.name,
    nameJa: set.nameJa,
    nameEn: set.nameEn,
    creator: set.creator,
    sourceUrl: set.sourceUrl,
    imageUrl: set.imageUrl,
    imagePath: set.imagePath,
    tags: [...set.tags],
    raw: clone(set.raw),
  };
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function withoutOrder<T extends JsonObject>(value: T): JsonObject {
  const next = clone(value);
  delete next.order;
  return next;
}

export function readPackageName(): string {
  try {
    return window.localStorage.getItem(PACKAGE_NAME_KEY) || "MyTagPackage";
  } catch {
    return "MyTagPackage";
  }
}

export function writePackageName(value: string): void {
  try {
    window.localStorage.setItem(PACKAGE_NAME_KEY, value.trim() || "MyTagPackage");
  } catch {
    // Package name is convenience state; export must continue if storage is unavailable.
  }
}

export function readPackageId(): string {
  try {
    const existing = window.localStorage.getItem(PACKAGE_ID_KEY);
    if (existing) return existing;
    const generated = crypto.randomUUID();
    window.localStorage.setItem(PACKAGE_ID_KEY, generated);
    return generated;
  } catch {
    return crypto.randomUUID();
  }
}

function sanitizePackageNameForFile(value: string): string {
  const safe = value
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/gu, " ")
    .trim()
    .replace(/\s+/gu, "-")
    .replace(/[. ]+$/gu, "");
  return safe.slice(0, 80) || "MyTagPackage";
}

export function packageFileName(
  packageName: string,
  contentType: PackageContentType,
  packageVersion: number,
  now = new Date(),
): string {
  const part = (value: number) => String(value).padStart(2, "0");
  const date = `${now.getFullYear()}${part(now.getMonth() + 1)}${part(now.getDate())}`;
  const time = `${part(now.getHours())}${part(now.getMinutes())}`;
  return `PromptWorkbench_${sanitizePackageNameForFile(packageName)}_${contentType}_v${Math.max(1, Math.floor(packageVersion))}_${date}_${time}.zip`;
}

function catalogPatch(before: CatalogDocument, after: CatalogDocument): SharePatch {
  const operations: PatchOperation[] = [];
  const beforeCategories = new Map(before.categories.map((category) => [category.id, category]));
  const afterCategories = new Map(after.categories.map((category) => [category.id, category]));
  for (const category of after.categories) {
    const previous = beforeCategories.get(category.id);
    const payload = categoryPayload(category);
    if (!previous) operations.push({ type: "add_category", target_type: "category", target_id: category.id, category: payload });
    else if (!jsonEqual(withoutOrder(categoryPayload(previous)), withoutOrder(payload)))
      operations.push({
        type: "update_category",
        target_type: "category",
        target_id: category.id,
        before_category: categoryPayload(previous),
        category: payload,
      });
  }

  const beforeTags = new Map(before.tags.map((tag) => [tagIdentity(tag), tag]));
  const afterTags = new Map(after.tags.map((tag) => [tagIdentity(tag), tag]));
  for (const tag of afterTags.values()) {
    const id = tagIdentity(tag);
    const previous = beforeTags.get(id);
    const payload = tagPayload(tag);
    if (!previous) operations.push({ type: "add_tag", target_type: "tag", target_id: id, tag: payload });
    else if (!jsonEqual(withoutOrder(tagPayload(previous)), withoutOrder(payload)))
      operations.push({
        type: "update_tag",
        target_type: "tag",
        target_id: id,
        before_tag: tagPayload(previous),
        tag: payload,
      });
  }
  return { operations };
}

function flattenTagSets(document: TagSetDocument): Map<string, { set: TagSetItem; smallId: string; order: number }> {
  const result = new Map<string, { set: TagSetItem; smallId: string; order: number }>();
  for (const major of document.majorCategories) {
    for (const medium of major.mediumCategories) {
      for (const small of medium.smallCategories) {
        small.sets.forEach((set, order) => result.set(setIdentity(set), { set, smallId: small.id, order }));
      }
    }
  }
  return result;
}

function labelText(labelJa: JsonValue | undefined, labelEn: JsonValue | undefined, fallback: string): string {
  const ja = payloadString(labelJa);
  const en = payloadString(labelEn);
  return ja || en || fallback;
}

function tagSetDisplayMaps(document: TagSetDocument): {
  categories: Map<string, string>;
  sets: Map<string, string>;
} {
  const categories = new Map<string, string>();
  const sets = new Map<string, string>();
  for (const major of document.majorCategories) {
    const majorLabel = labelText(major.labelJa, major.labelEn, major.id);
    categories.set(`major:${major.id}`, `大分類: ${majorLabel}`);
    for (const medium of major.mediumCategories) {
      const mediumLabel = labelText(medium.labelJa, medium.labelEn, medium.id);
      const mediumPath = `大分類: ${majorLabel} › 中分類: ${mediumLabel}`;
      categories.set(`medium:${medium.id}`, mediumPath);
      for (const small of medium.smallCategories) {
        const smallLabel = labelText(small.labelJa, small.labelEn, small.id);
        const smallPath = `${mediumPath} › 小分類: ${smallLabel}`;
        categories.set(`small:${small.id}`, smallPath);
        for (const set of small.sets) {
          const setLabel = labelText(set.nameJa, set.nameEn || set.name, set.id);
          sets.set(setIdentity(set), `タグセット「${setLabel}」 (${smallPath})`);
        }
      }
    }
  }
  return { categories, sets };
}

function tagSetCategoryDisplayName(document: TagSetDocument, id: string, category?: JsonObject): string {
  const display = tagSetDisplayMaps(document).categories.get(id);
  if (display) return display;
  if (!category) return id;
  const level = category.level === "major" ? "大分類" : category.level === "medium" ? "中分類" : "小分類";
  return `${level}: ${labelText(category.labelJa, category.labelEn, id)}`;
}

function tagSetDisplayName(document: TagSetDocument, id: string, set?: JsonObject): string {
  const display = tagSetDisplayMaps(document).sets.get(id);
  if (display) return display;
  if (!set) return id;
  const name = labelText(set.nameJa, set.nameEn || set.name, id);
  return `タグセット「${name}」`;
}

function tagSetCategoryOperations(before: TagSetDocument, after: TagSetDocument): PatchOperation[] {
  const operations: PatchOperation[] = [];
  const afterIds = new Set<string>();
  const add = (type: string, id: string, category: JsonObject) =>
    operations.push({ type, target_type: "tagset_category", target_id: id, category });
  const visit = (document: TagSetDocument, sink: Map<string, JsonObject>) => {
    document.majorCategories.forEach((major, majorIndex) => {
      sink.set(`major:${major.id}`, {
        level: "major",
        id: major.id,
        parentId: "",
        order: majorIndex,
        labelJa: major.labelJa,
        labelEn: major.labelEn,
        raw: clone(major.raw),
      });
      major.mediumCategories.forEach((medium, mediumIndex) => {
        sink.set(`medium:${medium.id}`, {
          level: "medium",
          id: medium.id,
          parentId: major.id,
          order: mediumIndex,
          labelJa: medium.labelJa,
          labelEn: medium.labelEn,
          raw: clone(medium.raw),
        });
        medium.smallCategories.forEach((small, smallIndex) => {
          sink.set(`small:${small.id}`, {
            level: "small",
            id: small.id,
            parentId: medium.id,
            order: smallIndex,
            labelJa: small.labelJa,
            labelEn: small.labelEn,
            raw: clone(small.raw),
          });
        });
      });
    });
  };
  const beforeMap = new Map<string, JsonObject>();
  const afterMap = new Map<string, JsonObject>();
  visit(before, beforeMap);
  visit(after, afterMap);
  afterMap.forEach((_value, id) => afterIds.add(id));
  afterMap.forEach((category, id) => {
    const previous = beforeMap.get(id);
    if (!previous) add("add_tagset_category", id, category);
    else if (!jsonEqual(withoutOrder(previous), withoutOrder(category)))
      operations.push({
        type: "update_tagset_category",
        target_type: "tagset_category",
        target_id: id,
        before_category: previous,
        category,
      });
  });
  return operations;
}

function tagSetPatch(before: TagSetDocument, after: TagSetDocument): SharePatch {
  const operations = tagSetCategoryOperations(before, after);
  const beforeSets = flattenTagSets(before);
  const afterSets = flattenTagSets(after);
  for (const item of afterSets.values()) {
    const previous = beforeSets.get(item.set.id);
    const payload = setPayload(item.set, item.smallId, item.order);
    if (!previous) operations.push({ type: "add_tagset", target_type: "tagset", target_id: item.set.id, tagset: payload });
    else if (!jsonEqual(withoutOrder(setPayload(previous.set, previous.smallId, previous.order)), withoutOrder(payload)))
      operations.push({
        type: "update_tagset",
        target_type: "tagset",
        target_id: item.set.id,
        before_tagset: setPayload(previous.set, previous.smallId, previous.order),
        tagset: payload,
      });
  }
  return { operations };
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return `"${text.replace(/"/gu, '""')}"`;
}

function changesCsv(pkg: SharePackage): string {
  const rows = [["変更種別", "データ種別", "ID", "名前", "日本語名", "source", "備考"]];
  for (const operation of pkg.catalogPatch?.operations ?? []) {
    const tag = asObject(operation.tag);
    const category = asObject(operation.category);
    rows.push([
      operation.type,
      "タグカタログ",
      String(operation.target_id ?? ""),
      String(tag?.prompt ?? category?.labelEn ?? ""),
      String(tag?.translationJa ?? category?.labelJa ?? ""),
      String(tag?.sourceId ?? ""),
      "",
    ]);
  }
  for (const operation of pkg.tagsetPatch?.operations ?? []) {
    const set = asObject(operation.tagset);
    const category = asObject(operation.category);
    rows.push([
      operation.type,
      "タグセット",
      String(operation.target_id ?? ""),
      String(set?.name ?? category?.labelEn ?? ""),
      String(set?.nameJa ?? category?.labelJa ?? ""),
      String(set?.sourceUrl ?? ""),
      "",
    ]);
  }
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function createSharePackage(options: {
  packageName: string;
  packageId: string;
  packageVersion: number;
  includeCatalog: boolean;
  includeTagSets: boolean;
  catalogBaseline?: CatalogDocument | null;
  catalogDocument?: CatalogDocument | null;
  tagSetBaseline?: TagSetDocument | null;
  tagSetDocument?: TagSetDocument | null;
}): SharePackage {
  const manifest: SharePackageManifest = {
    format_version: 1,
    package_id: options.packageId,
    package_name: options.packageName.trim() || "MyTagPackage",
    package_version: Math.max(1, Math.floor(options.packageVersion || 1)),
    contains: {
      catalog: Boolean(options.includeCatalog && options.catalogBaseline && options.catalogDocument),
      tagsets: Boolean(options.includeTagSets && options.tagSetBaseline && options.tagSetDocument),
    },
    base_catalog_version: catalogVersion(options.catalogBaseline),
    base_tagset_version: tagSetVersion(options.tagSetBaseline),
    app_version: "tag-editor",
    created_at: new Date().toISOString(),
  };
  const pkg: SharePackage = { manifest, changesCsv: "" };
  if (manifest.contains.catalog && options.catalogBaseline && options.catalogDocument) {
    pkg.catalogPatch = catalogPatch(options.catalogBaseline, options.catalogDocument);
  }
  if (manifest.contains.tagsets && options.tagSetBaseline && options.tagSetDocument) {
    pkg.tagsetPatch = tagSetPatch(options.tagSetBaseline, options.tagSetDocument);
  }
  pkg.changesCsv = changesCsv(pkg);
  return pkg;
}

function dosTimeDate(date = new Date()): { time: number; date: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function crc32(bytes: Uint8Array): number {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}

function u16(value: number): number[] {
  return [value & 255, (value >>> 8) & 255];
}

function u32(value: number): number[] {
  return [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];
}

export function createZip(files: Record<string, string | Uint8Array>): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const stamp = dosTimeDate();
  for (const [name, value] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = typeof value === "string" ? encoder.encode(value) : value;
    const crc = crc32(data);
    const local = new Uint8Array([
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(2048),
      ...u16(0),
      ...u16(stamp.time),
      ...u16(stamp.date),
      ...u32(crc),
      ...u32(data.length),
      ...u32(data.length),
      ...u16(nameBytes.length),
      ...u16(0),
      ...nameBytes,
    ]);
    chunks.push(local, data);
    central.push(
      new Uint8Array([
        ...u32(0x02014b50),
        ...u16(20),
        ...u16(20),
        ...u16(2048),
        ...u16(0),
        ...u16(stamp.time),
        ...u16(stamp.date),
        ...u32(crc),
        ...u32(data.length),
        ...u32(data.length),
        ...u16(nameBytes.length),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u32(0),
        ...u32(offset),
        ...nameBytes,
      ]),
    );
    offset += local.length + data.length;
  }
  const centralOffset = offset;
  const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0);
  chunks.push(...central);
  chunks.push(
    new Uint8Array([
      ...u32(0x06054b50),
      ...u16(0),
      ...u16(0),
      ...u16(central.length),
      ...u16(central.length),
      ...u32(centralSize),
      ...u32(centralOffset),
      ...u16(0),
    ]),
  );
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    output.set(chunk, cursor);
    cursor += chunk.length;
  }
  return output;
}

function readU16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

export function readZip(bytes: Uint8Array): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  let offset = 0;
  while (offset + 30 <= bytes.length && readU32(bytes, offset) === 0x04034b50) {
    const method = readU16(bytes, offset + 8);
    if (method !== 0) throw new Error("圧縮済みZIPには対応していません。Prompt Workbenchから書き出したZIPを選んでください。");
    const size = readU32(bytes, offset + 18);
    const nameLength = readU16(bytes, offset + 26);
    const extraLength = readU16(bytes, offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = decoder.decode(bytes.slice(nameStart, nameStart + nameLength));
    if (name.includes("..") || name.startsWith("/") || /^[a-z]:/iu.test(name)) throw new Error("ZIP内に安全でないパスがあります。");
    files[name] = bytes.slice(dataStart, dataStart + size);
    offset = dataStart + size;
  }
  return files;
}

export function packageToZip(pkg: SharePackage): Uint8Array {
  const manifest: SharePackageManifest = pkg.imageAssets?.length
    ? {
        ...pkg.manifest,
        assets: {
          ...pkg.manifest.assets,
          tagset_images: pkg.imageAssets.map((asset) => ({
            tagset_id: asset.tagSetId,
            file_name: asset.fileName,
            path: asset.path,
            zip_path: asset.zipPath,
            content_type: asset.contentType,
            size: asset.bytes.byteLength,
          })),
        },
      }
    : pkg.manifest;
  const files: Record<string, string | Uint8Array> = {
    "manifest.json": `${JSON.stringify(manifest, null, 2)}\n`,
    "changes.csv": encoder.encode(pkg.changesCsv),
  };
  if (pkg.catalogPatch) files["catalog_patch.json"] = `${JSON.stringify(pkg.catalogPatch, null, 2)}\n`;
  if (pkg.tagsetPatch) files["tagset_patch.json"] = `${JSON.stringify(pkg.tagsetPatch, null, 2)}\n`;
  for (const asset of pkg.imageAssets ?? []) files[asset.zipPath] = asset.bytes;
  return createZip(files);
}

const CATALOG_OPERATION_TYPES = new Set(["add_category", "update_category", "delete_category", "add_tag", "update_tag", "delete_tag"]);
const TAGSET_OPERATION_TYPES = new Set([
  "add_tagset_category",
  "update_tagset_category",
  "delete_tagset_category",
  "add_tagset",
  "update_tagset",
  "delete_tagset",
]);

function validatePatch(name: string, patch: SharePatch | undefined, allowed: Set<string>): SharePatch {
  if (!patch || !Array.isArray(patch.operations)) throw new Error(`${name} の operations が不正です。`);
  const seen = new Set<string>();
  for (const [index, operation] of patch.operations.entries()) {
    if (!operation || typeof operation !== "object" || Array.isArray(operation)) throw new Error(`${name} の operation ${index + 1} が不正です。`);
    if (!allowed.has(operation.type)) throw new Error(`${name} に未知のoperation typeがあります: ${operation.type}`);
    const id = typeof operation.target_id === "string" ? operation.target_id : "";
    if (!id) throw new Error(`${name} の operation ${index + 1} に target_id がありません。`);
    const key = `${operation.type}:${operation.target_type ?? ""}:${id}`;
    if (seen.has(key)) throw new Error(`${name} に重複operationがあります: ${key}`);
    seen.add(key);
  }
  return patch;
}

export function parsePackageZip(bytes: Uint8Array): SharePackage {
  const files = readZip(bytes);
  const textFile = (name: string): string | undefined => {
    const value = files[name];
    if (value && value.byteLength > 4 * 1024 * 1024) throw new Error(`${name} が大きすぎます。`);
    return value ? decoder.decode(value) : undefined;
  };
  const manifest = JSON.parse(textFile("manifest.json") ?? "null") as SharePackageManifest | null;
  if (!manifest || manifest.format_version !== 1) throw new Error("manifest.json の format_version が対応外です。");
  const pkg: SharePackage = {
    manifest,
    changesCsv: textFile("changes.csv") ?? "",
  };
  if (manifest.contains.catalog) pkg.catalogPatch = validatePatch("catalog_patch.json", JSON.parse(textFile("catalog_patch.json") ?? "null") as SharePatch, CATALOG_OPERATION_TYPES);
  if (manifest.contains.tagsets) pkg.tagsetPatch = validatePatch("tagset_patch.json", JSON.parse(textFile("tagset_patch.json") ?? "null") as SharePatch, TAGSET_OPERATION_TYPES);
  if (manifest.contains.catalog && !pkg.catalogPatch) throw new Error("catalog_patch.json が見つかりません。");
  if (manifest.contains.tagsets && !pkg.tagsetPatch) throw new Error("tagset_patch.json が見つかりません。");
  const imageEntries = Array.isArray(manifest.assets?.tagset_images) ? manifest.assets.tagset_images : [];
  pkg.imageAssets = imageEntries.map((entry, index) => {
    const zipPath = String(entry.zip_path ?? "");
    if (!zipPath.startsWith("assets/tag-set-images/") || zipPath.includes(".."))
      throw new Error(`画像アセット ${index + 1} のパスが不正です。`);
    const bytes = files[zipPath];
    if (!bytes) throw new Error(`画像アセットが見つかりません: ${zipPath}`);
    if (bytes.byteLength > 8 * 1024 * 1024) throw new Error(`画像アセットが大きすぎます: ${zipPath}`);
    const fileName = String(entry.file_name ?? zipPath.split("/").pop() ?? "");
    if (!fileName || fileName.includes("/") || fileName.includes("\\") || !fileName.toLowerCase().endsWith(".webp"))
      throw new Error(`画像アセット ${index + 1} のファイル名が不正です。`);
    return {
      tagSetId: String(entry.tagset_id ?? ""),
      fileName,
      path: String(entry.path ?? ""),
      zipPath,
      contentType: String(entry.content_type ?? "image/webp"),
      bytes,
    };
  });
  return pkg;
}

function payloadObject(operation: PatchOperation, key: string): JsonObject {
  const value = asObject(operation[key]);
  if (!value) throw new Error(`${operation.type} に ${key} がありません。`);
  return value;
}

function payloadString(value: JsonValue | undefined): string {
  return typeof value === "string" ? value : "";
}

function rebuildTagSetCategoryMaps(document: TagSetDocument): {
  majors: Map<string, TagSetMajorCategory>;
  mediums: Map<string, TagSetMediumCategory>;
  smalls: Map<string, TagSetSmallCategory>;
} {
  const majors = new Map<string, TagSetMajorCategory>();
  const mediums = new Map<string, TagSetMediumCategory>();
  const smalls = new Map<string, TagSetSmallCategory>();
  for (const major of document.majorCategories) {
    majors.set(major.id, major);
    for (const medium of major.mediumCategories) {
      mediums.set(medium.id, medium);
      for (const small of medium.smallCategories) smalls.set(small.id, small);
    }
  }
  return { majors, mediums, smalls };
}

function tagSetCategoryPayload(operation: PatchOperation): {
  level: "major" | "medium" | "small";
  id: string;
  parentId: string;
  order: number;
  labelJa: string;
  labelEn: string;
  raw: JsonObject;
} {
  const category = payloadObject(operation, "category");
  const level = category.level === "major" || category.level === "medium" || category.level === "small" ? category.level : null;
  const id = payloadString(category.id);
  if (!level || !id) throw new Error("タグセットカテゴリの level または id が空です。");
  return {
    level,
    id,
    parentId: payloadString(category.parentId),
    order: typeof category.order === "number" ? category.order : 0,
    labelJa: payloadString(category.labelJa) || id,
    labelEn: payloadString(category.labelEn),
    raw: (asObject(category.raw) ?? {}) as JsonObject,
  };
}

function orderedRaw(raw: JsonObject, order: number): JsonObject {
  return { ...clone(raw), __import_order: order };
}

function sortImportedTagSetCategories(document: TagSetDocument): void {
  const orderOf = (raw: JsonObject) => (typeof raw.__import_order === "number" ? raw.__import_order : 0);
  document.majorCategories.sort((left, right) => orderOf(left.raw) - orderOf(right.raw));
  for (const major of document.majorCategories) {
    major.mediumCategories.sort((left, right) => orderOf(left.raw) - orderOf(right.raw));
    for (const medium of major.mediumCategories) {
      medium.smallCategories.sort((left, right) => orderOf(left.raw) - orderOf(right.raw));
    }
  }
}

function stripImportOrder(document: TagSetDocument): void {
  for (const major of document.majorCategories) {
    delete major.raw.__import_order;
    for (const medium of major.mediumCategories) {
      delete medium.raw.__import_order;
      for (const small of medium.smallCategories) delete small.raw.__import_order;
    }
  }
}

function applyTagSetCategoryOperation(
  document: TagSetDocument,
  operation: PatchOperation,
  manifest?: SharePackageManifest,
  deletedCategories = new Set<string>(),
): void {
  if (operation.type === "delete_tagset_category") {
    return;
  }
  if (operation.type !== "add_tagset_category" && operation.type !== "update_tagset_category") return;
  const payload = tagSetCategoryPayload(operation);
  if (deletedCategories.has(`${payload.level}:${payload.id}`)) return;
  if (manifest) markImported(payload.raw, manifest.package_id, manifest.package_version);
  const maps = rebuildTagSetCategoryMaps(document);
  if (payload.level === "major") {
    const existing = maps.majors.get(payload.id);
    const item: TagSetMajorCategory = {
      id: payload.id,
      labelJa: payload.labelJa,
      labelEn: payload.labelEn,
      mediumCategories: existing?.mediumCategories ?? [],
      raw: orderedRaw(payload.raw, payload.order),
    };
    const index = document.majorCategories.findIndex((major) => major.id === payload.id);
    if (index >= 0) document.majorCategories[index] = item;
    else document.majorCategories.push(item);
  } else if (payload.level === "medium") {
    const parent = maps.majors.get(payload.parentId);
    if (!parent) throw new Error(`${payload.labelJa} の親大分類がありません。`);
    const existing = maps.mediums.get(payload.id);
    const item: TagSetMediumCategory = {
      id: payload.id,
      labelJa: payload.labelJa,
      labelEn: payload.labelEn,
      smallCategories: existing?.smallCategories ?? [],
      raw: orderedRaw(payload.raw, payload.order),
    };
    for (const major of document.majorCategories) {
      major.mediumCategories = major.mediumCategories.filter((medium) => medium.id !== payload.id);
    }
    parent.mediumCategories.push(item);
  } else {
    const parent = maps.mediums.get(payload.parentId);
    if (!parent) throw new Error(`${payload.labelJa} の親中分類がありません。`);
    const existing = maps.smalls.get(payload.id);
    const item: TagSetSmallCategory = {
      id: payload.id,
      labelJa: payload.labelJa,
      labelEn: payload.labelEn,
      sets: existing?.sets ?? [],
      raw: orderedRaw(payload.raw, payload.order),
    };
    for (const major of document.majorCategories) {
      for (const medium of major.mediumCategories) {
        medium.smallCategories = medium.smallCategories.filter((small) => small.id !== payload.id);
      }
    }
    parent.smallCategories.push(item);
  }
  sortImportedTagSetCategories(document);
}

export function applyCatalogPatch(
  document: CatalogDocument,
  patch: SharePatch,
  manifest?: SharePackageManifest,
): CatalogDocument {
  let next = clone(document);
  const meta = getWorkbenchMeta(next.original);
  const deletedCategories = new Set(meta.deletedDefaultCatalogCategoryIds);
  const deletedTags = new Set(meta.deletedDefaultCatalogIds);
  const categoryIds = new Set(next.categories.map((category) => category.id));
  for (const operation of patch.operations) {
    if (operation.type === "delete_category") {
      continue;
    }
    if (operation.type === "add_category" || operation.type === "update_category") {
      const category = payloadObject(operation, "category");
      const item: CategoryNode = {
        id: payloadString(category.id),
        level:
          category.level === "major" || category.level === "medium" || category.level === "small"
            ? category.level
            : "small",
        parentId: payloadString(category.parentId),
        labelJa: payloadString(category.labelJa),
        labelEn: payloadString(category.labelEn),
        descriptionJa: payloadString(category.descriptionJa),
        order: typeof category.order === "number" ? category.order : next.categories.length,
        raw: (asObject(category.raw) ?? {}) as JsonObject,
      };
      if (!item.id) throw new Error(`${operation.type} のカテゴリIDが空です。`);
      if (deletedCategories.has(item.id)) continue;
      if (manifest) item.raw = markImported(item.raw, manifest.package_id, manifest.package_version);
      const index = next.categories.findIndex((existing) => existing.id === item.id);
      if (index >= 0) next.categories[index] = item;
      else next.categories.push(item);
      categoryIds.add(item.id);
      continue;
    }
    if (operation.type === "delete_tag") {
      continue;
    }
    if (operation.type === "add_tag" || operation.type === "update_tag") {
      const tag = payloadObject(operation, "tag");
      const item: TagOccurrence = {
        uid: payloadString(tag.uid) || `import:${operation.target_id}`,
        sourceId: tag.sourceId,
        categoryId: payloadString(tag.categoryId),
        prompt: payloadString(tag.prompt),
        translationJa: payloadString(tag.translationJa),
        aliases: Array.isArray(tag.aliases) ? tag.aliases.filter((value): value is string => typeof value === "string") : [],
        postCount: typeof tag.postCount === "number" ? tag.postCount : undefined,
        order: typeof tag.order === "number" ? tag.order : next.tags.length,
        raw: (asObject(tag.raw) ?? {}) as JsonObject,
      };
      if (!item.prompt) throw new Error(`${operation.type} のタグ名が空です。`);
      if (!categoryIds.has(item.categoryId)) throw new Error(`${item.prompt} の移動先カテゴリがありません。`);
      const identity = tagIdentity(item);
      if (deletedTags.has(identity)) continue;
      if (manifest) item.raw = markImported(item.raw, manifest.package_id, manifest.package_version);
      const index = next.tags.findIndex((existing) => tagIdentity(existing) === identity);
      if (index >= 0) next.tags[index] = item;
      else next.tags.push(item);
    }
  }
  if (manifest) {
    addImportHistory(next.original, {
      packageId: manifest.package_id,
      packageName: manifest.package_name,
      packageVersion: manifest.package_version,
      formatVersion: manifest.format_version,
      importedAt: new Date().toISOString(),
      containsCatalog: manifest.contains.catalog,
      containsTagSets: manifest.contains.tagsets,
    });
  } else {
    writeWorkbenchMeta(next.original, meta);
  }
  return next;
}

export function applyTagSetPatch(document: TagSetDocument, patch: SharePatch): TagSetDocument {
  return applyTagSetPatchWithCategories(document, patch);
  const next = clone(document);
  const smalls = new Map<string, { sets: TagSetItem[] }>();
  for (const major of next.majorCategories) {
    for (const medium of major.mediumCategories) {
      for (const small of medium.smallCategories) smalls.set(small.id, small);
    }
  }
  for (const operation of patch.operations) {
    if (operation.type === "add_tagset" || operation.type === "update_tagset") {
      const set = payloadObject(operation, "tagset");
      const smallId = payloadString(set.smallId);
      const target = smalls.get(smallId);
      if (!target) throw new Error(`${payloadString(set.name) || operation.target_id} の移動先タグセットカテゴリがありません。`);
      const item: TagSetItem = {
        id: payloadString(set.id),
        name: payloadString(set.name),
        nameJa: payloadString(set.nameJa),
        nameEn: payloadString(set.nameEn),
        creator: payloadString(set.creator),
        sourceUrl: payloadString(set.sourceUrl),
        imageUrl: payloadString(set.imageUrl),
        imagePath: payloadString(set.imagePath),
        tags: Array.isArray(set.tags) ? set.tags.filter((value): value is string => typeof value === "string") : [],
        raw: (asObject(set.raw) ?? {}) as JsonObject,
      };
      if (!item.id) throw new Error(`${operation.type} のタグセットIDが空です。`);
      for (const small of smalls.values()) small.sets = small.sets.filter((existing) => existing.id !== item.id);
      target.sets.splice(Math.max(0, Math.min(typeof set.order === "number" ? set.order : target.sets.length, target.sets.length)), 0, item);
    } else if (operation.type === "delete_tagset") {
      for (const small of smalls.values()) small.sets = small.sets.filter((existing) => existing.id !== operation.target_id);
    }
  }
  return next;
}

function applyTagSetPatchWithCategories(
  document: TagSetDocument,
  patch: SharePatch,
  manifest?: SharePackageManifest,
): TagSetDocument {
  const next = clone(document);
  const meta = getWorkbenchMeta(next.original);
  const deletedSets = new Set(meta.deletedDefaultTagSetIds);
  const deletedCategories = new Set(meta.deletedDefaultTagSetCategoryIds);
  for (const operation of patch.operations) {
    if (operation.target_type === "tagset_category") {
      applyTagSetCategoryOperation(next, operation, manifest, deletedCategories);
      continue;
    }
    if (operation.type === "add_tagset" || operation.type === "update_tagset") {
      const set = payloadObject(operation, "tagset");
      const smallId = payloadString(set.smallId);
      const { smalls } = rebuildTagSetCategoryMaps(next);
      const target = smalls.get(smallId);
      if (!target) throw new Error(`${payloadString(set.name) || operation.target_id} の移動先タグセットカテゴリがありません。`);
      const item: TagSetItem = {
        id: payloadString(set.id),
        name: payloadString(set.name),
        nameJa: payloadString(set.nameJa),
        nameEn: payloadString(set.nameEn),
        creator: payloadString(set.creator),
        sourceUrl: payloadString(set.sourceUrl),
        imageUrl: payloadString(set.imageUrl),
        imagePath: payloadString(set.imagePath),
        tags: Array.isArray(set.tags) ? set.tags.filter((value): value is string => typeof value === "string") : [],
        raw: (asObject(set.raw) ?? {}) as JsonObject,
      };
      if (!item.id) throw new Error(`${operation.type} のタグセットIDが空です。`);
      if (deletedSets.has(item.id)) continue;
      if (manifest) item.raw = markImported(item.raw, manifest.package_id, manifest.package_version);
      for (const small of smalls.values()) small.sets = small.sets.filter((existing) => existing.id !== item.id);
      target.sets.splice(Math.max(0, Math.min(typeof set.order === "number" ? set.order : target.sets.length, target.sets.length)), 0, item);
    } else if (operation.type === "delete_tagset") continue;
  }
  stripImportOrder(next);
  if (manifest) {
    addImportHistory(next.original, {
      packageId: manifest.package_id,
      packageName: manifest.package_name,
      packageVersion: manifest.package_version,
      formatVersion: manifest.format_version,
      importedAt: new Date().toISOString(),
      containsCatalog: manifest.contains.catalog,
      containsTagSets: manifest.contains.tagsets,
    });
  } else {
    writeWorkbenchMeta(next.original, meta);
  }
  return next;
}

function detectCatalogConflicts(document: CatalogDocument, patch: SharePatch): string[] {
  const conflicts: string[] = [];
  const categories = new Map(document.categories.map((category) => [category.id, category]));
  const tags = new Map(document.tags.map((tag) => [tagIdentity(tag), tag]));
  for (const operation of patch.operations) {
    if (operation.type === "add_category") {
      const category = payloadObject(operation, "category");
      const id = payloadString(category.id);
      const existing = categories.get(id);
      if (existing && !jsonEqual(categoryPayload(existing), category)) conflicts.push(`タグカタログ分類 ${id} はImport先に別内容で存在します。`);
    } else if (operation.type === "update_category") {
      const before = asObject(operation.before_category);
      const id = payloadString(operation.target_id);
      const existing = categories.get(id);
      if (before && existing && !jsonEqual(categoryPayload(existing), before)) conflicts.push(`タグカタログ分類 ${id} はImport先で既に変更されています。`);
    } else if (operation.type === "add_tag") {
      const tag = payloadObject(operation, "tag");
      const id = payloadString(operation.target_id);
      const existing = tags.get(id);
      if (existing && !jsonEqual(tagPayload(existing), tag)) conflicts.push(`タグ ${id} はImport先に別内容で存在します。`);
    } else if (operation.type === "update_tag") {
      const before = asObject(operation.before_tag);
      const id = payloadString(operation.target_id);
      const existing = tags.get(id);
      if (before && existing && !jsonEqual(tagPayload(existing), before)) conflicts.push(`タグ ${id} はImport先で既に変更されています。`);
    }
  }
  return conflicts;
}

function catalogOperationHasConflict(document: CatalogDocument, operation: PatchOperation): boolean {
  const categories = new Map(document.categories.map((category) => [category.id, category]));
  const tags = new Map(document.tags.map((tag) => [tagIdentity(tag), tag]));
  if (operation.type === "add_category") {
    const category = payloadObject(operation, "category");
    const existing = categories.get(payloadString(category.id));
    return Boolean(existing && !jsonEqual(categoryPayload(existing), category));
  }
  if (operation.type === "update_category") {
    const before = asObject(operation.before_category);
    const existing = categories.get(payloadString(operation.target_id));
    return Boolean(before && existing && !jsonEqual(categoryPayload(existing), before));
  }
  if (operation.type === "add_tag") {
    const tag = payloadObject(operation, "tag");
    const existing = tags.get(payloadString(operation.target_id));
    return Boolean(existing && !jsonEqual(tagPayload(existing), tag));
  }
  if (operation.type === "update_tag") {
    const before = asObject(operation.before_tag);
    const existing = tags.get(payloadString(operation.target_id));
    return Boolean(before && existing && !jsonEqual(tagPayload(existing), before));
  }
  return false;
}

function tagSetCategoryMapsForConflict(document: TagSetDocument): Map<string, JsonObject> {
  const result = new Map<string, JsonObject>();
  document.majorCategories.forEach((major, majorIndex) => {
    result.set(`major:${major.id}`, {
      level: "major",
      id: major.id,
      parentId: "",
      order: majorIndex,
      labelJa: major.labelJa,
      labelEn: major.labelEn,
      raw: clone(major.raw),
    });
    major.mediumCategories.forEach((medium, mediumIndex) => {
      result.set(`medium:${medium.id}`, {
        level: "medium",
        id: medium.id,
        parentId: major.id,
        order: mediumIndex,
        labelJa: medium.labelJa,
        labelEn: medium.labelEn,
        raw: clone(medium.raw),
      });
      medium.smallCategories.forEach((small, smallIndex) => {
        result.set(`small:${small.id}`, {
          level: "small",
          id: small.id,
          parentId: medium.id,
          order: smallIndex,
          labelJa: small.labelJa,
          labelEn: small.labelEn,
          raw: clone(small.raw),
        });
      });
    });
  });
  return result;
}

function detectTagSetConflicts(document: TagSetDocument, patch: SharePatch): string[] {
  const conflicts: string[] = [];
  const categories = tagSetCategoryMapsForConflict(document);
  const sets = flattenTagSets(document);
  for (const operation of patch.operations) {
    if (operation.type === "add_tagset_category") {
      const category = payloadObject(operation, "category");
      const id = payloadString(operation.target_id);
      const existing = categories.get(id);
      if (existing && !jsonEqual(existing, category))
        conflicts.push(`タグセット分類「${tagSetCategoryDisplayName(document, id, existing)}」はImport先に別内容で存在します。`);
    } else if (operation.type === "update_tagset_category") {
      const before = asObject(operation.before_category);
      const id = payloadString(operation.target_id);
      const existing = categories.get(id);
      if (before && existing && !jsonEqual(existing, before))
        conflicts.push(`タグセット分類「${tagSetCategoryDisplayName(document, id, existing)}」はImport先で既に変更されています。`);
    } else if (operation.type === "add_tagset") {
      const tagset = payloadObject(operation, "tagset");
      const id = payloadString(operation.target_id);
      const existing = sets.get(id);
      if (existing && !jsonEqual(setPayload(existing.set, existing.smallId, existing.order), tagset))
        conflicts.push(`${tagSetDisplayName(document, id, tagset)}はImport先に別内容で存在します。`);
    } else if (operation.type === "update_tagset") {
      const before = asObject(operation.before_tagset);
      const id = payloadString(operation.target_id);
      const existing = sets.get(id);
      if (before && existing && !jsonEqual(setPayload(existing.set, existing.smallId, existing.order), before))
        conflicts.push(`${tagSetDisplayName(document, id, before)}はImport先で既に変更されています。`);
    }
  }
  return conflicts;
}

function tagSetOperationHasConflict(document: TagSetDocument, operation: PatchOperation): boolean {
  const categories = tagSetCategoryMapsForConflict(document);
  const sets = flattenTagSets(document);
  if (operation.type === "add_tagset_category") {
    const category = payloadObject(operation, "category");
    const existing = categories.get(payloadString(operation.target_id));
    return Boolean(existing && !jsonEqual(existing, category));
  }
  if (operation.type === "update_tagset_category") {
    const before = asObject(operation.before_category);
    const existing = categories.get(payloadString(operation.target_id));
    return Boolean(before && existing && !jsonEqual(existing, before));
  }
  if (operation.type === "add_tagset") {
    const tagset = payloadObject(operation, "tagset");
    const existing = sets.get(payloadString(operation.target_id));
    return Boolean(existing && !jsonEqual(setPayload(existing.set, existing.smallId, existing.order), tagset));
  }
  if (operation.type === "update_tagset") {
    const before = asObject(operation.before_tagset);
    const existing = sets.get(payloadString(operation.target_id));
    return Boolean(before && existing && !jsonEqual(setPayload(existing.set, existing.smallId, existing.order), before));
  }
  return false;
}

function withoutCatalogConflicts(document: CatalogDocument, patch: SharePatch): SharePatch {
  return { operations: patch.operations.filter((operation) => !catalogOperationHasConflict(document, operation)) };
}

function withoutTagSetConflicts(document: TagSetDocument, patch: SharePatch): SharePatch {
  return { operations: patch.operations.filter((operation) => !tagSetOperationHasConflict(document, operation)) };
}

export function previewImport(options: {
  pkg: SharePackage;
  catalogDocument?: CatalogDocument | null;
  tagSetDocument?: TagSetDocument | null;
  selection?: ImportSelection;
  conflictResolution?: ConflictResolution;
}): ImportPreview {
  const issues: string[] = [];
  const conflicts: string[] = [];
  let summary = summaryZero();
  let nextCatalog: CatalogDocument | undefined;
  let nextTagSets: TagSetDocument | undefined;
  const selection = options.selection ?? {
    catalog: options.pkg.manifest.contains.catalog,
    tagsets: options.pkg.manifest.contains.tagsets,
  };
  if (options.pkg.manifest.contains.catalog && selection.catalog) {
    if (!options.catalogDocument || !options.pkg.catalogPatch) issues.push("タグカタログの取り込み対象がありません。");
    else {
      conflicts.push(...detectCatalogConflicts(options.catalogDocument, options.pkg.catalogPatch));
      const patch =
        options.conflictResolution === "skip"
          ? withoutCatalogConflicts(options.catalogDocument, options.pkg.catalogPatch)
          : options.pkg.catalogPatch;
      nextCatalog = applyCatalogPatch(options.catalogDocument, patch, options.pkg.manifest);
      summary = addSummary(summary, {
        movedTags: patch.operations.filter((item) => item.type === "update_tag").length,
        addedTags: patch.operations.filter((item) => item.type === "add_tag").length,
        deletedTags: 0,
        renamedTags: 0,
        changedCategories: patch.operations.filter((item) => item.target_type === "category").length,
        duplicateDelta: 0,
      });
    }
  }
  if (options.pkg.manifest.contains.tagsets && selection.tagsets) {
    if (!options.tagSetDocument || !options.pkg.tagsetPatch) issues.push("タグセットの取り込み対象がありません。");
    else {
      conflicts.push(...detectTagSetConflicts(options.tagSetDocument, options.pkg.tagsetPatch));
      const patch =
        options.conflictResolution === "skip"
          ? withoutTagSetConflicts(options.tagSetDocument, options.pkg.tagsetPatch)
          : options.pkg.tagsetPatch;
      nextTagSets = applyTagSetPatchWithCategories(options.tagSetDocument, patch, options.pkg.manifest);
      summary = addSummary(summary, {
        movedTags: patch.operations.filter((item) => item.type === "update_tagset").length,
        addedTags: patch.operations.filter((item) => item.type === "add_tagset").length,
        deletedTags: 0,
        renamedTags: 0,
        changedCategories: patch.operations.filter((item) => item.target_type === "tagset_category").length,
        duplicateDelta: 0,
      });
    }
  }
  return { pkg: options.pkg, nextCatalog, nextTagSets, summary, issues, conflicts };
}

export function exportPreviewJson(catalog?: CatalogDocument | null, tagSets?: TagSetDocument | null): Record<string, string> {
  return {
    ...(catalog ? { "catalog.preview.json": serializeCatalog(catalog) } : {}),
    ...(tagSets ? { "tag_sets.preview.json": serializeTagSetDocument(tagSets) } : {}),
  };
}
