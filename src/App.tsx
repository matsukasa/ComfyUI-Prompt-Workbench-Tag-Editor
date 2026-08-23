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
  FileArchive,
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  createDragSoundController,
  readDragSoundPreference,
  writeDragSoundPreference,
} from "./audio/dragSounds";
import { CategoryTree } from "./components/CategoryTree";
import { KanbanLane } from "./components/Kanban";
import { PreviewDialog } from "./components/PreviewDialog";
import { readPromptWorkbenchDataDir, TagSetEditor, writePromptWorkbenchDataDir } from "./components/TagSetEditor";
import {
  DEFAULT_CATALOG_FILE_NAME,
  duplicateMap,
  isSafeOutputFileName,
  outputFileName,
  parseCatalogText,
  serializeCatalog,
  summarizeChanges,
  validateCatalog,
} from "./domain/catalog";
import { categoryPath, sortedChildren } from "./domain/operations";
import {
  favoriteTagKey,
  favoriteTagSetKey,
  readFavoriteSettings,
  toggleFavorite,
  writeFavoriteSettings,
} from "./domain/favorites";
import {
  comparableTagSetDocument,
  isTagSetRoot,
  parseTagSetText,
  serializeTagSetDocument,
  summarizeTagSetChanges,
  tagSetCounts,
} from "./domain/tagSets";
import { getWorkbenchMeta } from "./domain/lineage";
import {
  createSharePackage,
  createZip,
  packageFileName,
  packageToZip,
  parsePackageZip,
  previewImport,
  readPackageId,
  readPackageName,
  writePackageName,
  type ConflictResolution,
  type ImportSelection,
  type ImportPreview,
  type PackageContentType,
  type SharePackageImageAsset,
} from "./domain/packages";
import type { CatalogDocument, CategoryNode, TagOccurrence, TagSetDocument, TagSetItem } from "./domain/types";
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
type EditorMode = "tags" | "tagSets";
type PackageDialogMode = "export" | "import";

interface PackageProgress {
  phase: string;
  current: number;
  total: number;
}

interface DisplayImportHistoryEntry {
  key: string;
  packageName: string;
  packageVersion: number;
  importedAt: string;
  containsCatalog: boolean;
  containsTagSets: boolean;
}

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
const DEFAULT_CATALOG_URL = "/prompt-workbench-data/tag_catalog.json";
const DEFAULT_TAG_SETS_URL = "/prompt-workbench-data/tag_sets.json";
const REVIEW_MAJOR_ID = "favorite-review:major";
const REVIEW_MEDIUM_ID = "favorite-review:medium";
const REVIEW_SMALL_ID = "favorite-review:small";
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

function defaultDataDisplayPath(response: Response, route: string): string {
  const encodedPath = response.headers.get("X-Prompt-Workbench-File-Path");
  if (encodedPath) {
    try {
      return decodeURIComponent(encodedPath);
    } catch {
      return encodedPath;
    }
  }
  return new URL(route, window.location.href).href;
}

function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase().replace(/[\s_-]+/gu, " ");
}

function parseGlobalSearchPattern(query: string): { empty: boolean; test: (text: string) => boolean } {
  const raw = query.trim();
  if (!raw) return { empty: true, test: () => true };
  const normalized = normalizeSearchText(raw);
  const regexSource = raw.startsWith("re:")
    ? raw.slice(3)
    : raw.startsWith("/") && raw.lastIndexOf("/") > 0
      ? raw.slice(1, raw.lastIndexOf("/"))
      : "";
  if (!regexSource) {
    return { empty: false, test: (text) => normalizeSearchText(text).includes(normalized) };
  }
  try {
    const matcher = new RegExp(regexSource, "iu");
    return { empty: false, test: (text) => matcher.test(normalizeSearchText(text)) };
  } catch {
    const fallback = normalizeSearchText(regexSource);
    return { empty: false, test: (text) => normalizeSearchText(text).includes(fallback) };
  }
}

function emptyCatalogDocument(fileName: string, filePath?: string): CatalogDocument {
  return {
    fileName,
    filePath,
    format: "bundled",
    formatMeta: {
      bom: false,
      newline: "\n",
      indent: 2,
      finalNewline: true,
    },
    original: { schema_version: 1, major_categories: [] },
    categories: [],
    tags: [],
  };
}

function ensureCategory(
  categories: CategoryNode[],
  id: string,
  level: CategoryNode["level"],
  parentId: string,
  labelJa: string,
  order: number,
): void {
  const existing = categories.find((category) => category.id === id);
  if (existing) {
    existing.level = level;
    existing.parentId = parentId;
    existing.labelJa = labelJa;
    return;
  }
  categories.push({
    id,
    level,
    parentId,
    labelJa,
    labelEn: "",
    descriptionJa: "",
    order,
    raw: {},
  });
}

function addMissingFavoriteTags(document: CatalogDocument, favorites: Iterable<string>): CatalogDocument {
  const favoriteKeys = [...new Set([...favorites].map(favoriteTagKey).filter(Boolean))];
  if (!favoriteKeys.length) return document;
  const existingKeys = new Set(document.tags.map((tag) => favoriteTagKey(tag.prompt)));
  const missingKeys = favoriteKeys.filter((key) => !existingKeys.has(key));
  if (!missingKeys.length) return document;

  const next = structuredClone(document);
  const nextOrder = next.categories.length;
  ensureCategory(next.categories, REVIEW_MAJOR_ID, "major", "", "要確認", nextOrder);
  ensureCategory(next.categories, REVIEW_MEDIUM_ID, "medium", REVIEW_MAJOR_ID, "未分類", nextOrder + 1);
  ensureCategory(next.categories, REVIEW_SMALL_ID, "small", REVIEW_MEDIUM_ID, "未分類", nextOrder + 2);

  let tagOrder = next.tags.filter((tag) => tag.categoryId === REVIEW_SMALL_ID).length;
  for (const prompt of missingKeys) {
    next.tags.push({
      uid: `favorite-review:${crypto.randomUUID()}`,
      sourceId: undefined,
      categoryId: REVIEW_SMALL_ID,
      prompt,
      translationJa: "",
      aliases: [],
      order: tagOrder++,
      raw: {},
    });
  }
  return next;
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

function downloadTextFile(name: string, source: string): void {
  const blob = new Blob([source], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadBytesFile(name: string, bytes: Uint8Array, type: string): void {
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function importBackupFileName(now = new Date()): string {
  const part = (value: number) => String(value).padStart(2, "0");
  return `PromptWorkbench_ImportBackup_${now.getFullYear()}${part(now.getMonth() + 1)}${part(now.getDate())}_${part(now.getHours())}${part(now.getMinutes())}${part(now.getSeconds())}.zip`;
}

const TAG_SET_IMAGE_ROUTE = "/prompt-workbench-data/tag-set-images";

function tagSetImageFileName(imagePath: string): string {
  const rawName = imagePath.split("?")[0].split(/[\\/]/u).pop() ?? "";
  try {
    return decodeURIComponent(rawName);
  } catch {
    return rawName;
  }
}

function safeZipImageFileName(value: string, fallback: string): string {
  const safe = (value || fallback)
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/gu, "-")
    .replace(/\s+/gu, "-")
    .replace(/[. ]+$/gu, "")
    .slice(0, 96);
  const base = safe.replace(/\.[^.]+$/u, "") || fallback;
  return `${base}.webp`;
}

function tagSetImageSourceUrl(imagePath: string, dataDirectory: string): string {
  const query = new URLSearchParams();
  if (dataDirectory.trim()) query.set("dataDir", dataDirectory.trim());
  return query.size ? `${imagePath}?${query.toString()}` : imagePath;
}

function packageImageCandidates(pkg: ImportPreview["pkg"]): { tagSetId: string; path: string }[] {
  const candidates = new Map<string, { tagSetId: string; path: string }>();
  for (const operation of pkg.tagsetPatch?.operations ?? []) {
    if (operation.type !== "add_tagset" && operation.type !== "update_tagset") continue;
    const tagset = operation.tagset;
    if (!tagset || typeof tagset !== "object" || Array.isArray(tagset)) continue;
    const tagSetId = typeof operation.target_id === "string" ? operation.target_id : "";
    const imagePath = typeof tagset.imagePath === "string" ? tagset.imagePath : "";
    if (!tagSetId || !imagePath.startsWith(`${TAG_SET_IMAGE_ROUTE}/`)) continue;
    candidates.set(tagSetId, { tagSetId, path: imagePath });
  }
  return [...candidates.values()];
}

async function collectPackageImageAssets(
  pkg: ImportPreview["pkg"],
  dataDirectory: string,
): Promise<{ assets: SharePackageImageAsset[]; warnings: string[] }> {
  const assets: SharePackageImageAsset[] = [];
  const warnings: string[] = [];
  const usedNames = new Set<string>();
  for (const candidate of packageImageCandidates(pkg)) {
    const fileName = safeZipImageFileName(tagSetImageFileName(candidate.path), `${candidate.tagSetId}.webp`);
    const zipFileName = usedNames.has(fileName) ? safeZipImageFileName(`${candidate.tagSetId}-${fileName}`, fileName) : fileName;
    usedNames.add(zipFileName);
    try {
      const response = await fetch(tagSetImageSourceUrl(candidate.path, dataDirectory));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.byteLength) throw new Error("empty image");
      assets.push({
        tagSetId: candidate.tagSetId,
        fileName: zipFileName,
        path: candidate.path,
        zipPath: `assets/tag-set-images/${zipFileName}`,
        contentType: response.headers.get("Content-Type") || "image/webp",
        bytes,
      });
    } catch (error) {
      warnings.push(`${candidate.tagSetId}: ${error instanceof Error ? error.message : "画像を取得できませんでした"}`);
    }
  }
  return { assets, warnings };
}

async function saveImportedImageAsset(
  asset: SharePackageImageAsset,
  dataDirectory: string,
): Promise<{ tagSetId: string; path: string }> {
  const response = await fetch(TAG_SET_IMAGE_ROUTE, {
    method: "POST",
    headers: {
      "Content-Type": asset.contentType || "image/webp",
      "X-File-Name": encodeURIComponent(asset.fileName),
      ...(dataDirectory.trim() ? { "X-Prompt-Workbench-Data-Dir": dataDirectory.trim() } : {}),
    },
    body: asset.bytes,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const saved = (await response.json()) as { path?: string };
  return { tagSetId: asset.tagSetId, path: saved.path || `${TAG_SET_IMAGE_ROUTE}/${asset.fileName}` };
}

function tagSetImageSnapshot(document?: TagSetDocument | null): Map<string, Pick<TagSetItem, "imageUrl" | "imagePath">> {
  const result = new Map<string, Pick<TagSetItem, "imageUrl" | "imagePath">>();
  if (!document) return result;
  for (const major of document.majorCategories) {
    for (const medium of major.mediumCategories) {
      for (const small of medium.smallCategories) {
        for (const set of small.sets) result.set(set.id, { imageUrl: set.imageUrl, imagePath: set.imagePath });
      }
    }
  }
  return result;
}

function applyImportedImageResults(
  document: TagSetDocument,
  restoredPaths: Map<string, string>,
  failedIds: Set<string>,
  previousImages: Map<string, Pick<TagSetItem, "imageUrl" | "imagePath">>,
): TagSetDocument {
  const next = structuredClone(document);
  for (const major of next.majorCategories) {
    for (const medium of major.mediumCategories) {
      for (const small of medium.smallCategories) {
        for (const set of small.sets) {
          const restoredPath = restoredPaths.get(set.id);
          if (restoredPath) {
            set.imageUrl = restoredPath;
            set.imagePath = restoredPath;
          } else if (failedIds.has(set.id)) {
            const previous = previousImages.get(set.id);
            set.imageUrl = previous?.imageUrl ?? "";
            set.imagePath = previous?.imagePath ?? "";
          }
        }
      }
    }
  }
  return next;
}

function packageContentLabel(value: PackageContentType): string {
  if (value === "Catalog") return "タグカタログのみ書き出し";
  if (value === "TagSets") return "タグセットのみ書き出し";
  return "両方書き出し";
}

function formatImportDate(value: string): string {
  if (!value) return "日時不明";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

const IMPORT_HISTORY_KEY = "prompt-workbench:imported-share-packages";

function importHistoryKey(pkg: ImportPreview["pkg"]): string {
  return `${pkg.manifest.package_id}@${pkg.manifest.package_version}`;
}

function readImportHistory(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(IMPORT_HISTORY_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function hasImportedPackage(pkg: ImportPreview["pkg"]): boolean {
  return readImportHistory().includes(importHistoryKey(pkg));
}

function rememberImportedPackage(pkg: ImportPreview["pkg"]): void {
  try {
    const next = [importHistoryKey(pkg), ...readImportHistory().filter((value) => value !== importHistoryKey(pkg))].slice(0, 100);
    window.localStorage.setItem(IMPORT_HISTORY_KEY, JSON.stringify(next));
  } catch {
    // Import history is safety metadata; applying the package should not fail if browser storage is unavailable.
  }
}

function importErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("format_version")) {
    return "このZIPはImport用の差分ZIPとして読み込めません。Import時に作成されたバックアップZIPを選んでいる場合、元の差分ZIPはすでに取り込み済みです。";
  }
  return message || "差分ZIPを読み込めませんでした。";
}

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

async function writeCatalogFile(
  handle: CatalogFileHandle,
  document: NonNullable<ReturnType<typeof useCatalogStore.getState>["document"]>,
): Promise<void> {
  await writeTextFile(handle, serializeCatalog(document));
}

async function writeTextFile(handle: CatalogFileHandle, source: string): Promise<void> {
  const writable = await handle.createWritable();
  try {
    await writable.write(source);
    await writable.close();
  } catch (error) {
    await writable.abort?.().catch(() => undefined);
    throw error;
  }
}

async function readUtf8File(file: File): Promise<string> {
  if (!file.name.toLowerCase().endsWith(".json")) throw new Error("対応形式はJSON（.json）のみです。");
  if (file.size > 8 * 1024 * 1024) throw new Error("ファイルが8MBを超えています。");
  const bytes = await file.arrayBuffer();
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function looksLikeTagSetJson(source: string): boolean {
  try {
    const clean = source.startsWith("\uFEFF") ? source.slice(1) : source;
    return isTagSetRoot(JSON.parse(clean));
  } catch {
    return false;
  }
}

function useKeyboardShortcuts({
  tagSetMode,
  undoTagSet,
  redoTagSet,
}: {
  tagSetMode: boolean;
  undoTagSet: () => void;
  redoTagSet: () => void;
}): void {
  const undo = useCatalogStore((state) => state.undo);
  const redo = useCatalogStore((state) => state.redo);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLocaleLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          if (tagSetMode) redoTagSet();
          else redo();
        } else if (tagSetMode) undoTagSet();
        else undo();
      }
      if (event.key.toLocaleLowerCase() === "y") {
        event.preventDefault();
        if (tagSetMode) redoTagSet();
        else redo();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [redo, redoTagSet, tagSetMode, undo, undoTagSet]);
}

export function App() {
  const store = useCatalogStore();
  const appShellRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const packageInput = useRef<HTMLInputElement>(null);
  const laneScroller = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [soundEnabled, setSoundEnabled] = useState(readDragSoundPreference);
  const [favoriteTags, setFavoriteTags] = useState(() => readFavoriteSettings().favorites);
  const [favoriteTagSets, setFavoriteTagSets] = useState(() => readFavoriteSettings().favoriteTagSets);
  const [promptWorkbenchDataDir, setPromptWorkbenchDataDir] = useState(readPromptWorkbenchDataDir);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bulkDeleteArmed, setBulkDeleteArmed] = useState(false);
  const [saveMode, setSaveMode] = useState<SaveMode | null>(null);
  const [packageDialogMode, setPackageDialogMode] = useState<PackageDialogMode | null>(null);
  const [packageName, setPackageName] = useState(readPackageName);
  const [packageVersion, setPackageVersion] = useState(1);
  const [packageContentType, setPackageContentType] = useState<PackageContentType>("Full");
  const [packagePreview, setPackagePreview] = useState<ImportPreview | null>(null);
  const [packageImportSelection, setPackageImportSelection] = useState<ImportSelection>({ catalog: true, tagsets: true });
  const [packageConflictResolution, setPackageConflictResolution] = useState<ConflictResolution>("stop");
  const [packageBusy, setPackageBusy] = useState(false);
  const [packageProgress, setPackageProgress] = useState<PackageProgress | null>(null);
  const [currentCatalogFileHandle, setCurrentCatalogFileHandle] = useState<CatalogFileHandle | null>(null);
  const [currentTagSetFileHandle, setCurrentTagSetFileHandle] = useState<CatalogFileHandle | null>(null);
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
  const [tagSetDocument, setTagSetDocument] = useState<TagSetDocument | null>(null);
  const [tagSetBaseline, setTagSetBaseline] = useState<string | null>(null);
  const [tagSetBaselineDocument, setTagSetBaselineDocument] = useState<TagSetDocument | null>(null);
  const [factoryCatalogDocument, setFactoryCatalogDocument] = useState<CatalogDocument | null>(null);
  const [factoryTagSetDocument, setFactoryTagSetDocument] = useState<TagSetDocument | null>(null);
  const [tagSetHistory, setTagSetHistory] = useState<TagSetDocument[]>([]);
  const [tagSetFuture, setTagSetFuture] = useState<TagSetDocument[]>([]);
  const [editorMode, setEditorMode] = useState<EditorMode>("tags");
  const moveMenuRef = useRef<HTMLDivElement>(null);
  const moveSearchRef = useRef<HTMLInputElement>(null);
  const previousDragDelta = useRef({ x: 0, y: 0 });
  const pendingTrailVector = useRef({ x: 0, y: 0 });
  const trailFrame = useRef<number | null>(null);
  const trailTimer = useRef<number | null>(null);
  const recentMoveTimer = useRef<number | null>(null);
  const dragSounds = useRef(createDragSoundController());
  const loadedDefaultFiles = useRef(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const isTagSetMode = editorMode === "tagSets";

  const replaceTagSetDocument = useCallback((nextDocument: TagSetDocument | null) => {
    setTagSetDocument(nextDocument);
    setTagSetHistory([]);
    setTagSetFuture([]);
  }, []);

  const editTagSetDocument = useCallback((nextDocument: TagSetDocument) => {
    setTagSetDocument((currentDocument) => {
      if (!currentDocument) return nextDocument;
      setTagSetHistory((currentHistory) => [...currentHistory, currentDocument].slice(-100));
      setTagSetFuture([]);
      return nextDocument;
    });
  }, []);

  const undoTagSet = useCallback(() => {
    setTagSetDocument((currentDocument) => {
      if (!currentDocument) return currentDocument;
      let previousDocument: TagSetDocument | undefined;
      setTagSetHistory((currentHistory) => {
        previousDocument = currentHistory.at(-1);
        return previousDocument ? currentHistory.slice(0, -1) : currentHistory;
      });
      if (!previousDocument) return currentDocument;
      setTagSetFuture((currentFuture) => [currentDocument, ...currentFuture].slice(0, 100));
      return previousDocument;
    });
  }, []);

  const redoTagSet = useCallback(() => {
    setTagSetDocument((currentDocument) => {
      if (!currentDocument) return currentDocument;
      let nextDocument: TagSetDocument | undefined;
      setTagSetFuture((currentFuture) => {
        nextDocument = currentFuture[0];
        return nextDocument ? currentFuture.slice(1) : currentFuture;
      });
      if (!nextDocument) return currentDocument;
      setTagSetHistory((currentHistory) => [...currentHistory, currentDocument].slice(-100));
      return nextDocument;
    });
  }, []);

  useKeyboardShortcuts({ tagSetMode: isTagSetMode, undoTagSet, redoTagSet });

  const updateFavorites = (nextFavorites: string[]) => {
    setFavoriteTags(nextFavorites);
    writeFavoriteSettings({ favorites: nextFavorites, favoriteTagSets });
  };

  useEffect(() => {
    if (loadedDefaultFiles.current) return;
    loadedDefaultFiles.current = true;
    const loadDefaultFiles = async () => {
      try {
        const response = await fetch(DEFAULT_CATALOG_URL);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const filePath = defaultDataDisplayPath(response, DEFAULT_CATALOG_URL);
        const source = await response.text();
        const storedFavorites = readFavoriteSettings().favorites;
        const parsed = {
          ...parseCatalogText(source, "tag_catalog.json"),
          filePath,
        };
        setFactoryCatalogDocument(structuredClone(parsed));
        store.load(addMissingFavoriteTags(parsed, storedFavorites));
        updateFavorites(storedFavorites);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        store.load(emptyCatalogDocument("tag_catalog.json", new URL(DEFAULT_CATALOG_URL, window.location.href).href));
        store.setError(`tag_catalog.json を読み込めませんでした: ${detail}`);
      }

      try {
        const response = await fetch(DEFAULT_TAG_SETS_URL);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const filePath = defaultDataDisplayPath(response, DEFAULT_TAG_SETS_URL);
        const source = await response.text();
        const parsed = {
          ...parseTagSetText(source, "tag_sets.json"),
          filePath,
        };
        setFactoryTagSetDocument(structuredClone(parsed));
        replaceTagSetDocument(parsed);
        setTagSetBaseline(comparableTagSetDocument(parsed));
        setTagSetBaselineDocument(structuredClone(parsed));
      } catch {
        setToast({ message: "タグカタログを読み込みました", detail: "タグセット設定は手動で開いてください" });
      }
    };
    void loadDefaultFiles();
  }, [store]);
  const tagSetDirty = tagSetDocument
    ? comparableTagSetDocument(tagSetDocument) !== tagSetBaseline
    : false;
  const dirty = isDirty(store) || tagSetDirty;
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
  const activeFileHandle = isTagSetMode ? currentTagSetFileHandle : currentCatalogFileHandle;
  const issues = isTagSetMode ? [] : document ? validateCatalog(document) : [];
  const summary =
    isTagSetMode && tagSetDocument && tagSetBaselineDocument
      ? summarizeTagSetChanges(tagSetBaselineDocument, tagSetDocument)
      : document && baseline
      ? summarizeChanges(baseline, document)
      : {
          movedTags: 0,
          addedTags: 0,
          deletedTags: 0,
          renamedTags: 0,
          changedCategories: 0,
          duplicateDelta: 0,
        };
  const catalogExportBaseline = factoryCatalogDocument ?? baseline;
  const tagSetExportBaseline = factoryTagSetDocument ?? tagSetBaselineDocument;
  const activeFileName = isTagSetMode
    ? (tagSetDocument?.fileName ?? "tag_sets.json")
    : (document?.fileName ?? "catalog.json");
  const outputName = isTagSetMode ? activeFileName : document ? outputFileName(document.fileName) : "catalog.json";
  const focusedCategoryId = useMemo(() => {
    const tagId = activeDrag?.type === "tag" ? activeDrag.id : store.anchorTagId;
    return tagId ? (document?.tags.find((tag) => tag.uid === tagId)?.categoryId ?? null) : null;
  }, [activeDrag, document, store.anchorTagId]);
  const recentlyMoved = useMemo(() => new Set(recentlyMovedTagIds), [recentlyMovedTagIds]);
  const favoriteTagKeys = useMemo(() => new Set(favoriteTags), [favoriteTags]);
  const favoriteTagSetKeys = useMemo(() => new Set(favoriteTagSets), [favoriteTagSets]);
  const validTagTarget = useMemo(() => {
    if (activeDrag?.type !== "tag" || !overCategoryId || !document) return false;
    return document.categories.some(
      (category) => category.id === overCategoryId && category.level === "small",
    );
  }, [activeDrag, document, overCategoryId]);
  const globalSearchPattern = useMemo(() => parseGlobalSearchPattern(store.globalQuery), [store.globalQuery]);
  const hasGlobalQuery = !globalSearchPattern.empty;
  const globalSearchResults = useMemo(() => {
    if (!document || !hasGlobalQuery) return [];
    return document.tags.filter((tag) => {
      const matches = globalSearchPattern.test(`${tag.prompt} ${tag.translationJa} ${tag.aliases.join(" ")}`);
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
    globalSearchPattern,
    hasGlobalQuery,
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
    if (!pendingRevealTagId || hasGlobalQuery) return;
    const timer = window.setTimeout(() => {
      const row = window.document.querySelector<HTMLElement>(`[data-tag-id="${CSS.escape(pendingRevealTagId)}"]`);
      if (!row) return;
      row.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
      row.focus({ preventScroll: true });
      setPendingRevealTagId(null);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [hasGlobalQuery, pendingRevealTagId, store.selectedMediumId]);

  const packageExportPreview = useMemo(() => {
    if (packageDialogMode !== "export" || !document) return null;
    const includeCatalog = packageContentType === "Catalog" || packageContentType === "Full";
    const includeTagSets = packageContentType === "TagSets" || packageContentType === "Full";
    try {
      return createSharePackage({
        packageName,
        packageId: readPackageId(),
        packageVersion,
        includeCatalog,
        includeTagSets,
        catalogBaseline: catalogExportBaseline,
        catalogDocument: document,
        tagSetBaseline: tagSetExportBaseline,
        tagSetDocument,
      });
    } catch {
      return null;
    }
  }, [catalogExportBaseline, document, packageContentType, packageDialogMode, packageName, packageVersion, tagSetDocument, tagSetExportBaseline]);
  const importHistory = useMemo<DisplayImportHistoryEntry[]>(() => {
    const entries = new Map<string, DisplayImportHistoryEntry>();
    for (const root of [document?.original, tagSetDocument?.original]) {
      if (!root) continue;
      for (const [key, item] of Object.entries(getWorkbenchMeta(root).imports)) {
        const current = entries.get(key);
        entries.set(key, {
          key,
          packageName: item.packageName,
          packageVersion: item.packageVersion,
          importedAt: item.importedAt || current?.importedAt || "",
          containsCatalog: Boolean(item.containsCatalog || current?.containsCatalog),
          containsTagSets: Boolean(item.containsTagSets || current?.containsTagSets),
        });
      }
    }
    return [...entries.values()].sort((left, right) => (right.importedAt || "").localeCompare(left.importedAt || ""));
  }, [document, tagSetDocument]);

  if (!document || !baseline) return <main className="loading-screen">カタログを準備しています…</main>;

  const catalogWindow = window as CatalogWindow;
  const isDefaultCatalogFile =
    !isTagSetMode &&
    document.fileName.trim().toLocaleLowerCase() === DEFAULT_CATALOG_FILE_NAME.toLocaleLowerCase();
  const canOverwriteCurrentFile =
    Boolean(activeFileHandle) ||
    ((!isDefaultCatalogFile || isTagSetMode) && Boolean(catalogWindow.showSaveFilePicker));
  const needsLocalhostForOverwrite =
    (!isDefaultCatalogFile || isTagSetMode) &&
    !activeFileHandle &&
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
      const source = await readUtf8File(file);
      const filePath = catalogFilePath(file, fileHandle);
      if (looksLikeTagSetJson(source)) {
        const parsed = parseTagSetText(source, file.name);
        const nextDocument = filePath ? { ...parsed, filePath } : parsed;
        replaceTagSetDocument(nextDocument);
        setTagSetBaseline(comparableTagSetDocument(nextDocument));
        setTagSetBaselineDocument(structuredClone(nextDocument));
        setCurrentTagSetFileHandle(fileHandle);
        store.clearSelection();
      } else {
        const storedFavorites = readFavoriteSettings().favorites;
        const parsed = parseCatalogText(source, file.name);
        const nextDocument = filePath ? { ...parsed, filePath } : parsed;
        store.load(addMissingFavoriteTags(nextDocument, storedFavorites));
        setCurrentCatalogFileHandle(fileHandle);
        updateFavorites(storedFavorites);
      }
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
        if (activeFileHandle) pickerOptions.startIn = activeFileHandle;
        const savedFileHandle = await catalogWindow.showSaveFilePicker(pickerOptions);
        if (isTagSetMode && tagSetDocument) {
          const source = serializeTagSetDocument(tagSetDocument);
          await writeTextFile(savedFileHandle, source);
          const savedDocument = {
            ...tagSetDocument,
            fileName: savedFileHandle.name,
            filePath: catalogHandlePath(savedFileHandle),
          };
          setTagSetDocument(savedDocument);
          setTagSetBaseline(comparableTagSetDocument(savedDocument));
          setTagSetBaselineDocument(structuredClone(savedDocument));
          setCurrentTagSetFileHandle(savedFileHandle);
        } else {
          await writeCatalogFile(savedFileHandle, document);
          store.markSaved(savedFileHandle.name, catalogHandlePath(savedFileHandle));
          setCurrentCatalogFileHandle(savedFileHandle);
        }
        setToast({ message: `${savedFileHandle.name} に別名保存しました` });
      } else {
        if (isTagSetMode && tagSetDocument) downloadTextFile(outputName, serializeTagSetDocument(tagSetDocument));
        else downloadFile(document, outputName);
        if (isTagSetMode && tagSetDocument) {
          const savedDocument = { ...tagSetDocument, fileName: outputName, filePath: undefined };
          setTagSetDocument(savedDocument);
          setTagSetBaseline(comparableTagSetDocument(savedDocument));
          setTagSetBaselineDocument(structuredClone(savedDocument));
          setCurrentTagSetFileHandle(null);
        } else {
          store.markSaved(outputName);
          setCurrentCatalogFileHandle(null);
        }
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
    let overwriteHandle = activeFileHandle;
    if (!overwriteHandle && (!isDefaultCatalogFile || isTagSetMode) && catalogWindow.showSaveFilePicker) {
      try {
        overwriteHandle = await catalogWindow.showSaveFilePicker({
          id: CATALOG_FILE_PICKER_ID,
          suggestedName: activeFileName,
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
      if (isTagSetMode && tagSetDocument) {
        const source = serializeTagSetDocument(tagSetDocument);
        await writeTextFile(overwriteHandle, source);
        const savedDocument = {
          ...tagSetDocument,
          fileName: overwriteHandle.name,
          filePath: catalogHandlePath(overwriteHandle) ?? tagSetDocument.filePath,
        };
        setTagSetDocument(savedDocument);
        setTagSetBaseline(comparableTagSetDocument(savedDocument));
        setTagSetBaselineDocument(structuredClone(savedDocument));
        setCurrentTagSetFileHandle(overwriteHandle);
      } else {
        await writeCatalogFile(overwriteHandle, document);
        store.markSaved(overwriteHandle.name, catalogHandlePath(overwriteHandle) ?? document.filePath);
        store.clearSelection();
        setCurrentCatalogFileHandle(overwriteHandle);
      }
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
  const exportPackage = async () => {
    setPackageBusy(true);
    let phase = "差分を確認しています";
    setPackageProgress({ phase, current: 1, total: 6 });
    try {
      await waitForPaint();
      const includeCatalog = packageContentType === "Catalog" || packageContentType === "Full";
      const includeTagSets = packageContentType === "TagSets" || packageContentType === "Full";
      phase = "patchを生成しています";
      setPackageProgress({ phase, current: 2, total: 6 });
      await waitForPaint();
      const pkg = createSharePackage({
        packageName,
        packageId: readPackageId(),
        packageVersion,
        includeCatalog,
        includeTagSets,
        catalogBaseline: catalogExportBaseline,
        catalogDocument: document,
        tagSetBaseline: tagSetExportBaseline,
        tagSetDocument,
      });
      if (!pkg.manifest.contains.catalog && !pkg.manifest.contains.tagsets) {
        store.setError("書き出せる差分がありません。タグカタログまたはタグセットを読み込んでください。");
        return;
      }
      phase = "画像アセットを集めています";
      setPackageProgress({ phase, current: 3, total: 6 });
      await waitForPaint();
      const imageResult = includeTagSets ? await collectPackageImageAssets(pkg, promptWorkbenchDataDir) : { assets: [], warnings: [] };
      pkg.imageAssets = imageResult.assets;
      writePackageName(packageName);
      phase = "manifestとCSVを生成しています";
      setPackageProgress({ phase, current: 4, total: 6 });
      await waitForPaint();
      const zipName = packageFileName(packageName, packageContentType, packageVersion);
      phase = "ZIPを作成しています";
      setPackageProgress({ phase, current: 5, total: 6 });
      await waitForPaint();
      downloadBytesFile(zipName, packageToZip(pkg), "application/zip");
      setPackageProgress({ phase: "完了しました", current: 6, total: 6 });
      setToast({
        message: `${zipName} を書き出しました`,
        detail: `Catalog ${pkg.catalogPatch?.operations.length ?? 0}件 / TagSets ${pkg.tagsetPatch?.operations.length ?? 0}件 / 画像 ${pkg.imageAssets.length}件${
          imageResult.warnings.length ? ` / 画像スキップ ${imageResult.warnings.length}件` : ""
        }`,
      });
      setPackageDialogMode(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "差分を書き出せませんでした。";
      store.setError(`差分を書き出せませんでした。\n処理段階: ${phase}\n原因: ${message}`);
    } finally {
      setPackageBusy(false);
      window.setTimeout(() => setPackageProgress(null), 500);
    }
  };
  const openPackageFile = () => {
    if (packageInput.current) packageInput.current.value = "";
    packageInput.current?.click();
  };
  const buildImportPreview = (
    pkg: ImportPreview["pkg"],
    selection: ImportSelection,
    conflictResolution: ConflictResolution = packageConflictResolution,
  ): ImportPreview => {
    const preview = previewImport({ pkg, catalogDocument: document, tagSetDocument, selection, conflictResolution });
    const duplicateIssue = hasImportedPackage(pkg)
      ? [`このZIPはすでに取り込み済みです。もう一度取り込む必要はありません。${pkg.manifest.package_name} v${pkg.manifest.package_version}`]
      : [];
    const selectionIssue =
      !selection.catalog && !selection.tagsets ? ["Import対象を少なくとも1つ選択してください。"] : [];
    return duplicateIssue.length || selectionIssue.length
      ? { ...preview, issues: [...preview.issues, ...duplicateIssue, ...selectionIssue] }
      : preview;
  };
  const changeConflictResolution = (resolution: ConflictResolution) => {
    setPackageConflictResolution(resolution);
    if (packagePreview) setPackagePreview(buildImportPreview(packagePreview.pkg, packageImportSelection, resolution));
  };
  const loadPackageFile = async (file?: File) => {
    if (!file) return;
    setPackageBusy(true);
    let phase = "ZIPを検証しています";
    setPackageProgress({ phase, current: 1, total: 5 });
    try {
      await waitForPaint();
      if (!file.name.toLowerCase().endsWith(".zip")) throw new Error("差分ZIPを選んでください。");
      if (file.size > 16 * 1024 * 1024) throw new Error("ZIPファイルが16MBを超えています。");
      phase = "manifest.jsonを確認しています";
      setPackageProgress({ phase, current: 2, total: 5 });
      await waitForPaint();
      const pkg = parsePackageZip(new Uint8Array(await file.arrayBuffer()));
      phase = "競合を確認しています";
      setPackageProgress({ phase, current: 4, total: 6 });
      await waitForPaint();
      const selection = { catalog: pkg.manifest.contains.catalog, tagsets: pkg.manifest.contains.tagsets };
      setPackageImportSelection(selection);
      setPackageConflictResolution("stop");
      phase = "previewを作成しています";
      setPackageProgress({ phase, current: 5, total: 6 });
      await waitForPaint();
      setPackagePreview(buildImportPreview(pkg, selection));
      setPackageDialogMode("import");
      setPackageProgress({ phase: "完了しました", current: 6, total: 6 });
    } catch (error) {
      const message = importErrorMessage(error);
      store.setError(`差分ZIPを読み込めませんでした。\n処理段階: ${phase}\n原因: ${message}`);
    } finally {
      setPackageBusy(false);
      window.setTimeout(() => setPackageProgress(null), 500);
    }
  };
  const applyPackageImport = async () => {
    if (
      !packagePreview ||
      packagePreview.issues.length ||
      (packagePreview.conflicts.length && packageConflictResolution === "stop")
    )
      return;
    if (!window.confirm("Importを適用します。現在のファイルは未保存の編集状態になり、保存するまで元ファイルは上書きされません。続行しますか？")) return;
    const previousCatalog = document ? structuredClone(document) : null;
    const previousTagSets = tagSetDocument ? structuredClone(tagSetDocument) : null;
    setPackageBusy(true);
    let phase = "バックアップを作成しています";
    setPackageProgress({ phase, current: 1, total: 5 });
    try {
      await waitForPaint();
      const backupFiles: Record<string, string> = {};
      if (previousCatalog) backupFiles["tag_catalog.before_import.json"] = serializeCatalog(previousCatalog);
      if (previousTagSets) backupFiles["tag_sets.before_import.json"] = serializeTagSetDocument(previousTagSets);
      backupFiles["import_manifest.json"] = `${JSON.stringify(packagePreview.pkg.manifest, null, 2)}\n`;
      downloadBytesFile(importBackupFileName(), createZip(backupFiles), "application/zip");
      phase = "タグカタログを適用しています";
      setPackageProgress({ phase, current: 2, total: 5 });
      await waitForPaint();
      if (packagePreview.nextCatalog) store.replaceDocument(packagePreview.nextCatalog);
      phase = "画像アセットを復元しています";
      setPackageProgress({ phase, current: 3, total: 6 });
      await waitForPaint();
      const restoredImagePaths = new Map<string, string>();
      const failedImageIds = new Set<string>();
      if (packageImportSelection.tagsets) {
        for (const asset of packagePreview.pkg.imageAssets ?? []) {
          try {
            const saved = await saveImportedImageAsset(asset, promptWorkbenchDataDir);
            restoredImagePaths.set(saved.tagSetId, saved.path);
          } catch {
            failedImageIds.add(asset.tagSetId);
          }
        }
      }
      phase = "タグセットを適用しています";
      setPackageProgress({ phase, current: 3, total: 5 });
      await waitForPaint();
      if (packagePreview.nextTagSets) {
        editTagSetDocument(
          applyImportedImageResults(packagePreview.nextTagSets, restoredImagePaths, failedImageIds, tagSetImageSnapshot(previousTagSets)),
        );
      }
      phase = "Import履歴を記録しています";
      setPackageProgress({ phase, current: 4, total: 5 });
      await waitForPaint();
      rememberImportedPackage(packagePreview.pkg);
      setPackageProgress({ phase: "完了しました", current: 5, total: 5 });
      setToast({
        message: "Importを適用しました",
        detail: `${packagePreview.pkg.manifest.package_name} v${packagePreview.pkg.manifest.package_version} / 追加 ${packagePreview.summary.addedTags}件 / 更新・移動 ${packagePreview.summary.movedTags + packagePreview.summary.renamedTags + packagePreview.summary.changedCategories}件`,
        undoable: true,
      });
      setToast({
        message: "Importを適用しました",
        detail: `${packagePreview.pkg.manifest.package_name} v${packagePreview.pkg.manifest.package_version} / 追加 ${packagePreview.summary.addedTags}件 / 更新・移動 ${
          packagePreview.summary.movedTags + packagePreview.summary.renamedTags + packagePreview.summary.changedCategories
        }件 / 画像 ${restoredImagePaths.size}件 / 画像スキップ ${failedImageIds.size}件`,
        undoable: true,
      });
      setPackagePreview(null);
      setPackageDialogMode(null);
      setPackageBusy(false);
      window.setTimeout(() => setPackageProgress(null), 500);
    } catch (error) {
      setPackageProgress({ phase: "変更を取り消しています", current: 1, total: 4 });
      await waitForPaint();
      setPackageProgress({ phase: "バックアップから復元しています", current: 2, total: 4 });
      await waitForPaint();
      if (previousCatalog) store.replaceDocument(previousCatalog);
      if (previousTagSets) editTagSetDocument(previousTagSets);
      setPackageProgress({ phase: "整合性を確認しています", current: 3, total: 4 });
      await waitForPaint();
      setPackageProgress({ phase: "元の状態へ復元しました", current: 4, total: 4 });
      setPackageBusy(false);
      window.setTimeout(() => setPackageProgress(null), 900);
      const message = error instanceof Error ? error.message : "Importを適用できませんでした。";
      store.setError(`Importを適用できませんでした。\n処理段階: ${phase}\n原因: ${message}\n変更は適用前の状態へ戻しました。`);
    }
  };
  const packageImportDisabledReason =
    packageDialogMode !== "import"
      ? ""
      : packageBusy
        ? "Import処理中のため、完了するまで適用できません。"
        : !packagePreview
          ? "ImportするZIPを選択すると適用できます。"
          : packagePreview.issues.length > 0
            ? `Import前の確認でエラーがあります: ${packagePreview.issues[0]}`
            : packagePreview.conflicts.length > 0 && packageConflictResolution === "stop"
              ? `競合があるため適用できません: ${packagePreview.conflicts[0]}`
              : "";
  const packageDialog = packageDialogMode ? (
    <div className="modal-backdrop" role="presentation" onMouseDown={() => setPackageDialogMode(null)}>
      <section
        className="preview-dialog package-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="package-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2 id="package-dialog-title">
              {packageDialogMode === "export" ? "差分を書き出す" : "共有パッケージを読み込む"}
            </h2>
            <p>
              {packageDialogMode === "export"
                ? "Factory Default / 読み込み時の状態との差分だけをZIPにまとめます。"
                : "ZIP内のmanifest.jsonを確認し、適用前に変更内容を表示します。"}
            </p>
          </div>
          <button className="icon-button" type="button" onClick={() => setPackageDialogMode(null)} aria-label="閉じる">
            <X />
          </button>
        </header>
        {packageProgress && (
          <div className="package-progress" role="status" aria-live="polite">
            <div>
              <strong>{packageProgress.phase}</strong>
              <span>
                {Math.round((packageProgress.current / packageProgress.total) * 100)}% / {packageProgress.current} / {packageProgress.total}
              </span>
            </div>
            <progress value={packageProgress.current} max={packageProgress.total} />
          </div>
        )}
        {packageDialogMode === "export" ? (
          <div className="package-panel">
            <label className="settings-field">
              <span>パッケージ名</span>
              <input
                value={packageName}
                onChange={(event) => setPackageName(event.target.value)}
                placeholder="MyTagPackage"
              />
            </label>
            <label className="settings-field">
              <span>パッケージバージョン</span>
              <input
                type="number"
                min={1}
                value={packageVersion}
                onChange={(event) => setPackageVersion(Math.max(1, Math.floor(Number(event.target.value) || 1)))}
              />
            </label>
            <div className="package-content-options" role="radiogroup" aria-label="書き出すデータ">
              {(["Catalog", "TagSets", "Full"] as PackageContentType[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={packageContentType === value ? "is-active" : ""}
                  onClick={() => setPackageContentType(value)}
                >
                  {packageContentLabel(value)}
                </button>
              ))}
            </div>
            <p className="package-filename">
              {packageFileName(packageName, packageContentType, packageVersion)}
            </p>
            <div className="package-export-preview">
              <strong>Export内容</strong>
              <span>
                タグカタログ: {packageExportPreview?.catalogPatch?.operations.length ?? 0}件 / タグセット:{" "}
                {packageExportPreview?.tagsetPatch?.operations.length ?? 0}件
              </span>
              <small>
                削除操作は共有差分に含めません。changes.csv、manifest.json、patch JSONをZIPへ保存します。
              </small>
            </div>
          </div>
        ) : (
          <div className="package-panel">
            <button className="primary-button" type="button" disabled={packageBusy} onClick={openPackageFile}>
              <FileArchive />
              ZIPを選択
            </button>
            {packagePreview && (
              <div className="package-import-preview">
                <strong>
                  {packagePreview.pkg.manifest.package_name} v{packagePreview.pkg.manifest.package_version}
                </strong>
                <span>
                  Catalog {packagePreview.pkg.catalogPatch?.operations.length ?? 0}件 / TagSets{" "}
                  {packagePreview.pkg.tagsetPatch?.operations.length ?? 0}件
                </span>
                <span>画像 {packagePreview.pkg.imageAssets?.length ?? 0}件</span>
                {packagePreview.conflicts.length > 0 && (
                  <span>
                    競合 {packagePreview.conflicts.length}件
                    {packageConflictResolution === "skip" ? ` / スキップ予定 ${packagePreview.conflicts.length}件` : ""}
                  </span>
                )}
                <div className="package-import-targets" aria-label="Import対象">
                  {(["catalog", "tagsets"] as const).map((key) => {
                    const label = key === "catalog" ? "タグカタログ" : "タグセット";
                    const included = packagePreview.pkg.manifest.contains[key];
                    const checked = packageImportSelection[key] && included;
                    return (
                      <label key={key} className={!included ? "is-disabled" : ""}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!included || packageBusy}
                          onChange={(event) => {
                            const next = { ...packageImportSelection, [key]: event.target.checked && included };
                            setPackageImportSelection(next);
                            setPackageConflictResolution("stop");
                            setPackagePreview(buildImportPreview(packagePreview.pkg, next, "stop"));
                          }}
                        />
                        <span>{label}</span>
                        <small>{included ? "あり" : "なし"}</small>
                      </label>
                    );
                  })}
                </div>
                <p className="package-import-scope">
                  タグカタログ: {packagePreview.pkg.manifest.contains.catalog && packageImportSelection.catalog ? "読み込む" : "読み込まない"} / タグセット:{" "}
                  {packagePreview.pkg.manifest.contains.tagsets && packageImportSelection.tagsets ? "読み込む" : "読み込まない"}
                </p>
                {packagePreview.issues.map((issue) => (
                  <p className="validation-error" key={issue}>
                    <AlertTriangle />
                    {issue}
                  </p>
                ))}
                {packagePreview.conflicts.map((conflict) => (
                  <p className="validation-error" key={conflict}>
                    <AlertTriangle />
                    {conflict}
                  </p>
                ))}
                {packagePreview.conflicts.length > 0 && (
                  <fieldset className="package-conflict-resolution">
                    <legend>競合の扱い</legend>
                    <label>
                      <input
                        type="radio"
                        name="package-conflict-resolution"
                        checked={packageConflictResolution === "stop"}
                        onChange={() => changeConflictResolution("stop")}
                      />
                      <span>現在の設定を保持してImportを停止</span>
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="package-conflict-resolution"
                        checked={packageConflictResolution === "import"}
                        onChange={() => changeConflictResolution("import")}
                      />
                      <span>競合箇所はImport側を採用</span>
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="package-conflict-resolution"
                        checked={packageConflictResolution === "skip"}
                        onChange={() => changeConflictResolution("skip")}
                      />
                      <span>競合箇所は今回スキップ</span>
                    </label>
                    {packageConflictResolution === "import" && (
                      <small>Import側を採用すると、表示された競合箇所は現在の内容を上書きします。</small>
                    )}
                    {packageConflictResolution === "skip" && (
                      <small>スキップを選ぶと、表示された競合operationだけを除外して、競合していない差分をImportします。</small>
                    )}
                  </fieldset>
                )}
              </div>
            )}
            {!packagePreview && <p>ZIPを選ぶと、ここにImport前のpreviewが表示されます。</p>}
            <section className="package-import-history" aria-label="Import履歴">
              <strong>Import履歴</strong>
              {importHistory.length ? (
                <ul>
                  {importHistory.slice(0, 8).map((item) => (
                    <li key={item.key}>
                      <span>
                        {item.packageName} v{item.packageVersion}
                      </span>
                      <small>
                        {formatImportDate(item.importedAt)} /{" "}
                        {item.containsCatalog && item.containsTagSets
                          ? "タグカタログ + タグセット"
                          : item.containsCatalog
                            ? "タグカタログ"
                            : item.containsTagSets
                              ? "タグセット"
                              : "内容不明"}
                      </small>
                    </li>
                  ))}
                </ul>
              ) : (
                <small>まだImport履歴はありません。</small>
              )}
            </section>
          </div>
        )}
        <footer>
          <button type="button" disabled={packageBusy} onClick={() => setPackageDialogMode(null)}>
            {packageDialogMode === "import" ? "キャンセル" : "閉じる"}
          </button>
          {packageDialogMode === "export" ? (
            <button className="primary-button" type="button" disabled={packageBusy} onClick={exportPackage}>
              <Download />
              {packageBusy ? "書き出し中..." : "ZIPを書き出す"}
            </button>
          ) : (
            <div className="package-import-action">
              {packageImportDisabledReason && <p>{packageImportDisabledReason}</p>}
              <button
                className="primary-button"
                type="button"
                disabled={Boolean(packageImportDisabledReason)}
                title={packageImportDisabledReason || undefined}
                onClick={applyPackageImport}
              >
                <FileArchive />
                Importを適用
              </button>
            </div>
          )}
        </footer>
      </section>
    </div>
  ) : null;
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
  const updateTagSetFavorites = (nextFavorites: string[]) => {
    setFavoriteTagSets(nextFavorites);
    writeFavoriteSettings({ favorites: favoriteTags, favoriteTagSets: nextFavorites });
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
  const toggleTagSetFavorite = (id: string, name: string) => {
    const next = toggleFavorite(favoriteTagSets, id);
    updateTagSetFavorites(next);
    setToast({
      message: next.includes(favoriteTagSetKey(id))
        ? "タグセットをお気に入りに追加しました"
        : "タグセットをお気に入りから削除しました",
      detail: name,
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

  if (isTagSetMode) {
    const counts = tagSetDocument ? tagSetCounts(tagSetDocument) : null;
    return (
      <div
        ref={appShellRef}
        className={`app-shell theme-${theme}`}
        onContextMenuCapture={(event) => {
          event.preventDefault();
        }}
      >
        <header className="app-toolbar">
          <div className="app-title">
            <FileJson />
            <strong>ComfyUI Prompt Workbench Tag Editor</strong>
            <span
              className="current-file-path"
              title={tagSetDocument?.filePath ?? tagSetDocument?.fileName ?? "tag_sets.json"}
              data-full-path={tagSetDocument?.filePath ?? tagSetDocument?.fileName ?? "tag_sets.json"}
            >
              <span className="current-file-path-text">{tagSetDocument?.filePath ?? tagSetDocument?.fileName ?? "tag_sets.json"}</span>
            </span>
            {dirty && (
              <span className="unsaved">
                <AlertTriangle />
                未保存の変更あり
              </span>
            )}
            {counts && (
              <span className="tag-set-counts">
                {counts.sets.toLocaleString()} セット / {counts.smalls.toLocaleString()} 小分類
              </span>
            )}
          </div>
          <div className="editor-mode-tabs" role="tablist" aria-label="編集画面">
            <button type="button" role="tab" aria-selected="false" onClick={() => setEditorMode("tags")}>
              タグ編集
            </button>
            <button className="is-active" type="button" role="tab" aria-selected="true">
              タグセット編集
            </button>
          </div>
          <div className="toolbar-actions">
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(event) => void loadSelectedFile(event.target.files?.[0])}
            />
            <input
              ref={packageInput}
              type="file"
              accept=".zip,application/zip"
              hidden
              onChange={(event) => void loadPackageFile(event.target.files?.[0])}
            />
            <button type="button" onClick={() => void openCatalogFile()}>
              <FolderOpen />
              設定ファイルを開く
            </button>
            <button type="button" onClick={undoTagSet} disabled={!tagSetHistory.length} aria-label="元に戻す">
              <Undo2 />
              元に戻す
            </button>
            <button type="button" onClick={redoTagSet} disabled={!tagSetFuture.length} aria-label="やり直す">
              <Redo2 />
              やり直す
            </button>
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
                  <div className="settings-row">
                    <div>
                      <strong>共有パッケージ</strong>
                      <span>差分ZIPをImport / Exportします</span>
                    </div>
                    <div className="settings-actions">
                      <button type="button" onClick={() => setPackageDialogMode("import")}>
                        <FileArchive />
                        Import
                      </button>
                      <button type="button" onClick={() => setPackageDialogMode("export")}>
                        <Download />
                        Export
                      </button>
                    </div>
                  </div>
                  <label className="settings-field">
                    <span>Prompt Workbench data フォルダ</span>
                    <input
                      value={promptWorkbenchDataDir}
                      spellCheck={false}
                      placeholder="未指定の場合は自動検出"
                      onChange={(event) => {
                        const value = event.target.value;
                        setPromptWorkbenchDataDir(value);
                        writePromptWorkbenchDataDir(value);
                      }}
                    />
                  </label>
                </div>
              )}
            </div>
            <button
              className="save-button"
              type="button"
              disabled={!tagSetDocument || !canOverwriteCurrentFile || saving}
              title={
                currentTagSetFileHandle
                  ? `${currentTagSetFileHandle.name} を上書き保存`
                  : canOverwriteCurrentFile
                    ? `${tagSetDocument?.fileName ?? "tag_sets.json"} の保存先を確認して上書き保存`
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
              disabled={!tagSetDocument || saving}
              onClick={() => setSaveMode("saveAs")}
            >
              <Download />
              別名で保存
            </button>
          </div>
        </header>
        {tagSetDocument ? (
          <TagSetEditor
            document={tagSetDocument}
            onChange={editTagSetDocument}
            dragSounds={dragSounds.current}
            soundEnabled={soundEnabled}
            promptWorkbenchDataDir={promptWorkbenchDataDir}
            favoriteTagSetKeys={favoriteTagSetKeys}
            showFavoritesOnly={store.showFavoritesOnly}
            onToggleFavorite={toggleTagSetFavorite}
          />
        ) : (
          <main className="tag-set-editor tag-set-empty-state">
            <div className="tag-set-empty">
              <strong>タグセット設定ファイルを開いてください</strong>
              <p>上部の「設定ファイルを開く」から tag_sets.json を読み込むと編集できます。</p>
            </div>
          </main>
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
          </div>
        )}
        <PreviewDialog
          open={saveMode !== null}
          mode={saveMode ?? "saveAs"}
          fileName={saveMode === "overwrite" ? (currentTagSetFileHandle?.name ?? tagSetDocument?.fileName ?? "tag_sets.json") : outputName}
          targetPath={
            saveMode === "overwrite"
              ? (catalogHandlePath(currentTagSetFileHandle) ?? tagSetDocument?.filePath ?? tagSetDocument?.fileName)
              : undefined
          }
          summary={summary}
          issues={issues}
          saving={saving}
          onClose={() => setSaveMode(null)}
          onSave={saveCatalog}
        />
        {packageDialog}
      </div>
    );
  }

  const selectedTags = document.tags.filter((tag) => selected.has(tag.uid));
  return (
    <div
      ref={appShellRef}
      className={`app-shell theme-${theme}`}
      onContextMenuCapture={(event) => {
        event.preventDefault();
      }}
    >
      <header className="app-toolbar">
        <div className="app-title">
          <FileJson />
          <strong>ComfyUI Prompt Workbench Tag Editor</strong>
          <span className="current-file-path" title={document.filePath ?? document.fileName} data-full-path={document.filePath ?? document.fileName}>
            <span className="current-file-path-text">{document.filePath ?? document.fileName}</span>
          </span>
          {dirty && (
            <span className="unsaved">
              <AlertTriangle />
              未保存の変更あり
            </span>
          )}
        </div>
        <div className="editor-mode-tabs" role="tablist" aria-label="編集画面">
          <button className="is-active" type="button" role="tab" aria-selected="true">
            タグ編集
          </button>
          <button type="button" role="tab" aria-selected="false" onClick={() => setEditorMode("tagSets")}>
            タグセット編集
          </button>
        </div>
        <div className="toolbar-actions">
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(event) => void loadSelectedFile(event.target.files?.[0])}
          />
          <input
            ref={packageInput}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={(event) => void loadPackageFile(event.target.files?.[0])}
          />
          <button type="button" onClick={() => void openCatalogFile()}>
            <FolderOpen />
            設定ファイルを開く
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
                <div className="settings-row">
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
                <label className="settings-field">
                  <span>Prompt Workbench data フォルダ</span>
                  <input
                    value={promptWorkbenchDataDir}
                    spellCheck={false}
                    placeholder="未指定の場合は自動検出"
                    onChange={(event) => {
                      const value = event.target.value;
                      setPromptWorkbenchDataDir(value);
                      writePromptWorkbenchDataDir(value);
                    }}
                  />
                </label>
                <div className="settings-row">
                  <div>
                    <strong>共有パッケージ</strong>
                    <span>差分ZIPをImport / Exportします</span>
                  </div>
                  <div className="settings-actions">
                    <button type="button" onClick={() => setPackageDialogMode("import")}>
                      <FileArchive />
                      Import
                    </button>
                    <button type="button" onClick={() => setPackageDialogMode("export")}>
                      <Download />
                      Export
                    </button>
                  </div>
                </div>
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
              {!hasGlobalQuery && smallCategories.length > 4 && (
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
            {hasGlobalQuery ? (
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
                            <Star
                              className={`favorite-star ${favorite ? "is-favorite" : ""}`}
                              aria-label={favorite ? "お気に入り" : undefined}
                              aria-hidden={!favorite}
                              fill={favorite ? "currentColor" : "none"}
                            />
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
        targetPath={
          saveMode === "overwrite"
            ? (catalogHandlePath(currentCatalogFileHandle) ?? document.filePath ?? document.fileName)
            : undefined
        }
        summary={summary}
        issues={issues}
        saving={saving}
        onClose={() => setSaveMode(null)}
        onSave={saveCatalog}
      />
      {packageDialog}
    </div>
  );
}
