import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
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
  MoveRight,
  Redo2,
  Save,
  Search,
  Settings,
  Star,
  Sun,
  Trash2,
  Undo2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  createDragSoundController,
  readDragSoundPreference,
  writeDragSoundPreference,
} from "./audio/dragSounds";
import { CategoryTree } from "./components/CategoryTree";
import { KanbanLane } from "./components/Kanban";
import { PreviewDialog } from "./components/PreviewDialog";
import {
  DEFAULT_CATALOG_FILE_NAME,
  duplicateMap,
  isSafeOutputFileName,
  outputFileName,
  parseCatalogFile,
  serializeCatalog,
  summarizeChanges,
  validateCatalog,
} from "./domain/catalog";
import { categoryPath, sortedChildren } from "./domain/operations";
import {
  favoriteTagKey,
  readFavoriteSettings,
  toggleFavorite,
  writeFavoriteSettings,
} from "./domain/favorites";
import type { CategoryNode, TagOccurrence } from "./domain/types";
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

interface ToastState {
  message: string;
  detail?: string;
  undoable?: boolean;
}

interface TrailVector {
  x: number;
  y: number;
  visible: boolean;
}

interface MoveMenuState {
  tagIds: string[];
  anchorTagId: string;
  x: number;
  y: number;
}

type SaveMode = "overwrite" | "saveAs";

interface CatalogWritable {
  write: (data: string) => Promise<void>;
  close: () => Promise<void>;
  abort?: () => Promise<void>;
}

interface CatalogFileHandle {
  name: string;
  displayPath?: string;
  path?: string;
  fullPath?: string;
  getFile: () => Promise<File>;
  createWritable: () => Promise<CatalogWritable>;
}

type CatalogFileWithPath = File & {
  path?: string;
  fullPath?: string;
  webkitRelativePath?: string;
};

interface CatalogPickerOptions {
  id: string;
  suggestedName?: string;
  startIn?: CatalogFileHandle;
  multiple?: boolean;
  types: Array<{
    description: string;
    accept: Record<string, string[]>;
  }>;
}

type CatalogWindow = Window & {
  showOpenFilePicker?: (options: CatalogPickerOptions) => Promise<CatalogFileHandle[]>;
  showSaveFilePicker?: (options: CatalogPickerOptions) => Promise<CatalogFileHandle>;
};

const CATALOG_FILE_PICKER_ID = "prompt-workbench-catalog-save";
const CATALOG_FILE_PICKER_TYPES = [
  {
    description: "JSONタグファイル",
    accept: { "application/json": [".json"] },
  },
];

function catalogHandlePath(handle: CatalogFileHandle | null): string | undefined {
  return handle?.displayPath ?? handle?.fullPath ?? handle?.path;
}

function catalogFilePath(file: File, handle: CatalogFileHandle | null): string | undefined {
  const fileWithPath = file as CatalogFileWithPath;
  return catalogHandlePath(handle) ?? fileWithPath.fullPath ?? fileWithPath.path ?? fileWithPath.webkitRelativePath;
}

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

async function writeCatalogFile(
  handle: CatalogFileHandle,
  document: NonNullable<ReturnType<typeof useCatalogStore.getState>["document"]>,
): Promise<void> {
  const writable = await handle.createWritable();
  try {
    await writable.write(serializeCatalog(document));
    await writable.close();
  } catch (error) {
    await writable.abort?.().catch(() => undefined);
    throw error;
  }
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
  const appShellRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const laneScroller = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [soundEnabled, setSoundEnabled] = useState(readDragSoundPreference);
  const [favoriteTags, setFavoriteTags] = useState(() => readFavoriteSettings().favorites);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bulkDeleteArmed, setBulkDeleteArmed] = useState(false);
  const [saveMode, setSaveMode] = useState<SaveMode | null>(null);
  const [currentCatalogFileHandle, setCurrentCatalogFileHandle] = useState<CatalogFileHandle | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeDrag, setActiveDrag] = useState<{ type: "tag" | "category"; id: string } | null>(null);
  const [overCategoryId, setOverCategoryId] = useState<string | null>(null);
  const [overTreeCategoryId, setOverTreeCategoryId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [trailVector, setTrailVector] = useState<TrailVector>({ x: 0, y: 0, visible: false });
  const [recentlyMovedTagIds, setRecentlyMovedTagIds] = useState<string[]>([]);
  const [moveMenu, setMoveMenu] = useState<MoveMenuState | null>(null);
  const [moveDestinationQuery, setMoveDestinationQuery] = useState("");
  const [pendingRevealTagId, setPendingRevealTagId] = useState<string | null>(null);
  const moveMenuRef = useRef<HTMLDivElement>(null);
  const moveSearchRef = useRef<HTMLInputElement>(null);
  const previousDragDelta = useRef({ x: 0, y: 0 });
  const pendingTrailVector = useRef({ x: 0, y: 0 });
  const trailFrame = useRef<number | null>(null);
  const trailTimer = useRef<number | null>(null);
  const recentMoveTimer = useRef<number | null>(null);
  const dragSounds = useRef(createDragSoundController());
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
    const timer = window.setTimeout(() => setToast(null), toast.undoable ? 4000 : 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(
    () => () => {
      if (trailFrame.current !== null) window.cancelAnimationFrame(trailFrame.current);
      if (trailTimer.current !== null) window.clearTimeout(trailTimer.current);
      if (recentMoveTimer.current !== null) window.clearTimeout(recentMoveTimer.current);
    },
    [],
  );

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
  const outputName = document ? outputFileName(document.fileName) : "catalog.json";
  const focusedCategoryId = useMemo(() => {
    const tagId = activeDrag?.type === "tag" ? activeDrag.id : store.anchorTagId;
    return tagId ? (document?.tags.find((tag) => tag.uid === tagId)?.categoryId ?? null) : null;
  }, [activeDrag, document, store.anchorTagId]);
  const recentlyMoved = useMemo(() => new Set(recentlyMovedTagIds), [recentlyMovedTagIds]);
  const favoriteTagKeys = useMemo(() => new Set(favoriteTags), [favoriteTags]);
  const validTagTarget = useMemo(() => {
    if (activeDrag?.type !== "tag" || !overCategoryId || !document) return false;
    return document.categories.some(
      (category) => category.id === overCategoryId && category.level === "small",
    );
  }, [activeDrag, document, overCategoryId]);
  const normalizedGlobalQuery = store.globalQuery.trim().toLocaleLowerCase();
  const globalSearchResults = useMemo(() => {
    if (!document || !normalizedGlobalQuery) return [];
    return document.tags.filter((tag) => {
      const matches = `${tag.prompt} ${tag.translationJa} ${tag.aliases.join(" ")}`
        .toLocaleLowerCase()
        .includes(normalizedGlobalQuery);
      return (
        matches &&
        (!store.showDuplicatesOnly ||
          (duplicateCounts.get(tag.prompt.toLocaleLowerCase()) ?? 0) > 1) &&
        (!store.showSelectedOnly || selected.has(tag.uid))
        && (!store.showFavoritesOnly || favoriteTagKeys.has(favoriteTagKey(tag.prompt)))
      );
    });
  }, [
    document,
    duplicateCounts,
    favoriteTagKeys,
    normalizedGlobalQuery,
    selected,
    store.showDuplicatesOnly,
    store.showFavoritesOnly,
    store.showSelectedOnly,
  ]);
  const smallCategoryDestinations = useMemo(() => {
    if (!document) return [];
    const query = moveDestinationQuery.trim().toLocaleLowerCase();
    return sortedChildren(document.categories, "", "major").flatMap((major) =>
      sortedChildren(document.categories, major.id, "medium").flatMap((medium) =>
        sortedChildren(document.categories, medium.id, "small")
          .map((category) => ({ category, path: [major, medium, category] }))
          .filter(
            ({ path }) =>
              !query ||
              path.some((category) =>
                `${category.labelJa} ${category.labelEn}`.toLocaleLowerCase().includes(query),
              ),
          ),
      ),
    );
  }, [document, moveDestinationQuery]);

  useEffect(() => {
    if (!moveMenu) return;
    moveSearchRef.current?.focus();
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!moveMenuRef.current?.contains(event.target as Node)) setMoveMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoveMenu(null);
    };
    window.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [moveMenu]);

  useEffect(() => {
    if (!pendingRevealTagId || normalizedGlobalQuery) return;
    const timer = window.setTimeout(() => {
      const row = window.document.querySelector<HTMLElement>(`[data-tag-id="${CSS.escape(pendingRevealTagId)}"]`);
      if (!row) return;
      row.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
      row.focus({ preventScroll: true });
      setPendingRevealTagId(null);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [normalizedGlobalQuery, pendingRevealTagId, store.selectedMediumId]);

  if (!document || !baseline) return <main className="loading-screen">カタログを準備しています…</main>;

  const catalogWindow = window as CatalogWindow;
  const isDefaultCatalogFile =
    document.fileName.trim().toLocaleLowerCase() === DEFAULT_CATALOG_FILE_NAME.toLocaleLowerCase();
  const canOverwriteCurrentFile =
    Boolean(currentCatalogFileHandle) ||
    (!isDefaultCatalogFile && Boolean(catalogWindow.showSaveFilePicker));
  const needsLocalhostForOverwrite =
    !isDefaultCatalogFile &&
    !currentCatalogFileHandle &&
    !catalogWindow.showSaveFilePicker &&
    !window.isSecureContext &&
    window.location.hostname !== "localhost";
  const localhostUrl = `${window.location.protocol}//localhost${window.location.port ? `:${window.location.port}` : ""}${window.location.pathname}${window.location.search}${window.location.hash}`;
  const moveMenuAnchorTag = moveMenu
    ? document.tags.find((tag) => tag.uid === moveMenu.anchorTagId) ?? null
    : null;
  const moveMenuAnchorFavorite = moveMenuAnchorTag
    ? favoriteTagKeys.has(favoriteTagKey(moveMenuAnchorTag.prompt))
    : false;

  const confirmDiscard = () =>
    !dirty || window.confirm("未保存の変更があります。破棄して別ファイルを読み込みますか？");
  const loadSelectedFile = async (file?: File, fileHandle: CatalogFileHandle | null = null) => {
    if (!file) return;
    try {
      const parsed = await parseCatalogFile(file, catalogFilePath(file, fileHandle));
      store.load(parsed);
      setCurrentCatalogFileHandle(fileHandle);
      setToast({ message: `${file.name} を読み込みました` });
    } catch (error) {
      store.setError(error instanceof Error ? error.message : "ファイルを読み込めませんでした。");
    }
  };
  const openCatalogFile = async () => {
    if (!confirmDiscard()) return;
    const catalogWindow = window as CatalogWindow;
    if (!catalogWindow.showOpenFilePicker) {
      if (fileInput.current) fileInput.current.value = "";
      fileInput.current?.click();
      return;
    }
    try {
      const [fileHandle] = await catalogWindow.showOpenFilePicker({
        id: CATALOG_FILE_PICKER_ID,
        multiple: false,
        types: CATALOG_FILE_PICKER_TYPES,
      });
      await loadSelectedFile(await fileHandle.getFile(), fileHandle);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setToast({ message: "読み込みをキャンセルしました" });
        return;
      }
      store.setError(error instanceof Error ? error.message : "ファイルを読み込めませんでした。");
    }
  };
  const saveAsNewFile = async () => {
    setSaving(true);
    try {
      const catalogWindow = window as CatalogWindow;
      if (catalogWindow.showSaveFilePicker) {
        const pickerOptions: CatalogPickerOptions = {
          id: CATALOG_FILE_PICKER_ID,
          suggestedName: outputName,
          types: CATALOG_FILE_PICKER_TYPES,
        };
        if (currentCatalogFileHandle) pickerOptions.startIn = currentCatalogFileHandle;
        const savedFileHandle = await catalogWindow.showSaveFilePicker(pickerOptions);
        await writeCatalogFile(savedFileHandle, document);
        setCurrentCatalogFileHandle(savedFileHandle);
        store.markSaved(savedFileHandle.name, catalogHandlePath(savedFileHandle));
        setToast({ message: `${savedFileHandle.name} に別名保存しました` });
      } else {
        downloadFile(document, outputName);
        setCurrentCatalogFileHandle(null);
        store.markSaved(outputName);
        setToast({ message: `${outputName} をダウンロードしました` });
      }
      setSaveMode(null);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setToast({ message: "別名保存をキャンセルしました" });
        return;
      }
      store.setError(error instanceof Error ? error.message : "ファイルを保存できませんでした。");
    } finally {
      setSaving(false);
    }
  };
  const overwriteCurrentFile = async () => {
    let overwriteHandle = currentCatalogFileHandle;
    if (!overwriteHandle && !isDefaultCatalogFile && catalogWindow.showSaveFilePicker) {
      try {
        overwriteHandle = await catalogWindow.showSaveFilePicker({
          id: CATALOG_FILE_PICKER_ID,
          suggestedName: document.fileName,
          types: CATALOG_FILE_PICKER_TYPES,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          setToast({ message: "上書き保存をキャンセルしました" });
          return;
        }
        store.setError(error instanceof Error ? error.message : "保存先を選択できませんでした。");
        return;
      }
    }
    if (!overwriteHandle) {
      store.setError("このファイルは上書きできません。別名で保存してください。");
      return;
    }
    if (!window.confirm(`${overwriteHandle.name} を上書き保存しますか？`)) {
      setToast({ message: "上書き保存をキャンセルしました" });
      return;
    }
    setSaving(true);
    try {
      await writeCatalogFile(overwriteHandle, document);
      setCurrentCatalogFileHandle(overwriteHandle);
      store.markSaved(overwriteHandle.name, catalogHandlePath(overwriteHandle) ?? document.filePath);
      store.clearSelection();
      setSaveMode(null);
      setToast({ message: `${overwriteHandle.name} を上書き保存しました` });
    } catch (error) {
      store.setError(error instanceof Error ? error.message : "ファイルを上書き保存できませんでした。");
    } finally {
      setSaving(false);
    }
  };
  const saveCatalog = () => {
    if (issues.some((issue) => issue.severity === "error")) return;
    if (saveMode === "overwrite") void overwriteCurrentFile();
    else if (saveMode === "saveAs") void saveAsNewFile();
  };
  const scrollLanes = (direction: -1 | 1) => {
    const scroller = laneScroller.current;
    if (!scroller) return;
    scroller.scrollBy({ left: direction * Math.max(scroller.clientWidth * 0.8, 280), behavior: "smooth" });
  };
  const showMoveMenu = (tag: TagOccurrence, point: { x: number; y: number }) => {
    const tagIds = selected.has(tag.uid) ? [...store.selectedTagIds] : [tag.uid];
    if (!selected.has(tag.uid)) store.selectTag(tag.uid, "single", [tag.uid]);
    setMoveDestinationQuery("");
    setMoveMenu({
      tagIds,
      anchorTagId: tag.uid,
      x: Math.max(8, Math.min(point.x, window.innerWidth - 376)),
      y: Math.max(8, Math.min(point.y, window.innerHeight - 436)),
    });
  };
  const moveTagsFromMenu = (target: CategoryNode) => {
    if (!moveMenu) return;
    store.selectMany(moveMenu.tagIds);
    store.applyTagMove(target.id);
    setRecentlyMovedTagIds(moveMenu.tagIds);
    store.clearSelection();
    if (recentMoveTimer.current !== null) window.clearTimeout(recentMoveTimer.current);
    recentMoveTimer.current = window.setTimeout(() => setRecentlyMovedTagIds([]), 600);
    setToast({
      message: "タグを移動しました",
      detail: `${moveMenu.tagIds.length}件を ${target.labelJa} の末尾へ移動`,
      undoable: true,
    });
    setMoveMenu(null);
  };
  const revealSearchResult = (tag: TagOccurrence) => {
    const path = categoryPath(document.categories, tag.categoryId);
    const major = path.find((category) => category.level === "major");
    const medium = path.find((category) => category.level === "medium");
    if (major) store.toggleExpanded(major.id, true);
    if (medium) {
      store.toggleExpanded(medium.id, true);
      store.setSelectedMedium(medium.id);
    }
    store.setDuplicateFilter(false);
    store.selectTag(tag.uid, "single", [tag.uid]);
    setPendingRevealTagId(tag.uid);
    store.setGlobalQuery("");
  };
  const onDragStart = (event: DragStartEvent) => {
    const type = event.active.data.current?.type;
    const id =
      type === "tag"
        ? String(event.active.data.current?.tagId)
        : String(event.active.data.current?.categoryId);
    if (type === "tag" && !selected.has(id)) store.selectTag(id, "single", [id]);
    if (type === "tag" || type === "category") setActiveDrag({ type, id });
    previousDragDelta.current = { x: 0, y: 0 };
    setTrailVector({ x: 0, y: 0, visible: false });
    dragSounds.current.start(soundEnabled);
  };
  const onDragMove = (event: DragMoveEvent) => {
    if (event.active.data.current?.type !== "tag") return;
    const deltaX = event.delta.x - previousDragDelta.current.x;
    const deltaY = event.delta.y - previousDragDelta.current.y;
    previousDragDelta.current = event.delta;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance < 0.5) return;
    const scale = Math.min(12 / distance, 1);
    pendingTrailVector.current = {
      x: Math.round(-deltaX * scale),
      y: Math.round(-deltaY * scale),
    };
    if (trailFrame.current === null) {
      trailFrame.current = window.requestAnimationFrame(() => {
        setTrailVector({ ...pendingTrailVector.current, visible: true });
        trailFrame.current = null;
      });
    }
    if (trailTimer.current !== null) window.clearTimeout(trailTimer.current);
    trailTimer.current = window.setTimeout(
      () => setTrailVector((current) => ({ ...current, visible: false })),
      200,
    );
  };
  const onDragOver = (event: DragOverEvent) => {
    const categoryId = event.over?.data.current?.categoryId as string | undefined;
    const overData = event.over?.data.current;
    const activeType = event.active.data.current?.type;
    const activeId =
      activeType === "tag"
        ? String(event.active.data.current?.tagId)
        : String(event.active.data.current?.categoryId);
    const target = categoryId ? document.categories.find((item) => item.id === categoryId) : undefined;
    const validSoundTarget =
      activeType === "tag"
        ? target?.level === "small"
        : activeType === "category" && overData?.type === "category-level-target"
          ? `${String(event.over?.id)}:major-root`
          : activeType === "category" && categoryId && categoryId !== activeId
            ? `${String(event.over?.id)}:${target?.level ?? "unknown"}`
            : null;
    dragSounds.current.moveTo(
      typeof validSoundTarget === "string"
        ? validSoundTarget
        : validSoundTarget
          ? String(event.over?.id)
          : null,
      soundEnabled,
    );
    setOverCategoryId(categoryId ?? null);
    setOverTreeCategoryId(
      String(event.over?.id ?? "").startsWith("tree-category:") ? (categoryId ?? null) : null,
    );
    if (activeDrag?.type === "tag" && categoryId) {
      const category = document.categories.find((item) => item.id === categoryId);
      if (category && category.level !== "small") store.toggleExpanded(category.id, true);
    }
    if (activeType === "category" && categoryId) {
      const activeCategory = document.categories.find((item) => item.id === activeId);
      if (activeCategory?.level === "medium" && target?.level === "major") {
        store.toggleExpanded(target.id, true);
      }
    }
  };
  const onDragEnd = (event: DragEndEvent) => {
    const activeType = event.active.data.current?.type;
    const overData = event.over?.data.current;
    let successful = false;
    try {
      if (activeType === "tag" && overData?.categoryId) {
        const target = document.categories.find((item) => item.id === overData.categoryId);
        if (target?.level !== "small")
          throw new Error("大・中分類を展開し、移動先の小分類へドロップしてください。");
        const movedTagIds = store.selectedTagIds.length
          ? [...store.selectedTagIds]
          : [String(event.active.data.current?.tagId)];
        store.applyTagMove(target.id, overData.type === "tag-target" ? String(overData.tagId) : undefined);
        setRecentlyMovedTagIds(movedTagIds);
        if (recentMoveTimer.current !== null) window.clearTimeout(recentMoveTimer.current);
        recentMoveTimer.current = window.setTimeout(() => setRecentlyMovedTagIds([]), 600);
        setToast({
          message: "タグを移動しました",
          detail: `${movedTagIds.length}件を ${target.labelJa} へ移動`,
          undoable: true,
        });
        successful = true;
      } else if (activeType === "category") {
        const activeId = String(event.active.data.current?.categoryId);
        if (overData?.type === "category-level-target" && overData.targetLevel === "major") {
          if (document.categories.some((item) => item.parentId === activeId)) {
            throw new Error("配下カテゴリがあります。先に子分類を別の分類へ移動してください。");
          }
          store.applyCategoryLevelChange(activeId, "major");
          setToast({ message: "中分類を大分類へ変更しました" });
          successful = true;
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
          setToast({
            message:
              activeCategory?.level === "major" && overCategory?.level === "medium"
                ? "大分類を中分類へ変更しました"
                : activeCategory?.level === "medium" && overCategory?.level === "major"
                  ? "中分類を移動しました"
                : "カテゴリ階層を更新しました",
            detail:
              activeCategory?.level === "medium" && overCategory?.level === "major"
                ? `${activeCategory.labelJa} を ${overCategory.labelJa} の末尾へ移動`
                : undefined,
          });
          successful = true;
        }
      }
    } catch (error) {
      store.setError(error instanceof Error ? error.message : "移動できませんでした。");
    }
    setActiveDrag(null);
    setOverCategoryId(null);
    setOverTreeCategoryId(null);
    setTrailVector((current) => ({ ...current, visible: false }));
    dragSounds.current.finish(successful, soundEnabled);
  };
  const cancelDrag = () => {
    setActiveDrag(null);
    setOverCategoryId(null);
    setOverTreeCategoryId(null);
    setTrailVector((current) => ({ ...current, visible: false }));
    dragSounds.current.cancel();
  };
  const updateFavorites = (nextFavorites: string[]) => {
    setFavoriteTags(nextFavorites);
    writeFavoriteSettings({ favorites: nextFavorites });
  };
  const toggleTagFavorite = (tag: TagOccurrence) => {
    const next = toggleFavorite(favoriteTags, tag.prompt);
    updateFavorites(next);
    store.clearSelection();
    setToast({
      message: next.includes(favoriteTagKey(tag.prompt))
        ? "お気に入りに追加しました"
        : "お気に入りから削除しました",
    });
  };
  const editTag = (tag: TagOccurrence, prompt: string, translationJa: string) => {
    const oldKey = favoriteTagKey(tag.prompt);
    const newKey = favoriteTagKey(prompt);
    if (oldKey && newKey && oldKey !== newKey && favoriteTagKeys.has(oldKey)) {
      updateFavorites([...favoriteTags.filter((key) => key !== oldKey), newKey]);
    }
    store.editTag(tag.uid, prompt, translationJa);
  };
  const editCategory = (category: CategoryNode, labelJa: string, labelEn: string) => {
    store.editCategory(category.id, labelJa, labelEn);
  };
  const deleteTags = (uids: string[]) => {
    if (!uids.length) return;
    store.removeTags(uids);
    setRecentlyMovedTagIds((current) => current.filter((uid) => !uids.includes(uid)));
    setBulkDeleteArmed(false);
    setToast({
      message: uids.length === 1 ? "タグを削除しました" : `${uids.length}件のタグを削除しました`,
      detail: "保存前なら元に戻せます",
      undoable: true,
    });
  };
  const deleteCategory = (category: CategoryNode, descendantCount: number, tagCount: number) => {
    store.removeCategory(category.id, undefined, true);
    setToast({
      message: `${category.labelJa}を削除しました`,
      detail: `${descendantCount + 1}分類・${tagCount}タグを削除 / 保存前なら元に戻せます`,
      undoable: true,
    });
  };
  const addTags = (categoryId: string, values: string[]) => store.createTags(categoryId, values);
  const addCategory = (level: CategoryNode["level"], parentId: string, labelJa: string) =>
    store.createCategory(level, parentId, labelJa);

  const selectedTags = document.tags.filter((tag) => selected.has(tag.uid));
  return (
    <div ref={appShellRef} className={`app-shell theme-${theme}`}>
      <header className="app-toolbar">
        <div className="app-title">
          <FileJson />
          <strong>ComfyUI Prompt Workbench Tag Editor</strong>
          <span className="current-file-path" title={document.filePath ?? document.fileName}>
            {document.filePath ?? document.fileName}
          </span>
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
            onChange={(event) => void loadSelectedFile(event.target.files?.[0])}
          />
          <button type="button" onClick={() => void openCatalogFile()}>
            <FolderOpen />
            タグ設定ファイルを開く
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
          <div className="settings-control">
            <button
              className={`icon-button ${settingsOpen ? "is-active" : ""}`}
              type="button"
              aria-label="設定"
              aria-expanded={settingsOpen}
              aria-controls="editor-settings"
              onClick={() => setSettingsOpen((current) => !current)}
            >
              <Settings />
            </button>
            {settingsOpen && (
              <div id="editor-settings" className="settings-popover" role="dialog" aria-label="設定">
                <div>
                  <strong>操作音</strong>
                  <span>ドラッグの開始・移動・ドロップ</span>
                </div>
                <button
                  className="sound-toggle"
                  type="button"
                  role="switch"
                  aria-label="操作音"
                  aria-checked={soundEnabled}
                  onClick={() => {
                    const next = !soundEnabled;
                    setSoundEnabled(next);
                    writeDragSoundPreference(next);
                  }}
                >
                  {soundEnabled ? <Volume2 /> : <VolumeX />}
                  {soundEnabled ? "オン" : "オフ"}
                </button>
              </div>
            )}
          </div>
          <button
            className="save-button"
            type="button"
            disabled={!canOverwriteCurrentFile || saving}
            title={
              currentCatalogFileHandle
                ? `${currentCatalogFileHandle.name} を上書き保存`
                : canOverwriteCurrentFile
                  ? `${document.fileName} の保存先を確認して上書き保存`
                : "上書きできるファイルがありません。別名で保存してください"
            }
            onClick={() => setSaveMode("overwrite")}
          >
            <Save />
            上書き保存
          </button>
          {needsLocalhostForOverwrite && (
            <a className="localhost-save-link" href={localhostUrl} title="安全なローカルURLで開き直します">
              <AlertTriangle />
              localhostで開いて上書き
            </a>
          )}
          <button
            className="primary-button save-button"
            type="button"
            disabled={saving}
            onClick={() => setSaveMode("saveAs")}
          >
            <Download />
            別名で保存
          </button>
        </div>
      </header>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={cancelDrag}
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
            overCategoryId={overTreeCategoryId}
            changedCategoryIds={changedCategoryIds}
            onQuery={store.setCategoryQuery}
            onToggle={store.toggleExpanded}
            onSelectMedium={store.setSelectedMedium}
            onEditCategory={editCategory}
            onDeleteCategory={deleteCategory}
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
              <button
                className={store.showFavoritesOnly ? "is-active" : ""}
                type="button"
                onClick={() => store.setFavoriteFilter(!store.showFavoritesOnly)}
                aria-pressed={store.showFavoritesOnly}
              >
                <Star fill={store.showFavoritesOnly ? "currentColor" : "none"} />
                お気に入りのみ表示
              </button>
              <button
                type="button"
                disabled={store.selectedTagIds.length === 0}
                onClick={store.clearSelection}
                aria-label={
                  store.selectedTagIds.length > 0
                    ? `選択中のタグ${store.selectedTagIds.length}件をすべて解除`
                    : "選択をすべて解除"
                }
              >
                <X />
                選択をすべて解除
              </button>
              {store.selectedTagIds.length > 0 && (
                <div className={`bulk-delete-control ${bulkDeleteArmed ? "is-confirming" : ""}`}>
                  {bulkDeleteArmed ? (
                    <>
                      <span role="status">選択中{store.selectedTagIds.length}件を削除します</span>
                      <button
                        className="danger-button bulk-delete-confirm"
                        type="button"
                        onClick={() => deleteTags(store.selectedTagIds)}
                      >
                        <Trash2 />
                        削除を確定
                      </button>
                      <button type="button" onClick={() => setBulkDeleteArmed(false)}>
                        キャンセル
                      </button>
                    </>
                  ) : (
                    <button className="danger-button" type="button" onClick={() => setBulkDeleteArmed(true)}>
                      <Trash2 />
                      選択中{store.selectedTagIds.length}件を削除
                    </button>
                  )}
                </div>
              )}
              <span className="workspace-status">
                {document.tags.length.toLocaleString()} タグ / {document.categories.length} カテゴリ
              </span>
              {!normalizedGlobalQuery && smallCategories.length > 4 && (
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
            {normalizedGlobalQuery ? (
              <section className="global-search-results" aria-label="全タグの検索結果">
                <header>
                  <div>
                    <strong>全タグの検索結果</strong>
                    <span>「{store.globalQuery.trim()}」に {globalSearchResults.length.toLocaleString()}件</span>
                  </div>
                  <span>タグを選ぶと元の分類へ移動します</span>
                </header>
                {globalSearchResults.length ? (
                  <div className="global-search-list" aria-label="一致したタグ">
                    {globalSearchResults.map((tag) => {
                      const path = categoryPath(document.categories, tag.categoryId);
                      const favorite = favoriteTagKeys.has(favoriteTagKey(tag.prompt));
                      return (
                        <button
                          key={tag.uid}
                          className={`global-search-row ${selected.has(tag.uid) ? "is-selected" : ""} ${favorite ? "is-favorite" : ""}`}
                          type="button"
                          data-tag-id={tag.uid}
                          onClick={() => revealSearchResult(tag)}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            showMoveMenu(tag, { x: event.clientX, y: event.clientY });
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
                              event.preventDefault();
                              const rect = event.currentTarget.getBoundingClientRect();
                              showMoveMenu(tag, { x: rect.right - 24, y: rect.top + rect.height / 2 });
                            }
                          }}
                        >
                          <span className="global-result-prompt">
                            {favorite && <Star className="favorite-star" aria-label="お気に入り" fill="currentColor" />}
                            {tag.prompt}
                          </span>
                          <span className="global-result-translation">{tag.translationJa || "—"}</span>
                          <span className="global-result-path">{path.map((category) => category.labelJa).join(" > ")}</span>
                          <ChevronRight aria-hidden="true" />
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="workspace-empty">
                    <strong>一致するタグがありません</strong>
                    <p>タグ名、日本語訳、エイリアスを変えて検索してください。</p>
                  </div>
                )}
              </section>
            ) : smallCategories.length ? (
              <div
                ref={laneScroller}
                className={`kanban-grid ${focusedCategoryId ? "has-focus" : ""}`}
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
                    showFavoritesOnly={store.showFavoritesOnly}
                    favoriteTagKeys={favoriteTagKeys}
                    focused={category.id === focusedCategoryId}
                    deemphasized={Boolean(focusedCategoryId && category.id !== focusedCategoryId)}
                    dragActive={activeDrag?.type === "tag"}
                    recentlyMovedIds={recentlyMoved}
                    onSelect={store.selectTag}
                    onSelectAll={store.selectMany}
                    onEdit={editTag}
                    onDelete={(tag) => deleteTags([tag.uid])}
                    onMoveRequest={showMoveMenu}
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
        <DragOverlay dropAnimation={null} modifiers={activeDrag ? [snapOverlayCenterToCursor] : undefined}>
          {activeDrag && (
            <div
              className={`drag-overlay ${activeDrag.type} ${validTagTarget ? "is-over-target" : ""} ${trailVector.visible ? "has-trail" : ""}`}
              style={
                {
                  "--trail-x": `${trailVector.x}px`,
                  "--trail-y": `${trailVector.y}px`,
                  "--trail-half-x": `${trailVector.x * 0.52}px`,
                  "--trail-half-y": `${trailVector.y * 0.52}px`,
                } as React.CSSProperties
              }
            >
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
      {moveMenu && createPortal(
        <div
          ref={moveMenuRef}
          className="tag-move-menu"
          role="dialog"
          aria-label={`${moveMenu.tagIds.length}件のタグの移動先を選択`}
          style={{ left: moveMenu.x, top: moveMenu.y }}
        >
          <header>
            <span><MoveRight aria-hidden="true" /></span>
            <div>
              <strong>{moveMenu.tagIds.length}件のタグを移動</strong>
              <small>移動先の小分類を選択</small>
            </div>
            <button type="button" onClick={() => setMoveMenu(null)} aria-label="移動先選択を閉じる"><X /></button>
          </header>
          <label className="search-control tag-move-search">
            <Search />
            <input
              ref={moveSearchRef}
              value={moveDestinationQuery}
              onChange={(event) => setMoveDestinationQuery(event.target.value)}
              placeholder="大・中・小分類を検索"
              aria-label="移動先の分類を検索"
            />
          </label>
          {moveMenuAnchorTag && (
            <button
              className="favorite-menu-action"
              type="button"
              role="menuitem"
              onClick={() => {
                toggleTagFavorite(moveMenuAnchorTag);
                setMoveMenu(null);
              }}
            >
              <Star fill={moveMenuAnchorFavorite ? "currentColor" : "none"} />
              {moveMenuAnchorFavorite ? "お気に入りから削除" : "お気に入りに追加"}
            </button>
          )}
          <div className="tag-move-destinations" role="listbox" aria-label="移動先の小分類">
            {smallCategoryDestinations.length ? smallCategoryDestinations.map(({ category, path }) => (
              <button
                key={category.id}
                type="button"
                role="option"
                aria-selected="false"
                onClick={() => moveTagsFromMenu(category)}
              >
                <span>{path.map((item) => item.labelJa).join(" > ")}</span>
                <MoveRight aria-hidden="true" />
              </button>
            )) : <p>一致する小分類がありません</p>}
          </div>
          <footer>選択した小分類の末尾へ移動します</footer>
        </div>,
        appShellRef.current ?? window.document.body,
      )}
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
          <span>
            <strong>{toast.message}</strong>
            {toast.detail && <small>{toast.detail}</small>}
          </span>
          {toast.undoable && (
            <button
              type="button"
              onClick={() => {
                store.undo();
                setRecentlyMovedTagIds([]);
                setToast({ message: "操作を元に戻しました" });
              }}
            >
              元に戻す
            </button>
          )}
        </div>
      )}
      <PreviewDialog
        open={saveMode !== null}
        mode={saveMode ?? "saveAs"}
        fileName={
          saveMode === "overwrite" ? (currentCatalogFileHandle?.name ?? document.fileName) : outputName
        }
        summary={summary}
        issues={issues}
        saving={saving}
        onClose={() => setSaveMode(null)}
        onSave={saveCatalog}
      />
    </div>
  );
}
