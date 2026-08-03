import { beforeEach, expect, it } from "vitest";
import { demoDocument } from "../src/demoCatalog";
import { isDirty, useCatalogStore } from "../src/store/catalogStore";

beforeEach(() => useCatalogStore.getState().load(structuredClone(demoDocument)));

it("keeps 100 history items and supports undo and redo", () => {
  const initial = useCatalogStore.getState().document!;
  const tag = initial.tags[0];
  for (let index = 0; index < 105; index++) useCatalogStore.getState().editTag(tag.uid, `tag_${index}`, "");
  expect(useCatalogStore.getState().history).toHaveLength(100);
  useCatalogStore.getState().undo();
  expect(useCatalogStore.getState().document?.tags[0].prompt).toBe("tag_103");
  useCatalogStore.getState().redo();
  expect(useCatalogStore.getState().document?.tags[0].prompt).toBe("tag_104");
});

it("tracks the dirty state and can reset", () => {
  expect(isDirty(useCatalogStore.getState())).toBe(false);
  const tag = useCatalogStore.getState().document!.tags[0];
  useCatalogStore.getState().editTag(tag.uid, "changed", "");
  expect(isDirty(useCatalogStore.getState())).toBe(true);
  useCatalogStore.getState().reset();
  expect(isDirty(useCatalogStore.getState())).toBe(false);
});

it("supports ctrl-like toggle and shift-like range selection", () => {
  const ids = useCatalogStore
    .getState()
    .document!.tags.slice(0, 5)
    .map((tag) => tag.uid);
  useCatalogStore.getState().selectTag(ids[0], "single", ids);
  useCatalogStore.getState().selectTag(ids[2], "toggle", ids);
  expect(useCatalogStore.getState().selectedTagIds).toEqual([ids[0], ids[2]]);
  useCatalogStore.getState().selectTag(ids[4], "range", ids);
  expect(useCatalogStore.getState().selectedTagIds).toEqual(ids.slice(2, 5));
});
