import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { App } from "../../src/App";
import { demoDocument } from "../../src/demoCatalog";
import { useCatalogStore } from "../../src/store/catalogStore";

beforeEach(() => {
  vi.restoreAllMocks();
  useCatalogStore.getState().load(structuredClone(demoDocument));
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

it("renders the selected colorful kanban structure", async () => {
  render(<App />);
  expect(await screen.findByText("Prompt Workbench Tag Editor")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "髪型" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "髪の色" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "新しいファイルとして書き出す" })).toBeInTheDocument();
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

it("edits a tag by double-clicking its name without a row menu", async () => {
  const prompt = vi
    .spyOn(window, "prompt")
    .mockReturnValueOnce("long_hair_edited")
    .mockReturnValueOnce("ロングヘア編集");
  render(<App />);
  fireEvent.doubleClick(await screen.findByText("long_hair"));
  expect(prompt).toHaveBeenCalledTimes(2);
  expect(useCatalogStore.getState().document!.tags.some((tag) => tag.prompt === "long_hair_edited")).toBe(
    true,
  );
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

it("edits major and medium names by double-clicking their labels", async () => {
  const prompt = vi
    .spyOn(window, "prompt")
    .mockReturnValueOnce("人物編集")
    .mockReturnValueOnce("Person edited")
    .mockReturnValueOnce("髪編集")
    .mockReturnValueOnce("Hair edited");
  render(<App />);
  fireEvent.doubleClick(screen.getByText("人物"));
  fireEvent.doubleClick(screen.getByText("髪"));
  expect(prompt).toHaveBeenCalledTimes(4);
  expect(useCatalogStore.getState().document!.categories.some((item) => item.labelJa === "人物編集")).toBe(
    true,
  );
  expect(useCatalogStore.getState().document!.categories.some((item) => item.labelJa === "髪編集")).toBe(
    true,
  );
  expect(screen.getByLabelText("人物編集：変更済み")).toBeInTheDocument();
  expect(screen.getByLabelText("髪編集：変更済み")).toBeInTheDocument();
});

it("removes the ambiguous bottom selection dock", () => {
  const { container } = render(<App />);
  expect(container.querySelector(".selection-dock")).not.toBeInTheDocument();
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
  const buttons = screen.getAllByRole("button", { name: "新しいファイルとして書き出す" });
  await user.click(buttons[0]);
  const dialog = screen.getByRole("dialog", { name: "変更プレビュー" });
  expect(within(dialog).getByText("重大なエラーはありません")).toBeInTheDocument();
  expect(within(dialog).getByText(/tag_catalog_edited_/u)).toBeInTheDocument();
});
