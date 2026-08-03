export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export type CategoryLevel = "major" | "medium" | "small";
export type SourceFormat = "bundled" | "stored";

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

export interface CatalogDocument {
  fileName: string;
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
