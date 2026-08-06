import { create } from "zustand";
import { comparableCatalog } from "../domain/catalog";
import {
  addCategory,
  addTags,
  changeCategoryLevel,
  deleteCategory,
  deleteTags,
  moveCategory,
  moveTags,
  renameCategory,
  renameTag,
} from "../domain/operations";
import type { CatalogDocument, CategoryLevel } from "../domain/types";

interface StoreState {
  document: CatalogDocument | null;
  baseline: CatalogDocument | null;
  history: CatalogDocument[];
  future: CatalogDocument[];
  selectedTagIds: string[];
  touchedTagIds: string[];
  touchedCategoryIds: string[];
  anchorTagId: string | null;
  selectedMediumId: string | null;
  expandedCategoryIds: string[];
  globalQuery: string;
  categoryQuery: string;
  showDuplicatesOnly: boolean;
  showSelectedOnly: boolean;
  error: string | null;
  load: (document: CatalogDocument) => void;
  markSaved: (fileName: string) => void;
  setError: (error: string | null) => void;
  setSelectedMedium: (id: string) => void;
  toggleExpanded: (id: string, expanded?: boolean) => void;
  expandAll: (expanded: boolean) => void;
  setGlobalQuery: (query: string) => void;
  setCategoryQuery: (query: string) => void;
  setDuplicateFilter: (value: boolean) => void;
  setSelectedFilter: (value: boolean) => void;
  selectTag: (uid: string, mode: "single" | "toggle" | "range", visibleIds: string[]) => void;
  selectMany: (uids: string[]) => void;
  clearSelection: () => void;
  applyTagMove: (targetCategoryId: string, beforeUid?: string) => void;
  applyCategoryMove: (activeId: string, overId: string) => void;
  applyCategoryLevelChange: (id: string, targetLevel: "major" | "medium", parentId?: string) => void;
  editTag: (uid: string, prompt: string, translationJa: string) => void;
  createTags: (categoryId: string, values: string[]) => void;
  removeTags: (uids: string[]) => void;
  removeSelectedTags: () => void;
  createCategory: (level: CategoryLevel, parentId: string, labelJa: string) => void;
  editCategory: (id: string, labelJa: string, labelEn: string) => void;
  removeCategory: (id: string, destinationId?: string, deleteTagsToo?: boolean) => void;
  undo: () => void;
  redo: () => void;
  reset: () => void;
}

function firstMedium(document: CatalogDocument): string | null {
  return document.categories.find((category) => category.level === "medium")?.id ?? null;
}

function mutate(
  set: (recipe: (state: StoreState) => Partial<StoreState>) => void,
  operation: (document: CatalogDocument) => CatalogDocument,
): void {
  set((state) => {
    if (!state.document) return {};
    try {
      const next = operation(state.document);
      return {
        document: next,
        history: [...state.history, state.document].slice(-100),
        future: [],
        error: null,
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "操作に失敗しました。" };
    }
  });
}

export const useCatalogStore = create<StoreState>((set, get) => ({
  document: null,
  baseline: null,
  history: [],
  future: [],
  selectedTagIds: [],
  touchedTagIds: [],
  touchedCategoryIds: [],
  anchorTagId: null,
  selectedMediumId: null,
  expandedCategoryIds: [],
  globalQuery: "",
  categoryQuery: "",
  showDuplicatesOnly: false,
  showSelectedOnly: false,
  error: null,
  load: (document) =>
    set({
      document,
      baseline: structuredClone(document),
      history: [],
      future: [],
      selectedTagIds: [],
      touchedTagIds: [],
      touchedCategoryIds: [],
      anchorTagId: null,
      selectedMediumId: firstMedium(document),
      expandedCategoryIds: document.categories
        .filter((item) => item.level !== "small")
        .map((item) => item.id),
      error: null,
    }),
  markSaved: (fileName) =>
    set((state) => {
      if (!state.document) return {};
      const document = { ...state.document, fileName };
      return {
        document,
        baseline: structuredClone(document),
        history: [],
        future: [],
        touchedTagIds: [],
        touchedCategoryIds: [],
        error: null,
      };
    }),
  setError: (error) => set({ error }),
  setSelectedMedium: (id) => set({ selectedMediumId: id }),
  toggleExpanded: (id, expanded) =>
    set((state) => {
      const next = new Set(state.expandedCategoryIds);
      const shouldExpand = expanded ?? !next.has(id);
      if (shouldExpand) next.add(id);
      else next.delete(id);
      return { expandedCategoryIds: [...next] };
    }),
  expandAll: (expanded) =>
    set((state) => ({
      expandedCategoryIds:
        expanded && state.document
          ? state.document.categories.filter((item) => item.level !== "small").map((item) => item.id)
          : [],
    })),
  setGlobalQuery: (globalQuery) => set({ globalQuery }),
  setCategoryQuery: (categoryQuery) => set({ categoryQuery }),
  setDuplicateFilter: (showDuplicatesOnly) => set({ showDuplicatesOnly }),
  setSelectedFilter: (showSelectedOnly) => set({ showSelectedOnly }),
  selectTag: (uid, mode, visibleIds) =>
    set((state) => {
      if (mode === "range" && state.anchorTagId) {
        const left = visibleIds.indexOf(state.anchorTagId);
        const right = visibleIds.indexOf(uid);
        if (left >= 0 && right >= 0)
          return {
            selectedTagIds: visibleIds.slice(Math.min(left, right), Math.max(left, right) + 1),
            anchorTagId: uid,
          };
      }
      if (mode === "toggle") {
        const selected = new Set(state.selectedTagIds);
        if (selected.has(uid)) selected.delete(uid);
        else selected.add(uid);
        return { selectedTagIds: [...selected], anchorTagId: uid };
      }
      return { selectedTagIds: [uid], anchorTagId: uid };
    }),
  selectMany: (selectedTagIds) => set({ selectedTagIds, anchorTagId: selectedTagIds.at(-1) ?? null }),
  clearSelection: () => set({ selectedTagIds: [], anchorTagId: null }),
  applyTagMove: (targetCategoryId, beforeUid) => {
    const selected = get().selectedTagIds;
    mutate(set, (document) => moveTags(document, selected, targetCategoryId, beforeUid));
    set((state) => ({ touchedTagIds: [...new Set([...state.touchedTagIds, ...selected])] }));
  },
  applyCategoryMove: (activeId, overId) => {
    mutate(set, (document) => moveCategory(document, activeId, overId));
    set((state) => ({ touchedCategoryIds: [...new Set([...state.touchedCategoryIds, activeId])] }));
  },
  applyCategoryLevelChange: (id, targetLevel, parentId) => {
    mutate(set, (document) => changeCategoryLevel(document, id, targetLevel, parentId));
    set((state) => ({ touchedCategoryIds: [...new Set([...state.touchedCategoryIds, id])] }));
  },
  editTag: (uid, prompt, translationJa) => {
    mutate(set, (document) => renameTag(document, uid, prompt, translationJa));
    set((state) => ({ touchedTagIds: [...new Set([...state.touchedTagIds, uid])] }));
  },
  createTags: (categoryId, values) => mutate(set, (document) => addTags(document, categoryId, values)),
  removeTags: (uids) => {
    if (!uids.length) return;
    const removed = new Set(uids);
    mutate(set, (document) => deleteTags(document, uids));
    set((state) => ({
      selectedTagIds: state.selectedTagIds.filter((uid) => !removed.has(uid)),
      touchedTagIds: state.touchedTagIds.filter((uid) => !removed.has(uid)),
      anchorTagId: state.anchorTagId && removed.has(state.anchorTagId) ? null : state.anchorTagId,
    }));
  },
  removeSelectedTags: () => get().removeTags(get().selectedTagIds),
  createCategory: (level, parentId, labelJa) =>
    mutate(set, (document) => addCategory(document, level, parentId, labelJa)),
  editCategory: (id, labelJa, labelEn) => {
    mutate(set, (document) => renameCategory(document, id, labelJa, labelEn));
    set((state) => ({ touchedCategoryIds: [...new Set([...state.touchedCategoryIds, id])] }));
  },
  removeCategory: (id, destinationId, deleteTagsToo) =>
    set((state) => {
      if (!state.document) return {};
      try {
        const next = deleteCategory(state.document, id, destinationId, deleteTagsToo);
        const remainingCategoryIds = new Set(next.categories.map((category) => category.id));
        const remainingTagIds = new Set(next.tags.map((tag) => tag.uid));
        return {
          document: next,
          history: [...state.history, state.document].slice(-100),
          future: [],
          selectedTagIds: state.selectedTagIds.filter((uid) => remainingTagIds.has(uid)),
          touchedTagIds: state.touchedTagIds.filter((uid) => remainingTagIds.has(uid)),
          touchedCategoryIds: state.touchedCategoryIds.filter((categoryId) =>
            remainingCategoryIds.has(categoryId),
          ),
          anchorTagId:
            state.anchorTagId && remainingTagIds.has(state.anchorTagId) ? state.anchorTagId : null,
          selectedMediumId:
            state.selectedMediumId && remainingCategoryIds.has(state.selectedMediumId)
              ? state.selectedMediumId
              : firstMedium(next),
          expandedCategoryIds: state.expandedCategoryIds.filter((categoryId) =>
            remainingCategoryIds.has(categoryId),
          ),
          error: null,
        };
      } catch (error) {
        return { error: error instanceof Error ? error.message : "分類を削除できませんでした。" };
      }
    }),
  undo: () =>
    set((state) => {
      const previous = state.history.at(-1);
      if (!previous || !state.document) return {};
      return {
        document: previous,
        history: state.history.slice(0, -1),
        future: [state.document, ...state.future].slice(0, 100),
        selectedTagIds: [],
        error: null,
      };
    }),
  redo: () =>
    set((state) => {
      const next = state.future[0];
      if (!next || !state.document) return {};
      return {
        document: next,
        history: [...state.history, state.document].slice(-100),
        future: state.future.slice(1),
        selectedTagIds: [],
        error: null,
      };
    }),
  reset: () =>
    set((state) =>
      state.baseline
        ? {
            document: structuredClone(state.baseline),
            history: state.document ? [...state.history, state.document].slice(-100) : [],
            future: [],
            selectedTagIds: [],
            touchedTagIds: [],
            touchedCategoryIds: [],
            error: null,
          }
        : {},
    ),
}));

export function isDirty(state: Pick<StoreState, "document" | "baseline">): boolean {
  return Boolean(
    state.document &&
    state.baseline &&
    comparableCatalog(state.document) !== comparableCatalog(state.baseline),
  );
}
