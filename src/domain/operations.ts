import type { CatalogDocument, CategoryLevel, CategoryNode } from "./types";

function copy(document: CatalogDocument): CatalogDocument {
  return structuredClone(document);
}

function levelRank(level: CategoryLevel): number {
  return level === "major" ? 0 : level === "medium" ? 1 : 2;
}

function normalizeCategoryOrders(categories: CategoryNode[]): void {
  categories.sort((a, b) => a.order - b.order);
  categories.forEach((category, index) => (category.order = index));
}

function normalizeTagOrders(document: CatalogDocument): void {
  const categoryOrder = new Map(document.categories.map((category) => [category.id, category.order]));
  document.tags.sort((a, b) => {
    const categoryDiff =
      (categoryOrder.get(a.categoryId) ?? Number.MAX_SAFE_INTEGER) -
      (categoryOrder.get(b.categoryId) ?? Number.MAX_SAFE_INTEGER);
    return categoryDiff || a.order - b.order;
  });
  const indexes = new Map<string, number>();
  for (const tag of document.tags) {
    const order = indexes.get(tag.categoryId) ?? 0;
    tag.order = order;
    indexes.set(tag.categoryId, order + 1);
  }
}

export function moveTags(
  document: CatalogDocument,
  selectedUids: string[],
  targetCategoryId: string,
  beforeUid?: string,
): CatalogDocument {
  const result = copy(document);
  const target = result.categories.find((category) => category.id === targetCategoryId);
  if (!target || target.level !== "small") throw new Error("タグの移動先には小分類を選んでください。");
  const selectedSet = new Set(selectedUids);
  const categoryOrder = new Map(result.categories.map((category) => [category.id, category.order]));
  const moving = result.tags
    .filter((tag) => selectedSet.has(tag.uid))
    .sort((a, b) => categoryOrder.get(a.categoryId)! - categoryOrder.get(b.categoryId)! || a.order - b.order);
  if (!moving.length) return result;
  const remaining = result.tags.filter((tag) => !selectedSet.has(tag.uid));
  const targetList = remaining
    .filter((tag) => tag.categoryId === targetCategoryId)
    .sort((a, b) => a.order - b.order);
  const insertion = beforeUid
    ? Math.max(
        0,
        targetList.findIndex((tag) => tag.uid === beforeUid),
      )
    : targetList.length;
  moving.forEach((tag) => (tag.categoryId = targetCategoryId));
  targetList.splice(insertion < 0 ? targetList.length : insertion, 0, ...moving);
  targetList.forEach((tag, index) => (tag.order = index));
  result.tags = remaining.filter((tag) => tag.categoryId !== targetCategoryId).concat(targetList);
  normalizeTagOrders(result);
  return result;
}

function descendants(categories: CategoryNode[], id: string): Set<string> {
  const result = new Set<string>();
  const visit = (parentId: string) => {
    for (const item of categories.filter((category) => category.parentId === parentId)) {
      if (!result.has(item.id)) {
        result.add(item.id);
        visit(item.id);
      }
    }
  };
  visit(id);
  return result;
}

export function changeCategoryLevel(
  document: CatalogDocument,
  id: string,
  targetLevel: "major" | "medium",
  targetParentId = "",
): CatalogDocument {
  const result = copy(document);
  const category = result.categories.find((item) => item.id === id);
  if (!category) return result;
  if (category.level === "small") throw new Error("小分類は大・中分類へ変更できません。");
  if (category.level === targetLevel) return result;
  if (result.categories.some((item) => item.parentId === category.id)) {
    throw new Error("配下カテゴリがあります。先に子分類を別の分類へ移動してください。");
  }
  if (targetLevel === "medium") {
    const parent = result.categories.find((item) => item.id === targetParentId && item.level === "major");
    if (!parent) throw new Error("変更先の大分類がありません。");
    category.parentId = parent.id;
  } else {
    category.parentId = "";
  }
  category.level = targetLevel;
  category.order = result.categories.length;
  normalizeCategoryOrders(result.categories);
  normalizeTagOrders(result);
  return result;
}

export function moveCategory(document: CatalogDocument, activeId: string, overId: string): CatalogDocument {
  const result = copy(document);
  const active = result.categories.find((category) => category.id === activeId);
  const over = result.categories.find((category) => category.id === overId);
  if (!active || !over || active.id === over.id) return result;
  if (descendants(result.categories, active.id).has(over.id))
    throw new Error("子カテゴリの中へ親カテゴリを移動できません。");

  let newParentId = active.parentId;
  if (active.level === "major") {
    if (over.level === "medium") {
      const changed = changeCategoryLevel(result, active.id, "medium", over.parentId);
      const changedActive = changed.categories.find((category) => category.id === active.id);
      const changedOver = changed.categories.find((category) => category.id === over.id);
      if (changedActive && changedOver) {
        changedActive.order = changedOver.order - 0.5;
        normalizeCategoryOrders(changed.categories);
        normalizeTagOrders(changed);
      }
      return changed;
    }
    if (over.level !== "major") throw new Error("大分類は大分類または中分類へ移動してください。");
  } else if (active.level === "medium") {
    if (over.level === "major") newParentId = over.id;
    else if (over.level === "medium") newParentId = over.parentId;
    else throw new Error("中分類は大分類または中分類へ移動してください。");
  } else {
    if (over.level === "medium") newParentId = over.id;
    else if (over.level === "small") newParentId = over.parentId;
    else throw new Error("小分類は中分類または小分類へ移動してください。");
  }
  active.parentId = newParentId;
  const targetOrder =
    over.level === active.level
      ? over.order
      : Math.max(
          ...result.categories
            .filter((item) => item.level === active.level && item.parentId === newParentId)
            .map((item) => item.order),
          0,
        ) + 1;
  active.order = targetOrder - 0.5;
  normalizeCategoryOrders(result.categories);
  normalizeTagOrders(result);
  return result;
}

export function renameTag(
  document: CatalogDocument,
  uid: string,
  prompt: string,
  translationJa: string,
): CatalogDocument {
  const result = copy(document);
  const tag = result.tags.find((item) => item.uid === uid);
  if (!tag) return result;
  if (!prompt.trim()) throw new Error("タグ名を空にできません。");
  tag.prompt = prompt;
  tag.translationJa = translationJa;
  return result;
}

export function addTags(document: CatalogDocument, categoryId: string, values: string[]): CatalogDocument {
  const result = copy(document);
  const category = result.categories.find((item) => item.id === categoryId && item.level === "small");
  if (!category) throw new Error("追加先の小分類がありません。");
  const existing = result.tags.filter((tag) => tag.categoryId === categoryId);
  let nextOrder = existing.length;
  for (const value of values.map((item) => item.trim()).filter(Boolean)) {
    result.tags.push({
      uid: `custom:${crypto.randomUUID()}`,
      sourceId: undefined,
      categoryId,
      prompt: value,
      translationJa: "",
      aliases: [],
      order: nextOrder++,
      raw: {},
    });
  }
  normalizeTagOrders(result);
  return result;
}

export function deleteTags(document: CatalogDocument, uids: string[]): CatalogDocument {
  const result = copy(document);
  const selected = new Set(uids);
  result.tags = result.tags.filter((tag) => !selected.has(tag.uid));
  normalizeTagOrders(result);
  return result;
}

export function addCategory(
  document: CatalogDocument,
  level: CategoryLevel,
  parentId: string,
  labelJa: string,
): CatalogDocument {
  const result = copy(document);
  const parent = result.categories.find((category) => category.id === parentId);
  if (
    (level === "medium" && parent?.level !== "major") ||
    (level === "small" && parent?.level !== "medium")
  ) {
    throw new Error("カテゴリ階層と親分類が一致しません。");
  }
  const id = `custom:${level}:${crypto.randomUUID()}`;
  result.categories.push({
    id,
    level,
    parentId: level === "major" ? "" : parentId,
    labelJa: labelJa.trim() || "新しいカテゴリ",
    labelEn: "",
    descriptionJa: "",
    order: result.categories.length,
    raw: {},
  });
  return result;
}

export function renameCategory(
  document: CatalogDocument,
  id: string,
  labelJa: string,
  labelEn: string,
): CatalogDocument {
  const result = copy(document);
  const category = result.categories.find((item) => item.id === id);
  if (!category) return result;
  if (!labelJa.trim()) throw new Error("カテゴリ名を空にできません。");
  category.labelJa = labelJa;
  category.labelEn = labelEn;
  return result;
}

export function deleteCategory(
  document: CatalogDocument,
  id: string,
  destinationId?: string,
  deleteTagsToo = false,
): CatalogDocument {
  const result = copy(document);
  const removed = new Set<string>([id, ...descendants(result.categories, id)]);
  const affected = result.tags.filter((tag) => removed.has(tag.categoryId));
  if (affected.length && !destinationId && !deleteTagsToo)
    throw new Error("タグの移動先を指定してください。");
  if (destinationId) {
    const destination = result.categories.find((item) => item.id === destinationId && item.level === "small");
    if (!destination || removed.has(destination.id))
      throw new Error("有効な移動先小分類を指定してください。");
    affected.forEach((tag) => (tag.categoryId = destination.id));
  } else if (deleteTagsToo) {
    result.tags = result.tags.filter((tag) => !removed.has(tag.categoryId));
  }
  result.categories = result.categories.filter((category) => !removed.has(category.id));
  normalizeCategoryOrders(result.categories);
  normalizeTagOrders(result);
  return result;
}

export function categoryPath(categories: CategoryNode[], id: string): CategoryNode[] {
  const map = new Map(categories.map((item) => [item.id, item]));
  const path: CategoryNode[] = [];
  let current = map.get(id);
  while (current) {
    path.unshift(current);
    current = current.parentId ? map.get(current.parentId) : undefined;
  }
  return path;
}

export function sortedChildren(
  categories: CategoryNode[],
  parentId: string,
  level?: CategoryLevel,
): CategoryNode[] {
  return categories
    .filter((category) => category.parentId === parentId && (!level || category.level === level))
    .sort((a, b) => a.order - b.order || levelRank(a.level) - levelRank(b.level));
}
