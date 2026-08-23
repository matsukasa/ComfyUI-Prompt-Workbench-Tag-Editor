import type { DataOrigin, ImportHistoryEntry, JsonObject, JsonValue, WorkbenchMeta } from "./types";

export const WORKBENCH_META_KEY = "prompt_workbench_meta";

function isObject(value: JsonValue | undefined): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: JsonValue | undefined): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string"))] : [];
}

function imports(value: JsonValue | undefined): Record<string, ImportHistoryEntry> {
  if (!isObject(value)) return {};
  const result: Record<string, ImportHistoryEntry> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!isObject(item)) continue;
    const packageId = typeof item.packageId === "string" ? item.packageId : typeof item.package_id === "string" ? item.package_id : key;
    const packageName =
      typeof item.packageName === "string" ? item.packageName : typeof item.package_name === "string" ? item.package_name : packageId;
    const packageVersion =
      typeof item.packageVersion === "number"
        ? item.packageVersion
        : typeof item.package_version === "number"
          ? item.package_version
          : 1;
    const formatVersion =
      typeof item.formatVersion === "number"
        ? item.formatVersion
        : typeof item.format_version === "number"
          ? item.format_version
          : 1;
    result[key] = {
      packageId,
      packageName,
      packageVersion,
      formatVersion,
      importedAt:
        typeof item.importedAt === "string"
          ? item.importedAt
          : typeof item.imported_at === "string"
            ? item.imported_at
            : "",
      containsCatalog: Boolean(item.containsCatalog ?? item.contains_catalog),
      containsTagSets: Boolean(item.containsTagSets ?? item.contains_tagsets),
    };
  }
  return result;
}

export function getWorkbenchMeta(root: JsonObject): WorkbenchMeta {
  const value = root[WORKBENCH_META_KEY];
  const meta = isObject(value) ? value : {};
  return {
    deletedDefaultCatalogIds: stringArray(meta.deletedDefaultCatalogIds ?? meta.deleted_default_catalog_ids),
    deletedDefaultCatalogCategoryIds: stringArray(
      meta.deletedDefaultCatalogCategoryIds ?? meta.deleted_default_catalog_category_ids,
    ),
    deletedDefaultTagSetIds: stringArray(meta.deletedDefaultTagSetIds ?? meta.deleted_default_tagset_ids),
    deletedDefaultTagSetCategoryIds: stringArray(
      meta.deletedDefaultTagSetCategoryIds ?? meta.deleted_default_tagset_category_ids,
    ),
    imports: imports(meta.imports),
  };
}

export function writeWorkbenchMeta(root: JsonObject, meta: WorkbenchMeta): void {
  root[WORKBENCH_META_KEY] = {
    deleted_default_catalog_ids: [...new Set(meta.deletedDefaultCatalogIds)].sort(),
    deleted_default_catalog_category_ids: [...new Set(meta.deletedDefaultCatalogCategoryIds)].sort(),
    deleted_default_tagset_ids: [...new Set(meta.deletedDefaultTagSetIds)].sort(),
    deleted_default_tagset_category_ids: [...new Set(meta.deletedDefaultTagSetCategoryIds)].sort(),
    imports: Object.fromEntries(
      Object.entries(meta.imports).map(([key, item]) => [
        key,
        {
          package_id: item.packageId,
          package_name: item.packageName,
          package_version: item.packageVersion,
          format_version: item.formatVersion,
          imported_at: item.importedAt,
          contains_catalog: item.containsCatalog,
          contains_tagsets: item.containsTagSets,
        },
      ]),
    ),
  };
}

export function itemOrigin(raw: JsonObject): DataOrigin {
  const meta = isObject(raw[WORKBENCH_META_KEY]) ? raw[WORKBENCH_META_KEY] : undefined;
  const origin = meta?.origin;
  return origin === "local" || origin === "imported" ? origin : "default";
}

export function markLocal(raw: JsonObject): JsonObject {
  raw[WORKBENCH_META_KEY] = { ...(isObject(raw[WORKBENCH_META_KEY]) ? raw[WORKBENCH_META_KEY] : {}), origin: "local" };
  return raw;
}

export function markImported(raw: JsonObject, packageId: string, packageVersion: number): JsonObject {
  raw[WORKBENCH_META_KEY] = {
    ...(isObject(raw[WORKBENCH_META_KEY]) ? raw[WORKBENCH_META_KEY] : {}),
    origin: "imported",
    package_id: packageId,
    package_version: packageVersion,
  };
  return raw;
}

export function addImportHistory(root: JsonObject, entry: ImportHistoryEntry): void {
  const meta = getWorkbenchMeta(root);
  meta.imports[`${entry.packageId}@${entry.packageVersion}`] = entry;
  writeWorkbenchMeta(root, meta);
}
