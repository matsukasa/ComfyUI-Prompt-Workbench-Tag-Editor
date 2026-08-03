import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { App } from "../../src/App";
import { demoDocument } from "../../src/demoCatalog";
import { useCatalogStore } from "../../src/store/catalogStore";

beforeEach(() => {
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

it("supports ctrl-click and shift-click selection", async () => {
  const user = userEvent.setup();
  render(<App />);
  const longHair = await screen.findByText("long_hair");
  const twinTails = screen.getByText("twin_tails");
  await user.click(longHair);
  await user.keyboard("{Control>}");
  await user.click(twinTails);
  await user.keyboard("{/Control}");
  expect(screen.getByText("2件を選択中")).toBeInTheDocument();
  fireEvent.click(screen.getByText("ponytail"), { shiftKey: true });
  expect(screen.getByText("2件を選択中")).toBeInTheDocument();
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
