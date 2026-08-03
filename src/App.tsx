import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type Modifier,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { getEventCoordinates } from "@dnd-kit/utilities";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FileJson,
  Filter,
  FolderOpen,
  Moon,
  Redo2,
  Search,
  Settings,
  Sun,
  Undo2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CategoryTree } from "./components/CategoryTree";
import { KanbanLane } from "./components/Kanban";
import { PreviewDialog } from "./components/PreviewDialog";
import {
  duplicateMap,
  isSafeOutputFileName,
  outputFileName,
  parseCatalogFile,
  serializeCatalog,
  summarizeChanges,
  validateCatalog,
} from "./domain/catalog";
import { sortedChildren } from "./domain/operations";
import type { CategoryLevel, CategoryNode, TagOccurrence } from "./domain/types";
import { demoDocument } from "./demoCatalog";
import { isDirty, useCatalogStore } from "./store/catalogStore";

const snapOverlayCenterToCursor: Modifier = ({ activatorEvent, draggingNodeRect, transform }) => {
  if (!activatorEvent || !draggingNodeRect) return transform;
  const coordinates = getEventCoordinates(activatorEvent);
  if (!coordinates) return transform;
  return {
    ...transform,
    x: transform.x + coordinates.x - draggingNodeRect.left - draggingNodeRect.width / 2,
    y: transform.y + coordinates.y - draggingNodeRect.top - draggingNodeRect.height / 2,
  };
};

function downloadFile(
  document: NonNullable<ReturnType<typeof useCatalogStore.getState>["document"]>,
  name: string,
): void {
  if (!isSafeOutputFileName(document.fileName, name)) {
    throw new Error("元のカタログとは異なる安全なファイル名を指定してください。");
  }
  const blob = new Blob([serializeCatalog(document)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function useKeyboardShortcuts(): void {
  const undo = useCatalogStore((state) => state.undo);
  const redo = useCatalogStore((state) => state.redo);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLocaleLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
      if (event.key.toLocaleLowerCase() === "y") {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [undo, redo]);
}

export function App() {
  const store = useCatalogStore();
  const fileInput = useRef<HTMLInputElement>(null);
  const laneScroller = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [activeDrag, setActiveDrag] = useState<{ type: "tag" | "category"; id: string } | null>(null);
  const [overCategoryId, setOverCategoryId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  useKeyboardShortcuts();

  useEffect(() => {
    if (!store.document) store.load(demoDocument);
  }, [store]);
  const dirty = isDirty(store);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const document = store.document;
  const baseline = store.baseline;
  const selected = useMemo(() => new Set(store.selectedTagIds), [store.selectedTagIds]);
  const duplicates = useMemo(() => (document ? duplicateMap(document.tags) : new Map()), [document]);
  const duplicateCounts = useMemo(
    () => new Map([...duplicates].map(([key, value]) => [key, value.length])),
    [duplicates],
  );
  const tagChangeLabels = useMemo(() => {
    const labels = new Map<string, string>();
    if (!document || !baseline) return labels;
    const beforeTags = new Map(baseline.tags.map((tag) => [tag.uid, tag]));
    const touched = new Set(store.touchedTagIds);
    for (const tag of document.tags) {
      const before = beforeTags.get(tag.uid);
      if (!before) {
        labels.set(tag.uid, "追加済み");
        continue;
      }
      if (!touched.has(tag.uid)) continue;
      const changes: string[] = [];
      if (before.categoryId !== tag.categoryId || before.order !== tag.order) changes.push("移動済み");
      if (before.prompt !== tag.prompt || before.translationJa !== tag.translationJa)
        changes.push("編集済み");
      if (changes.length) labels.set(tag.uid, changes.join("・"));
    }
    return labels;
  }, [baseline, document, store.touchedTagIds]);
  const changedCategoryIds = useMemo(() => {
    const changed = new Set<string>();
    if (!document || !baseline) return changed;
    const beforeCategories = new Map(baseline.categories.map((category) => [category.id, category]));
    const touched = new Set(store.touchedCategoryIds);
    for (const category of document.categories) {
      const before = beforeCategories.get(category.id);
      if (!before) {
        changed.add(category.id);
        continue;
      }
      if (
        touched.has(category.id) &&
        (before.level !== category.level ||
          before.parentId !== category.parentId ||
          before.order !== category.order ||
          before.labelJa !== category.labelJa ||
          before.labelEn !== category.labelEn)
      )
        changed.add(category.id);
    }
    return changed;
  }, [baseline, document, store.touchedCategoryIds]);
  const smallCategories = useMemo(
    () =>
      document && store.selectedMediumId
        ? sortedChildren(document.categories, store.selectedMediumId, "small")
        : [],
    [document, store.selectedMediumId],
  );
  const issues = document ? validateCatalog(document) : [];
  const summary =
    document && baseline
      ? summarizeChanges(baseline, document)
      : {
          movedTags: 0,
          addedTags: 0,
          deletedTags: 0,
          renamedTags: 0,
          changedCategories: 0,
          duplicateDelta: 0,
        };
  const outputName = document ? outputFileName(document.fileName) : "catalog_edited.json";

  if (!document || !baseline) return <main className="loading-screen">カタログを準備しています…</main>;

  const confirmDiscard = () =>
    !dirty || window.confirm("未保存の変更があります。破棄して別ファイルを読み込みますか？");
  const openFile = async (file?: File) => {
    if (!file || !confirmDiscard()) return;
    try {
      const parsed = await parseCatalogFile(file);
      store.load(parsed);
      setToast(`${file.name} を読み込みました`);
    } catch (error) {
      store.setError(error instanceof Error ? error.message : "ファイルを読み込めませんでした。");
    }
  };
  const onExport = () => {
    if (issues.some((issue) => issue.severity === "error")) return;
    try {
      downloadFile(document, outputName);
      setPreviewOpen(false);
      setToast(`${outputName} を書き出しました`);
    } catch (error) {
      store.setError(error instanceof Error ? error.message : "ファイルを書き出せませんでした。");
    }
  };
  const scrollLanes = (direction: -1 | 1) => {
    const scroller = laneScroller.current;
    if (!scroller) return;
    scroller.scrollBy({ left: direction * Math.max(scroller.clientWidth * 0.8, 280), behavior: "smooth" });
  };
  const onDragStart = (event: DragStartEvent) => {
    const type = event.active.data.current?.type;
    const id =
      type === "tag"
        ? String(event.active.data.current?.tagId)
        : String(event.active.data.current?.categoryId);
    if (type === "tag" && !selected.has(id)) store.selectTag(id, "single", [id]);
    if (type === "tag" || type === "category") setActiveDrag({ type, id });
  };
  const onDragOver = (event: DragOverEvent) => {
    const categoryId = event.over?.data.current?.categoryId as string | undefined;
    setOverCategoryId(categoryId ?? null);
    if (activeDrag?.type === "tag" && categoryId) {
      const category = document.categories.find((item) => item.id === categoryId);
      if (category && category.level !== "small") store.toggleExpanded(category.id, true);
    }
  };
  const onDragEnd = (event: DragEndEvent) => {
    const activeType = event.active.data.current?.type;
    const overData = event.over?.data.current;
    try {
      if (activeType === "tag" && overData?.categoryId) {
        const target = document.categories.find((item) => item.id === overData.categoryId);
        if (target?.level !== "small")
          throw new Error("大・中分類を展開し、移動先の小分類へドロップしてください。");
        store.applyTagMove(target.id, overData.type === "tag-target" ? String(overData.tagId) : undefined);
        setToast(`${store.selectedTagIds.length || 1}件のタグを ${target.labelJa} へ移動しました`);
      } else if (activeType === "category") {
        const activeId = String(event.active.data.current?.categoryId);
        if (overData?.type === "category-level-target" && overData.targetLevel === "major") {
          if (document.categories.some((item) => item.parentId === activeId)) {
            throw new Error("配下カテゴリがあります。先に子分類を別の分類へ移動してください。");
          }
          store.applyCategoryLevelChange(activeId, "major");
          setToast("中分類を大分類へ変更しました");
        } else if (overData?.categoryId) {
          const activeCategory = document.categories.find((item) => item.id === activeId);
          const overCategory = document.categories.find((item) => item.id === overData.categoryId);
          if (
            activeCategory?.level === "major" &&
            overCategory?.level === "medium" &&
            document.categories.some((item) => item.parentId === activeId)
          ) {
            throw new Error("配下カテゴリがあります。先に子分類を別の分類へ移動してください。");
          }
          store.applyCategoryMove(activeId, String(overData.categoryId));
          setToast(
            activeCategory?.level === "major" && overCategory?.level === "medium"
              ? "大分類を中分類へ変更しました"
              : "カテゴリ階層を更新しました",
          );
        }
      }
    } catch (error) {
      store.setError(error instanceof Error ? error.message : "移動できませんでした。");
    }
    setActiveDrag(null);
    setOverCategoryId(null);
  };
  const editTag = (tag: TagOccurrence) => {
    const prompt = window.prompt("タグ名を編集", tag.prompt);
    if (prompt === null) return;
    const ja = window.prompt("日本語訳を編集", tag.translationJa);
    if (ja === null) return;
    store.editTag(tag.uid, prompt, ja);
  };
  const editCategory = (category: CategoryNode) => {
    const labelJa = window.prompt("カテゴリ名を編集", category.labelJa);
    if (labelJa === null) return;
    const labelEn = window.prompt("英語名を編集", category.labelEn);
    if (labelEn === null) return;
    store.editCategory(category.id, labelJa, labelEn);
  };
  const addTags = (categoryId: string) => {
    const input = window.prompt("追加するタグを改行またはカンマ区切りで入力してください。");
    if (!input) return;
    store.createTags(categoryId, input.split(/[\n,]/u));
  };
  const addCategory = () => {
    const level = window.prompt(
      "分類レベルを入力してください: major / medium / small",
      "small",
    ) as CategoryLevel | null;
    if (!level || !["major", "medium", "small"].includes(level)) return;
    const parentId =
      level === "major"
        ? ""
        : (window.prompt(
            "親カテゴリID",
            level === "small"
              ? (store.selectedMediumId ?? "")
              : (document.categories.find((item) => item.level === "major")?.id ?? ""),
          ) ?? "");
    const name = window.prompt("日本語カテゴリ名", "新しいカテゴリ");
    if (name) store.createCategory(level, parentId, name);
  };

  const selectedTags = document.tags.filter((tag) => selected.has(tag.uid));
  return (
    <div className={`app-shell theme-${theme}`}>
      <header className="app-toolbar">
        <div className="app-title">
          <FileJson />
          <strong>Prompt Workbench Tag Editor</strong>
          <span>{document.fileName}</span>
          {dirty && (
            <span className="unsaved">
              <AlertTriangle />
              未保存の変更あり
            </span>
          )}
        </div>
        <div className="toolbar-actions">
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(event) => void openFile(event.target.files?.[0])}
          />
          <button type="button" onClick={() => fileInput.current?.click()}>
            <FolderOpen />
            ファイルを開く
          </button>
          <button type="button" onClick={store.undo} disabled={!store.history.length} aria-label="元に戻す">
            <Undo2 />
            元に戻す
          </button>
          <button type="button" onClick={store.redo} disabled={!store.future.length} aria-label="やり直す">
            <Redo2 />
            やり直す
          </button>
          <label className="search-control global-search">
            <Search />
            <input
              value={store.globalQuery}
              onChange={(event) => store.setGlobalQuery(event.target.value)}
              placeholder="タグを横断検索"
              aria-label="タグを横断検索"
            />
            {store.globalQuery && (
              <button type="button" onClick={() => store.setGlobalQuery("")} aria-label="検索を消去">
                <X />
              </button>
            )}
          </label>
          <button
            className="icon-button"
            type="button"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label="テーマを切り替え"
          >
            {theme === "dark" ? <Sun /> : <Moon />}
          </button>
          <button className="icon-button" type="button" aria-label="設定">
            <Settings />
          </button>
          <button className="primary-button" type="button" onClick={() => setPreviewOpen(true)}>
            <Download />
            新しいファイルとして書き出す
          </button>
        </div>
      </header>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setActiveDrag(null);
          setOverCategoryId(null);
        }}
      >
        <div className="workspace">
          <CategoryTree
            categories={document.categories}
            tags={document.tags}
            expandedIds={new Set(store.expandedCategoryIds)}
            selectedMediumId={store.selectedMediumId}
            query={store.categoryQuery}
            dragMode={activeDrag?.type ?? null}
            activeCategoryLevel={
              activeDrag?.type === "category"
                ? (document.categories.find((item) => item.id === activeDrag.id)?.level ?? null)
                : null
            }
            activeCategoryId={activeDrag?.type === "category" ? activeDrag.id : null}
            overCategoryId={overCategoryId}
            changedCategoryIds={changedCategoryIds}
            onQuery={store.setCategoryQuery}
            onToggle={store.toggleExpanded}
            onSelectMedium={store.setSelectedMedium}
            onEditCategory={editCategory}
            onAddCategory={addCategory}
            onExpandAll={store.expandAll}
          />
          <main className="kanban-workspace">
            <div className="workspace-controls">
              <label>
                並び替え：
                <select>
                  <option>日本語名（昇順）</option>
                  <option>元の順序</option>
                </select>
                <ChevronDown />
              </label>
              <label>
                表示：
                <select>
                  <option>すべてのタグ</option>
                  <option>選択中のみ</option>
                </select>
                <ChevronDown />
              </label>
              <button
                className={store.showDuplicatesOnly ? "is-active" : ""}
                type="button"
                onClick={() => store.setDuplicateFilter(!store.showDuplicatesOnly)}
              >
                <Filter />
                重複タグのみ
              </button>
              <span className="workspace-status">
                {document.tags.length.toLocaleString()} タグ / {document.categories.length} カテゴリ
              </span>
              {smallCategories.length > 4 && (
                <div className="lane-navigation" aria-label="小分類レーンの横移動">
                  <span>小分類 {smallCategories.length}件</span>
                  <button type="button" onClick={() => scrollLanes(-1)} aria-label="小分類を左へスクロール">
                    <ChevronLeft />
                  </button>
                  <button type="button" onClick={() => scrollLanes(1)} aria-label="小分類を右へスクロール">
                    <ChevronRight />
                  </button>
                </div>
              )}
            </div>
            {smallCategories.length ? (
              <div
                ref={laneScroller}
                className="kanban-grid"
                tabIndex={0}
                aria-label={`${smallCategories.length}件の小分類レーン。横方向にスクロールできます`}
              >
                {smallCategories.map((category, index) => (
                  <KanbanLane
                    key={category.id}
                    category={category}
                    tags={document.tags.filter((tag) => tag.categoryId === category.id)}
                    selectedIds={selected}
                    duplicateCounts={duplicateCounts}
                    changeLabels={tagChangeLabels}
                    laneIndex={index}
                    query={store.globalQuery}
                    showDuplicatesOnly={store.showDuplicatesOnly}
                    showSelectedOnly={store.showSelectedOnly}
                    onSelect={store.selectTag}
                    onSelectAll={store.selectMany}
                    onEdit={editTag}
                    onAdd={addTags}
                  />
                ))}
              </div>
            ) : (
              <div className="workspace-empty">
                <strong>小分類がありません</strong>
                <p>左のツリーで別の中分類を選ぶか、小分類を追加してください。</p>
              </div>
            )}
          </main>
        </div>
        <DragOverlay
          dropAnimation={null}
          modifiers={activeDrag?.type === "category" ? [snapOverlayCenterToCursor] : undefined}
        >
          {activeDrag && (
            <div className={`drag-overlay ${activeDrag.type}`}>
              <strong>
                {activeDrag.type === "tag"
                  ? `${Math.max(store.selectedTagIds.length, 1)}件を移動`
                  : (document.categories.find((item) => item.id === activeDrag.id)?.labelJa ??
                    "カテゴリを移動")}
              </strong>
              {activeDrag.type === "tag" &&
                selectedTags.slice(0, 4).map((tag) => <span key={tag.uid}>{tag.prompt}</span>)}
            </div>
          )}
        </DragOverlay>
      </DndContext>
      {store.error && (
        <div className="error-toast" role="alert">
          <AlertTriangle />
          {store.error}
          <button type="button" onClick={() => store.setError(null)} aria-label="閉じる">
            <X />
          </button>
        </div>
      )}
      {toast && (
        <div className="success-toast" role="status">
          <CheckCircle2 />
          {toast}
        </div>
      )}
      <PreviewDialog
        open={previewOpen}
        fileName={outputName}
        summary={summary}
        issues={issues}
        onClose={() => setPreviewOpen(false)}
        onExport={onExport}
      />
    </div>
  );
}
