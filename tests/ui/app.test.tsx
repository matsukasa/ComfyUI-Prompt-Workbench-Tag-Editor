import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { App } from "../../src/App";
import { demoDocument } from "../../src/demoCatalog";
import { isDirty, useCatalogStore } from "../../src/store/catalogStore";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  useCatalogStore.getState().load(structuredClone(demoDocument));
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

it("renders the selected colorful kanban structure", async () => {
  render(<App />);
  expect(await screen.findByText("ComfyUI Prompt Workbench Tag Editor")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "髪型" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "髪の色" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "上書き保存" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "別名で保存" })).toBeEnabled();
});

it("renders every small category and provides horizontal lane controls", async () => {
  const expanded = structuredClone(demoDocument);
  const medium = expanded.categories.find((category) => category.level === "medium")!;
  for (let index = 0; index < 5; index += 1) {
    expanded.categories.push({
      id: `extra-small-${index}`,
      level: "small",
      parentId: medium.id,
      labelJa: `追加小分類${index + 1}`,
      labelEn: `Extra ${index + 1}`,
      descriptionJa: "",
      order: 100 + index,
      raw: {},
    });
  }
  useCatalogStore.getState().load(expanded);
  const { container } = render(<App />);
  const expectedLaneCount = expanded.categories.filter(
    (category) => category.level === "small" && category.parentId === medium.id,
  ).length;
  expect(expectedLaneCount).toBeGreaterThan(4);
  expect(container.querySelectorAll(".kanban-lane")).toHaveLength(expectedLaneCount);
  expect(screen.getByRole("button", { name: "小分類を右へスクロール" })).toBeInTheDocument();
});

it("edits a tag and its translation directly in the row without a dialog", async () => {
  const user = userEvent.setup();
  const prompt = vi.spyOn(window, "prompt");
  render(<App />);
  fireEvent.doubleClick(await screen.findByText("long_hair"));
  const nameInput = screen.getByRole("textbox", { name: "long_hairのタグ名" });
  const translationInput = screen.getByRole("textbox", { name: "long_hairの日本語訳" });
  await user.clear(nameInput);
  await user.type(nameInput, "long_hair_edited");
  await user.clear(translationInput);
  await user.type(translationInput, "ロングヘア編集");
  await user.click(screen.getByRole("button", { name: "long_hairの変更を保存" }));
  expect(prompt).not.toHaveBeenCalled();
  expect(useCatalogStore.getState().document!.tags.some((tag) => tag.prompt === "long_hair_edited")).toBe(
    true,
  );
  expect(
    useCatalogStore.getState().document!.tags.some((tag) => tag.translationJa === "ロングヘア編集"),
  ).toBe(true);
  expect(screen.queryByRole("button", { name: "long_hairを編集" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("long_hair_edited：編集済み")).toBeInTheDocument();
});

it("marks only the directly moved tag as changed", () => {
  const document = useCatalogStore.getState().document!;
  const categoryId = document.tags[0].categoryId;
  const tags = document.tags.filter((tag) => tag.categoryId === categoryId);
  const moved = tags.at(-1)!;
  useCatalogStore.getState().selectMany([moved.uid]);
  useCatalogStore.getState().applyTagMove(categoryId, tags[0].uid);
  const { container } = render(<App />);
  expect(screen.getByLabelText(`${moved.prompt}：移動済み`)).toBeInTheDocument();
  expect(container.querySelectorAll(".tag-row.is-modified")).toHaveLength(1);
});

it("edits major, medium, and small names by double-clicking their labels", async () => {
  const user = userEvent.setup();
  const prompt = vi.spyOn(window, "prompt");
  const { container } = render(<App />);
  fireEvent.doubleClick(screen.getByText("人物"));
  const majorName = screen.getByRole("textbox", { name: "人物のカテゴリ名" });
  const majorEnglishName = screen.getByRole("textbox", { name: "人物の英語名" });
  expect(majorName).toHaveFocus();
  await user.clear(majorName);
  await user.type(majorName, "人物編集");
  await user.clear(majorEnglishName);
  await user.type(majorEnglishName, "Person edited");
  await user.click(screen.getByRole("button", { name: "人物の変更を保存" }));

  fireEvent.doubleClick(screen.getByText("髪"));
  const mediumName = screen.getByRole("textbox", { name: "髪のカテゴリ名" });
  const mediumEnglishName = screen.getByRole("textbox", { name: "髪の英語名" });
  await user.clear(mediumName);
  await user.type(mediumName, "髪編集");
  await user.clear(mediumEnglishName);
  await user.type(mediumEnglishName, "Hair edited");
  await user.click(screen.getByRole("button", { name: "髪の変更を保存" }));

  fireEvent.doubleClick(container.querySelector('[data-category-id="hair-style"] .category-label')!);
  const smallName = screen.getByRole("textbox", { name: "髪型のカテゴリ名" });
  const smallEnglishName = screen.getByRole("textbox", { name: "髪型の英語名" });
  await user.clear(smallName);
  await user.type(smallName, "髪型編集");
  await user.clear(smallEnglishName);
  await user.type(smallEnglishName, "Hairstyle edited");
  await user.click(screen.getByRole("button", { name: "髪型の変更を保存" }));

  expect(prompt).not.toHaveBeenCalled();
  expect(useCatalogStore.getState().document!.categories.some((item) => item.labelJa === "人物編集")).toBe(
    true,
  );
  expect(useCatalogStore.getState().document!.categories.some((item) => item.labelJa === "髪編集")).toBe(
    true,
  );
  expect(useCatalogStore.getState().document!.categories.some((item) => item.labelJa === "髪型編集")).toBe(
    true,
  );
  expect(screen.getByLabelText("人物編集：変更済み")).toBeInTheDocument();
  expect(screen.getByLabelText("髪編集：変更済み")).toBeInTheDocument();
  expect(screen.getByLabelText("髪型編集：変更済み")).toBeInTheDocument();
});

it("cancels an inline category edit without changing the category", async () => {
  const user = userEvent.setup();
  render(<App />);
  fireEvent.doubleClick(screen.getByText("人物"));
  const nameInput = screen.getByRole("textbox", { name: "人物のカテゴリ名" });
  await user.clear(nameInput);
  await user.type(nameInput, "保存しない名前");
  await user.click(screen.getByRole("button", { name: "人物の変更をキャンセル" }));
  expect(screen.getByText("人物", { exact: true })).toBeInTheDocument();
  expect(
    useCatalogStore.getState().document!.categories.some((item) => item.labelJa === "保存しない名前"),
  ).toBe(false);
});

it("removes the ambiguous bottom selection dock", () => {
  const { container } = render(<App />);
  expect(container.querySelector(".selection-dock")).not.toBeInTheDocument();
});

it("labels the file picker as a tag settings file action", () => {
  render(<App />);
  expect(screen.getByRole("button", { name: "タグ設定ファイルを開く" })).toBeInTheDocument();
});

it("toggles drag sounds from the settings popover and remembers the preference", async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole("button", { name: "設定" }));
  const soundToggle = screen.getByRole("switch", { name: "操作音" });
  expect(soundToggle).toHaveAttribute("aria-checked", "true");
  await user.click(soundToggle);
  expect(screen.getByRole("switch", { name: "操作音" })).toHaveAttribute("aria-checked", "false");
  expect(window.localStorage.getItem("prompt-workbench-tag-editor:drag-sounds")).toBe("off");
});

it("supports ctrl-click and shift-click selection", async () => {
  const user = userEvent.setup();
  render(<App />);
  const longHair = await screen.findByText("long_hair");
  const twinTails = screen.getByText("twin_tails");
  await user.click(longHair);
  await user.keyboard("{Control>}");
  await user.click(twinTails);
  await user.keyboard("{/Control}");
  expect(useCatalogStore.getState().selectedTagIds).toHaveLength(2);
  fireEvent.click(screen.getByText("ponytail"), { shiftKey: true });
  expect(useCatalogStore.getState().selectedTagIds).toHaveLength(2);
});

it("focuses the lane containing the most recently selected tag", async () => {
  const user = userEvent.setup();
  const { container } = render(<App />);
  await user.click(await screen.findByText("long_hair"));
  const focusedLane = screen.getByRole("heading", { name: "髪型" }).closest(".kanban-lane");
  expect(container.querySelector(".kanban-grid")).toHaveClass("has-focus");
  expect(focusedLane).toHaveClass("is-focused");
  expect(container.querySelectorAll(".kanban-lane.is-deemphasized")).toHaveLength(3);
});

it("filters tags without changing underlying data", async () => {
  const user = userEvent.setup();
  render(<App />);
  const before = useCatalogStore.getState().document!.tags.length;
  await user.type(screen.getByRole("textbox", { name: "タグを横断検索" }), "twin_tails");
  expect(await screen.findByText("twin_tails")).toBeInTheDocument();
  expect(screen.queryByText("long_hair")).not.toBeInTheDocument();
  expect(useCatalogStore.getState().document!.tags).toHaveLength(before);
});

it("opens an export preview and reports validation", async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole("button", { name: "別名で保存" }));
  const dialog = screen.getByRole("dialog", { name: "変更プレビュー" });
  expect(within(dialog).getByText("重大なエラーはありません")).toBeInTheDocument();
  expect(within(dialog).getByText(/tag_catalog_\d{8}_\d{6}/u)).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "別名で保存" })).toBeInTheDocument();
});

it("uses the native save picker and marks the saved file as the new baseline", async () => {
  const user = userEvent.setup();
  const write = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn().mockResolvedValue(undefined);
  const savedHandle = {
    name: "my-tags.json",
    getFile: vi.fn(),
    createWritable: vi.fn().mockResolvedValue({ write, close }),
  };
  const showSaveFilePicker = vi.fn().mockResolvedValue(savedHandle);
  vi.stubGlobal("showSaveFilePicker", showSaveFilePicker);
  render(<App />);
  const tag = useCatalogStore.getState().document!.tags[0];
  useCatalogStore.getState().editTag(tag.uid, "saved-change", "");

  await user.click(screen.getByRole("button", { name: "別名で保存" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "別名で保存" }));

  expect(await screen.findByText("my-tags.json に別名保存しました")).toBeInTheDocument();
  expect(showSaveFilePicker).toHaveBeenCalledWith(
    expect.objectContaining({
      id: "prompt-workbench-catalog-save",
      suggestedName: expect.stringMatching(/^tag_catalog_\d{8}_\d{6}\.json$/u),
    }),
  );
  expect(write).toHaveBeenCalledWith(expect.stringContaining('"saved-change"'));
  expect(close).toHaveBeenCalledOnce();
  expect(useCatalogStore.getState().document?.fileName).toBe("my-tags.json");
  expect(isDirty(useCatalogStore.getState())).toBe(false);
  expect(screen.getByRole("button", { name: "上書き保存" })).toBeEnabled();
});

it("starts save-as from the file handle used to open the current catalog", async () => {
  const user = userEvent.setup();
  const openedFile = new File([JSON.stringify(demoDocument.original)], "opened-tags.json", {
    type: "application/json",
  });
  const openedHandle = {
    name: "opened-tags.json",
    getFile: vi.fn().mockResolvedValue(openedFile),
    createWritable: vi.fn(),
  };
  const savedHandle = {
    name: "saved-near-source.json",
    getFile: vi.fn(),
    createWritable: vi.fn().mockResolvedValue({
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }),
  };
  const showSaveFilePicker = vi.fn().mockResolvedValue(savedHandle);
  vi.stubGlobal("showOpenFilePicker", vi.fn().mockResolvedValue([openedHandle]));
  vi.stubGlobal("showSaveFilePicker", showSaveFilePicker);
  render(<App />);

  await user.click(screen.getByRole("button", { name: "タグ設定ファイルを開く" }));
  expect(await screen.findByText("opened-tags.json を読み込みました")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "別名で保存" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "別名で保存" }));

  expect(showSaveFilePicker).toHaveBeenCalledWith(
    expect.objectContaining({
      id: "prompt-workbench-catalog-save",
      startIn: openedHandle,
    }),
  );
});

it("overwrites a file opened with the native file picker after confirmation", async () => {
  const user = userEvent.setup();
  const write = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn().mockResolvedValue(undefined);
  const openedFile = new File([JSON.stringify(demoDocument.original)], "opened-tags.json", {
    type: "application/json",
  });
  const openedHandle = {
    name: "opened-tags.json",
    getFile: vi.fn().mockResolvedValue(openedFile),
    createWritable: vi.fn().mockResolvedValue({ write, close }),
  };
  vi.stubGlobal("showOpenFilePicker", vi.fn().mockResolvedValue([openedHandle]));
  render(<App />);

  await user.click(screen.getByRole("button", { name: "タグ設定ファイルを開く" }));
  expect(await screen.findByText("opened-tags.json を読み込みました")).toBeInTheDocument();
  const tag = useCatalogStore.getState().document!.tags[0];
  useCatalogStore.getState().editTag(tag.uid, "overwritten-change", "");
  await user.click(screen.getByRole("button", { name: "上書き保存" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "上書き保存" }));

  expect(window.confirm).toHaveBeenCalledWith("opened-tags.json を上書き保存しますか？");
  expect(await screen.findByText("opened-tags.json を上書き保存しました")).toBeInTheDocument();
  expect(write).toHaveBeenCalledWith(expect.stringContaining('"overwritten-change"'));
  expect(close).toHaveBeenCalledOnce();
  expect(isDirty(useCatalogStore.getState())).toBe(false);
});
