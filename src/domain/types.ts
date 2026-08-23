export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export type CategoryLevel = "major" | "medium" | "small";
export type SourceFormat = "bundled" | "stored";
export type DataOrigin = "default" | "local" | "imported";

export interface FormatMetadata {
  bom: boolean;
  newline: "\n" | "\r\n";
  indent: number;
  finalNewline: boolean;
}

export interface CategoryNode {
  id: string;
  level: CategoryLevel;
  parentId: string;
  labelJa: string;
  labelEn: string;
  descriptionJa: string;
  order: number;
  raw: JsonObject;
}

export interface TagOccurrence {
  uid: string;
  sourceId: JsonValue | undefined;
  categoryId: string;
  prompt: string;
  translationJa: string;
  aliases: string[];
  postCount?: number;
  order: number;
  raw: JsonObject;
}

export interface ImportHistoryEntry {
  packageId: string;
  packageName: string;
  packageVersion: number;
  formatVersion: number;
  importedAt: string;
  containsCatalog: boolean;
  containsTagSets: boolean;
}

export interface WorkbenchMeta {
  deletedDefaultCatalogIds: string[];
  deletedDefaultCatalogCategoryIds: string[];
  deletedDefaultTagSetIds: string[];
  deletedDefaultTagSetCategoryIds: string[];
  imports: Record<string, ImportHistoryEntry>;
}

export interface CatalogDocument {
  fileName: string;
  filePath?: string;
  format: SourceFormat;
  formatMeta: FormatMetadata;
  original: JsonObject;
  categories: CategoryNode[];
  tags: TagOccurrence[];
}

export interface ValidationIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  targetId?: string;
}

export interface ChangeSummary {
  movedTags: number;
  addedTags: number;
  deletedTags: number;
  renamedTags: number;
  changedCategories: number;
  duplicateDelta: number;
}

export interface TagSetItem {
  id: string;
  name: string;
  nameJa: string;
  nameEn: string;
  creator: string;
  sourceUrl: string;
  imageUrl: string;
  imagePath: string;
  tags: string[];
  raw: JsonObject;
}

export interface TagSetSmallCategory {
  id: string;
  labelJa: string;
  labelEn: string;
  sets: TagSetItem[];
  raw: JsonObject;
}

export interface TagSetMediumCategory {
  id: string;
  labelJa: string;
  labelEn: string;
  smallCategories: TagSetSmallCategory[];
  raw: JsonObject;
}

export interface TagSetMajorCategory {
  id: string;
  labelJa: string;
  labelEn: string;
  mediumCategories: TagSetMediumCategory[];
  raw: JsonObject;
}

export interface TagSetDocument {
  fileName: string;
  filePath?: string;
  formatMeta: FormatMetadata;
  original: JsonObject;
  majorCategories: TagSetMajorCategory[];
}
