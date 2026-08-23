import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GripVertical,
  Image,
  Link,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  User,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { favoriteTagSetKey } from "../domain/favorites";
import { getWorkbenchMeta, itemOrigin, markLocal, writeWorkbenchMeta } from "../domain/lineage";
import type { DragSoundController } from "../audio/dragSounds";
import type {
  TagSetDocument,
  TagSetItem,
  TagSetMajorCategory,
  TagSetMediumCategory,
  TagSetSmallCategory,
} from "../domain/types";

type TagSetCategoryLevel = "major" | "medium" | "small";
type DragData = CategoryDragData | CategoryTargetData | SetDragData | SetTargetData;

interface TagSetEditorProps {
  document: TagSetDocument;
  onChange: (document: TagSetDocument) => void;
  dragSounds: DragSoundController;
  soundEnabled: boolean;
  promptWorkbenchDataDir: string;
  favoriteTagSetKeys: Set<string>;
  showFavoritesOnly: boolean;
  onToggleFavorite: (id: string, name: string) => void;
}

interface SmallSelection {
  majorIndex: number;
  mediumIndex: number;
  smallIndex: number;
}

interface SetSelection extends SmallSelection {
  setIndex: number;
}

interface CategoryDragData extends Partial<SmallSelection> {
  type: "tag-set-category";
  level: TagSetCategoryLevel;
}

interface CategoryTargetData extends Partial<SmallSelection> {
  type: "tag-set-category-target";
  level: TagSetCategoryLevel;
}

interface CategoryRowProps {
  id: string;
  level: TagSetCategoryLevel;
  label: string;
  labelEn: string;
  originTitle: string;
  count: number;
  selected?: boolean;
  expanded?: boolean;
  hasChildren?: boolean;
  data: CategoryDragData;
  editing: boolean;
  onToggle?: () => void;
  onSelect?: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (labelJa: string, labelEn: string) => void;
  onDelete: () => void;
}

interface SetDragData extends SetSelection {
  type: "tag-set-set";
}

interface SetTargetData extends SetSelection {
  type: "tag-set-set-target";
}

interface SetRowProps {
  setItem: TagSetItem;
  index: number;
  selection: SetSelection;
  selected: boolean;
  favorite: boolean;
  imageSrc: string;
  onSelect: () => void;
  onFavoriteMenu: (setItem: TagSetItem, point: { x: number; y: number }) => void;
  onDelete: () => void;
}

interface FavoriteMenuState {
  setId: string;
  setName: string;
  x: number;
  y: number;
}

function nextSetId(smallId: string, sets: TagSetItem[]): string {
  let index = sets.length + 1;
  let candidate = `${smallId}:set:${index}`;
  const existing = new Set(sets.map((item) => item.id));
  while (existing.has(candidate)) candidate = `${smallId}:set:${++index}`;
  return candidate;
}

function nextCategoryId(prefix: string, existingIds: Set<string>): string {
  let index = 1;
  let candidate = `${prefix}:${index}`;
  while (existingIds.has(candidate)) candidate = `${prefix}:${++index}`;
  return candidate;
}

function collectCategoryIds(document: TagSetDocument): Set<string> {
  const ids = new Set<string>();
  document.majorCategories.forEach((major) => {
    ids.add(major.id);
    major.mediumCategories.forEach((medium) => {
      ids.add(medium.id);
      medium.smallCategories.forEach((small) => ids.add(small.id));
    });
  });
  return ids;
}

function normalize(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

function visibleText(...values: string[]): string {
  return values.filter(Boolean).join(" ");
}

function editableTagSetTags(tags: string[]): string {
  return tags.length ? `${tags.join(", ")},` : "";
}

function imageFileNameFromDisplayName(displayName: string, fallbackName: string): string {
  return `${(displayName || fallbackName).trim() || "tag-set-image"}.webp`;
}

function imageFileNameWithExtension(fileName: string, extension: string): string {
  const base = fileName.replace(/\.[^.]+$/u, "") || "tag-set-image";
  return `${base}.${extension}`;
}

function imageTypeExtension(type: string): string {
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  if (type.includes("gif")) return "gif";
  if (type.includes("avif")) return "avif";
  return "jpg";
}

function blobFromCanvas(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

const TAG_SET_IMAGE_MAX_SIDE = 768;
const TAG_SET_IMAGE_WEBP_QUALITY = 0.56;
export const PROMPT_WORKBENCH_DATA_DIR_KEY = "prompt-workbench:tag-set-image-data-dir";

export function readPromptWorkbenchDataDir(): string {
  try {
    return window.localStorage.getItem(PROMPT_WORKBENCH_DATA_DIR_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function writePromptWorkbenchDataDir(value: string): void {
  try {
    window.localStorage.setItem(PROMPT_WORKBENCH_DATA_DIR_KEY, value.trim());
  } catch {
    // Ignore storage failures; image saving still uses the server default.
  }
}

async function compressedImageBlob(source: Blob): Promise<Blob> {
  if (!source.type.startsWith("image/")) return source;
  const bitmap = await createImageBitmap(source);
  try {
    const scale = Math.min(1, TAG_SET_IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = window.document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return source;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return (await blobFromCanvas(canvas, "image/webp", TAG_SET_IMAGE_WEBP_QUALITY)) ?? source;
  } finally {
    bitmap.close();
  }
}

function extractPreviewImageUrl(pageSource: string, pageUrl: string): string {
  const document = new DOMParser().parseFromString(pageSource, "text/html");
  const selectors = [
    'meta[property="og:image"]',
    'meta[name="twitter:image"]',
    'meta[property="twitter:image"]',
    "img",
  ];
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    const value = element instanceof HTMLMetaElement ? element.content : element?.getAttribute("src");
    if (value) return new URL(value, pageUrl).toString();
  }
  throw new Error("ページ内に画像が見つかりませんでした。");
}

function parseBlueskyPostUrl(sourceUrl: string): { handle: string; rkey: string } | null {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return null;
  }
  if (url.hostname !== "bsky.app") return null;
  const match = url.pathname.match(/^\/profile\/([^/]+)\/post\/([^/]+)/u);
  if (!match) return null;
  return { handle: decodeURIComponent(match[1]), rkey: decodeURIComponent(match[2]) };
}

async function blueskyPostImageUrl(sourceUrl: string): Promise<string | null> {
  const post = parseBlueskyPostUrl(sourceUrl);
  if (!post) return null;
  const repo = post.handle.startsWith("did:") ? post.handle : await resolveBlueskyHandle(post.handle);
  const recordUrl = new URL("https://public.api.bsky.app/xrpc/com.atproto.repo.getRecord");
  recordUrl.searchParams.set("repo", repo);
  recordUrl.searchParams.set("collection", "app.bsky.feed.post");
  recordUrl.searchParams.set("rkey", post.rkey);
  const response = await fetch(recordUrl);
  if (!response.ok) throw new Error(`Bluesky投稿を取得できませんでした: HTTP ${response.status}`);
  const body = await response.json();
  const image = body?.value?.embed?.images?.[0]?.image;
  const cid = image?.ref?.["$link"];
  if (!cid) throw new Error("Bluesky投稿に画像が見つかりませんでした。");
  const extension = image?.mimeType === "image/png" ? "png" : "jpeg";
  return `https://cdn.bsky.app/img/feed_fullsize/plain/${repo}/${cid}@${extension}`;
}

function blueskySourceImageProxyUrl(sourceUrl: string): string | null {
  if (!parseBlueskyPostUrl(sourceUrl)) return null;
  const url = new URL("/prompt-workbench-data/source-image", window.location.href);
  url.searchParams.set("url", sourceUrl);
  return url.toString();
}

function savedTagSetImageUrl(imagePath: string, dataDirectory = ""): string {
  if (!imagePath.startsWith("/prompt-workbench-data/tag-set-images/")) return "";
  const query = new URLSearchParams();
  if (dataDirectory.trim()) query.set("dataDir", dataDirectory.trim());
  return query.size ? `${imagePath}?${query.toString()}` : imagePath;
}

async function resolveBlueskyHandle(handle: string): Promise<string> {
  const url = new URL("https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle");
  url.searchParams.set("handle", handle);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Blueskyハンドルを解決できませんでした: HTTP ${response.status}`);
  const body = await response.json();
  if (typeof body?.did !== "string" || !body.did) throw new Error("BlueskyのDIDを取得できませんでした。");
  return body.did;
}

async function saveImageBlob(blob: Blob, suggestedName: string, dataDirectory = ""): Promise<{ fileName: string; path: string }> {
  const outputBlob = await compressedImageBlob(blob).catch(() => blob);
  const outputName = imageFileNameWithExtension(
    suggestedName,
    outputBlob.type === "image/webp" ? "webp" : imageTypeExtension(outputBlob.type || blob.type),
  );
  const response = await fetch("/prompt-workbench-data/tag-set-images", {
    method: "POST",
    headers: {
      "Content-Type": outputBlob.type || "image/webp",
      "X-File-Name": encodeURIComponent(outputName),
      ...(dataDirectory.trim() ? { "X-Prompt-Workbench-Data-Dir": dataDirectory.trim() } : {}),
    },
    body: outputBlob,
  });
  if (!response.ok) throw new Error(`画像をローカル保存できませんでした: HTTP ${response.status}`);
  return (await response.json()) as { fileName: string; path: string };
}

async function deleteSavedImage(pathOrUrl: string, dataDirectory = ""): Promise<void> {
  let fileName = "";
  try {
    fileName = new URL(pathOrUrl, window.location.href).pathname.split("/").pop() ?? "";
  } catch {
    fileName = pathOrUrl.split(/[\\/]/u).pop() ?? "";
  }
  try {
    fileName = decodeURIComponent(fileName);
  } catch {
    // Keep the original value if it is not URI-encoded.
  }
  if (!fileName.toLowerCase().endsWith(".webp")) return;
  const url = new URL("/prompt-workbench-data/tag-set-images", window.location.href);
  url.searchParams.set("file", fileName);
  if (dataDirectory.trim()) url.searchParams.set("dataDir", dataDirectory.trim());
  const response = await fetch(url, { method: "DELETE" });
  if (!response.ok) throw new Error(`保存済み画像を削除できませんでした: HTTP ${response.status}`);
}

function firstSmallSelection(document: TagSetDocument): SmallSelection {
  for (const [majorIndex, major] of document.majorCategories.entries()) {
    for (const [mediumIndex, medium] of major.mediumCategories.entries()) {
      if (medium.smallCategories.length) return { majorIndex, mediumIndex, smallIndex: 0 };
    }
  }
  return { majorIndex: 0, mediumIndex: 0, smallIndex: 0 };
}

function resolveSmall(document: TagSetDocument, selection: SmallSelection): TagSetSmallCategory | null {
  return document.majorCategories[selection.majorIndex]?.mediumCategories[selection.mediumIndex]?.smallCategories[
    selection.smallIndex
  ] ?? null;
}

function resolveMedium(document: TagSetDocument, selection: SmallSelection): TagSetMediumCategory | null {
  return document.majorCategories[selection.majorIndex]?.mediumCategories[selection.mediumIndex] ?? null;
}

function resolveMajor(document: TagSetDocument, selection: SmallSelection): TagSetMajorCategory | null {
  return document.majorCategories[selection.majorIndex] ?? null;
}

function resolveSet(document: TagSetDocument, selection: SetSelection | null): TagSetItem | null {
  if (!selection) return null;
  return resolveSmall(document, selection)?.sets[selection.setIndex] ?? null;
}

function sameSmall(left: SmallSelection, right: SmallSelection): boolean {
  return (
    left.majorIndex === right.majorIndex &&
    left.mediumIndex === right.mediumIndex &&
    left.smallIndex === right.smallIndex
  );
}

function moveItem<T>(items: T[], fromIndex: number, toIndex: number): void {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
  const [item] = items.splice(fromIndex, 1);
  items.splice(Math.min(toIndex, items.length), 0, item);
}

function tagSetCategoryKey(level: TagSetCategoryLevel, data: Partial<SmallSelection>): string {
  if (level === "major") return `major:${data.majorIndex}`;
  if (level === "medium") return `medium:${data.majorIndex}:${data.mediumIndex}`;
  return `small:${data.majorIndex}:${data.mediumIndex}:${data.smallIndex}`;
}

function originTitle(raw: TagSetItem["raw"]): string {
  const origin = itemOrigin(raw);
  if (origin === "local") return "由来: 自分で追加";
  if (origin === "imported") return "由来: Import";
  return "由来: Default";
}

function expandableCategoryKeys(document: TagSetDocument): string[] {
  const keys: string[] = [];
  document.majorCategories.forEach((major, majorIndex) => {
    if (major.mediumCategories.length) keys.push(tagSetCategoryKey("major", { majorIndex }));
    major.mediumCategories.forEach((medium, mediumIndex) => {
      if (medium.smallCategories.length) keys.push(tagSetCategoryKey("medium", { majorIndex, mediumIndex }));
    });
  });
  return keys;
}

function TagSetCategoryRow({
  id,
  level,
  label,
  labelEn,
  originTitle,
  count,
  selected = false,
  expanded = false,
  hasChildren = false,
  data,
  editing,
  onToggle,
  onSelect,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
}: CategoryRowProps) {
  const [draftLabel, setDraftLabel] = useState(label);
  const [draftLabelEn, setDraftLabelEn] = useState(labelEn);
  const draggable = useDraggable({ id: `tag-set-category:${id}`, data });
  const droppable = useDroppable({ id: `tag-set-category-target:${id}`, data: { ...data, type: "tag-set-category-target" } });
  const setNodeRef = (node: HTMLElement | null) => {
    draggable.setNodeRef(node);
    droppable.setNodeRef(node);
  };

  if (editing) {
    return (
      <div className={`tag-set-tree-row level-${level} is-editing`}>
        <span />
        <span />
        <span className="tag-set-level-mark">{level === "major" ? "大" : level === "medium" ? "中" : "小"}</span>
        <span className="tag-set-category-editor">
          <input value={draftLabel} onChange={(event) => setDraftLabel(event.target.value)} aria-label="日本語名" />
          <input value={draftLabelEn} onChange={(event) => setDraftLabelEn(event.target.value)} aria-label="英語名" />
        </span>
        <span className="tag-set-row-actions">
          <button type="button" onClick={() => onSaveEdit(draftLabel.trim(), draftLabelEn.trim())} aria-label="保存">
            <Check />
          </button>
          <button type="button" onClick={onCancelEdit} aria-label="キャンセル">
            <X />
          </button>
        </span>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      className={`tag-set-tree-row level-${level} ${selected ? "is-selected" : ""} ${droppable.isOver ? "is-drop-target" : ""}`}
      role="button"
      tabIndex={0}
      style={{ transform: CSS.Translate.toString(draggable.transform) }}
      title={originTitle}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect?.();
        }
      }}
    >
      <button
        className="tree-toggle"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onToggle?.();
        }}
        aria-label={expanded ? `${label}を折りたたむ` : `${label}を展開`}
        disabled={!hasChildren}
      >
        {hasChildren ? expanded ? <ChevronDown /> : <ChevronRight /> : <span />}
      </button>
      <span className="tag-set-drag-handle" {...draggable.listeners} {...draggable.attributes} aria-label={`${label}をドラッグ`}>
        <GripVertical />
      </span>
      <span className="tag-set-level-mark">{level === "major" ? "大" : level === "medium" ? "中" : "小"}</span>
      <span className="tag-set-category-label">
        <strong>{label}</strong>
        {labelEn && <small>{labelEn}</small>}
      </span>
      <span className="tag-set-row-actions">
        <small>{count}</small>
        <button type="button" onClick={(event) => { event.stopPropagation(); onStartEdit(); }} aria-label={`${label}を編集`}>
          <Pencil />
        </button>
        <button type="button" onClick={(event) => { event.stopPropagation(); onDelete(); }} aria-label={`${label}を削除`}>
          <Trash2 />
        </button>
      </span>
    </div>
  );
}

function TagSetSetRow({
  setItem,
  selection,
  selected,
  favorite,
  imageSrc,
  onSelect,
  onFavoriteMenu,
  onDelete,
}: SetRowProps) {
  const draggable = useDraggable({ id: `tag-set-set:${setItem.id}`, data: { ...selection, type: "tag-set-set" } });
  const droppable = useDroppable({
    id: `tag-set-set-target:${setItem.id}`,
    data: { ...selection, type: "tag-set-set-target" },
  });
  const setNodeRef = (node: HTMLElement | null) => {
    draggable.setNodeRef(node);
    droppable.setNodeRef(node);
  };

  return (
    <div
      ref={setNodeRef}
      className={`tag-set-list-row ${selected ? "is-selected" : ""} ${favorite ? "is-favorite" : ""} ${droppable.isOver ? "is-drop-target" : ""}`}
      role="button"
      tabIndex={0}
      style={{ transform: CSS.Translate.toString(draggable.transform) }}
      title={originTitle(setItem.raw)}
      onClick={onSelect}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onFavoriteMenu(setItem, { x: event.clientX, y: event.clientY });
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
        if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          onFavoriteMenu(setItem, { x: rect.right - 28, y: rect.top + rect.height / 2 });
        }
      }}
    >
      <span className="tag-set-drag-handle" {...draggable.listeners} {...draggable.attributes} aria-label={`${setItem.name}をドラッグ`}>
        <GripVertical />
      </span>
      <span className={`tag-set-list-thumb ${imageSrc ? "has-image" : ""}`}>
        {imageSrc ? (
          <>
            <span className="tag-set-list-thumb-frame">
            <img src={imageSrc} alt={`${setItem.nameJa || setItem.name || "タグセット"}の参照画像`} loading="lazy" />
            </span>
          </>
        ) : (
          <Image aria-hidden="true" />
        )}
      </span>
      <span className="tag-set-list-main">
        <strong>
          <Star
            className={`favorite-star ${favorite ? "is-favorite" : ""}`}
            aria-label={favorite ? "お気に入り" : undefined}
            aria-hidden={!favorite}
            fill={favorite ? "currentColor" : "none"}
          />
          {setItem.nameJa || setItem.name || setItem.id}
        </strong>
        {setItem.creator && <small className="tag-set-list-creator">製作者: {setItem.creator}</small>}
        {setItem.nameEn && <small>{setItem.nameEn}</small>}
      </span>
      <span className="tag-set-row-actions">
        <small className="tag-set-list-count">{setItem.tags.length} tags</small>
        <button type="button" onClick={(event) => { event.stopPropagation(); onDelete(); }} aria-label={`${setItem.name}を削除`}>
          <Trash2 />
        </button>
      </span>
    </div>
  );
}

export function TagSetEditor({
  document,
  onChange,
  dragSounds,
  soundEnabled,
  promptWorkbenchDataDir,
  favoriteTagSetKeys,
  showFavoritesOnly,
  onToggleFavorite,
}: TagSetEditorProps) {
  const [categoryQuery, setCategoryQuery] = useState("");
  const [setQuery, setSetQuery] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);
  const [addCategoryLevel, setAddCategoryLevel] = useState<TagSetCategoryLevel>("major");
  const [addCategoryParent, setAddCategoryParent] = useState("");
  const [addCategoryLabel, setAddCategoryLabel] = useState("");
  const [addCategoryLabelEn, setAddCategoryLabelEn] = useState("");
  const [editingCategoryKey, setEditingCategoryKey] = useState<string | null>(null);
  const [favoriteMenu, setFavoriteMenu] = useState<FavoriteMenuState | null>(null);
  const [expandedCategoryKeys, setExpandedCategoryKeys] = useState<Set<string>>(
    () => new Set(expandableCategoryKeys(document)),
  );
  const [sidebarWidth, setSidebarWidth] = useState(310);
  const [setListWidth, setSetListWidth] = useState(340);
  const setRowHeight = 84;
  const [smallSelection, setSmallSelection] = useState<SmallSelection>(() => firstSmallSelection(document));
  const [setSelection, setSetSelection] = useState<SetSelection | null>(() => {
    const first = firstSmallSelection(document);
    return resolveSmall(document, first)?.sets.length ? { ...first, setIndex: 0 } : null;
  });
  const imageFileInputRef = useRef<HTMLInputElement>(null);
  const imagePreviewUrlsRef = useRef<Record<string, string>>({});
  const [imagePreviewUrls, setImagePreviewUrls] = useState<Record<string, string>>({});
  const [imageStatus, setImageStatus] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const selectedSmall = resolveSmall(document, smallSelection) ?? resolveSmall(document, firstSmallSelection(document));
  const selectedMajor = resolveMajor(document, smallSelection);
  const selectedMedium = resolveMedium(document, smallSelection);
  const selectedSet = resolveSet(document, setSelection);
  const selectedSetKey = selectedSet?.id ?? null;
  const [tagDraft, setTagDraft] = useState(() => editableTagSetTags(selectedSet?.tags ?? []));
  const categoryNeedle = normalize(categoryQuery);
  const setNeedle = normalize(setQuery);
  const expandableKeys = useMemo(() => expandableCategoryKeys(document), [document]);
  const allCategoriesExpanded = expandableKeys.every((key) => expandedCategoryKeys.has(key));
  const addParentOptions = useMemo(() => {
    if (addCategoryLevel === "major") return [];
    if (addCategoryLevel === "medium") {
      return document.majorCategories.map((major, majorIndex) => ({
        id: String(majorIndex),
        label: major.labelJa,
      }));
    }
    return document.majorCategories.flatMap((major, majorIndex) =>
      major.mediumCategories.map((medium, mediumIndex) => ({
        id: `${majorIndex}:${mediumIndex}`,
        label: `${major.labelJa} › ${medium.labelJa}`,
      })),
    );
  }, [addCategoryLevel, document]);
  const filteredSets = useMemo(() => {
    const sets = selectedSmall?.sets ?? [];
    return sets
      .map((setItem, index) => ({ setItem, index }))
      .filter(({ setItem }) => !showFavoritesOnly || favoriteTagSetKeys.has(favoriteTagSetKey(setItem.id)))
      .filter(({ setItem }) => {
        if (!setNeedle) return true;
        return normalize(visibleText(setItem.name, setItem.nameJa, setItem.nameEn, setItem.creator, setItem.tags.join(" "))).includes(
          setNeedle,
        );
      });
  }, [favoriteTagSetKeys, selectedSmall, setNeedle, showFavoritesOnly]);

  const update = (recipe: (draft: TagSetDocument) => void) => {
    const draft = structuredClone(document);
    recipe(draft);
    onChange(draft);
  };

  useEffect(() => {
    setTagDraft(editableTagSetTags(selectedSet?.tags ?? []));
    setImageStatus("");
  }, [selectedSetKey]);

  useEffect(
    () => () => {
      Object.values(imagePreviewUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
    },
    [],
  );

  const toggleAllCategories = () => {
    setExpandedCategoryKeys(allCategoriesExpanded ? new Set() : new Set(expandableKeys));
  };

  const openAddCategoryForm = () => {
    const defaultLevel: TagSetCategoryLevel = selectedMedium ? "small" : document.majorCategories.length ? "medium" : "major";
    setAddCategoryLevel(defaultLevel);
    setAddCategoryParent(
      defaultLevel === "major"
        ? ""
        : defaultLevel === "medium"
          ? "0"
          : `${smallSelection.majorIndex}:${smallSelection.mediumIndex}`,
    );
    setAddCategoryLabel("");
    setAddCategoryLabelEn("");
    setAddingCategory(true);
  };

  const closeAddCategoryForm = () => {
    setAddingCategory(false);
    setAddCategoryLabel("");
    setAddCategoryLabelEn("");
  };

  const changeAddCategoryLevel = (level: TagSetCategoryLevel) => {
    setAddCategoryLevel(level);
    setAddCategoryParent(
      level === "major"
        ? ""
        : level === "medium"
          ? "0"
          : `${smallSelection.majorIndex}:${smallSelection.mediumIndex}`,
    );
  };

  const addCategory = () => {
    const labelJa = addCategoryLabel.trim();
    if (!labelJa || (addCategoryLevel !== "major" && !addCategoryParent)) return;
    let nextSmallSelection: SmallSelection | null = null;
    const expandedKeysToAdd: string[] = [];
    update((draft) => {
      const ids = collectCategoryIds(draft);
      if (addCategoryLevel === "major") {
        const id = nextCategoryId("tagset:major", ids);
        draft.majorCategories.push({
          id,
          labelJa,
          labelEn: addCategoryLabelEn.trim(),
          mediumCategories: [],
          raw: markLocal({}),
        });
        return;
      }
      if (addCategoryLevel === "medium") {
        const majorIndex = Number(addCategoryParent);
        const major = draft.majorCategories[majorIndex];
        if (!major) return;
        const id = nextCategoryId(`${major.id}:medium`, ids);
        major.mediumCategories.push({
          id,
          labelJa,
          labelEn: addCategoryLabelEn.trim(),
          smallCategories: [],
          raw: markLocal({}),
        });
        expandedKeysToAdd.push(tagSetCategoryKey("major", { majorIndex }));
        return;
      }
      const [majorIndex, mediumIndex] = addCategoryParent.split(":").map(Number);
      const medium = draft.majorCategories[majorIndex]?.mediumCategories[mediumIndex];
      if (!medium) return;
      const id = nextCategoryId(`${medium.id}:small`, ids);
      const smallIndex = medium.smallCategories.length;
      medium.smallCategories.push({
        id,
        labelJa,
        labelEn: addCategoryLabelEn.trim(),
        sets: [],
        raw: markLocal({}),
      });
      expandedKeysToAdd.push(
        tagSetCategoryKey("major", { majorIndex }),
        tagSetCategoryKey("medium", { majorIndex, mediumIndex }),
      );
      nextSmallSelection = { majorIndex, mediumIndex, smallIndex };
    });
    if (expandedKeysToAdd.length) {
      setExpandedCategoryKeys((current) => new Set([...current, ...expandedKeysToAdd]));
    }
    if (nextSmallSelection) {
      setSmallSelection(nextSmallSelection);
      setSetSelection(null);
    }
    closeAddCategoryForm();
  };

  const startPaneResize = (
    pane: "sidebar" | "setList",
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = pane === "sidebar" ? sidebarWidth : setListWidth;
    const setWidth = pane === "sidebar" ? setSidebarWidth : setSetListWidth;
    const minWidth = pane === "sidebar" ? 240 : 280;
    const maxWidth = pane === "sidebar" ? 560 : 620;
    const onPointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + moveEvent.clientX - startX));
      setWidth(nextWidth);
    };
    const stopResize = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.document.body.classList.remove("is-resizing-pane");
    };
    window.document.body.classList.add("is-resizing-pane");
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResize, { once: true });
  };

  const dragTargetKey = (data: DragData | undefined): string | null => {
    if (!data) return null;
    if (data.type === "tag-set-set-target") {
      return `set:${data.majorIndex}:${data.mediumIndex}:${data.smallIndex}:${data.setIndex}`;
    }
    if (data.type === "tag-set-category-target") {
      return `category:${data.level}:${data.majorIndex ?? "x"}:${data.mediumIndex ?? "x"}:${data.smallIndex ?? "x"}`;
    }
    return null;
  };

  const onTagSetDragStart = (_event: DragStartEvent) => {
    dragSounds.start(soundEnabled);
  };

  const onTagSetDragOver = (event: DragOverEvent) => {
    dragSounds.moveTo(dragTargetKey(event.over?.data.current as DragData | undefined), soundEnabled);
  };

  const applyCategoryEdit = (level: TagSetCategoryLevel, selection: Partial<SmallSelection>, labelJa: string, labelEn: string) => {
    if (!labelJa) return;
    update((draft) => {
      if (level === "major" && selection.majorIndex !== undefined) {
        const target = draft.majorCategories[selection.majorIndex];
        if (target) {
          target.labelJa = labelJa;
          target.labelEn = labelEn;
        }
      }
      if (level === "medium" && selection.majorIndex !== undefined && selection.mediumIndex !== undefined) {
        const target = draft.majorCategories[selection.majorIndex]?.mediumCategories[selection.mediumIndex];
        if (target) {
          target.labelJa = labelJa;
          target.labelEn = labelEn;
        }
      }
      if (
        level === "small" &&
        selection.majorIndex !== undefined &&
        selection.mediumIndex !== undefined &&
        selection.smallIndex !== undefined
      ) {
        const target =
          draft.majorCategories[selection.majorIndex]?.mediumCategories[selection.mediumIndex]?.smallCategories[
            selection.smallIndex
          ];
        if (target) {
          target.labelJa = labelJa;
          target.labelEn = labelEn;
        }
      }
    });
    setEditingCategoryKey(null);
  };

  const deleteCategory = (level: TagSetCategoryLevel, selection: Partial<SmallSelection>, label: string) => {
    if (!window.confirm(`${label} を削除しますか？`)) return;
    update((draft) => {
      const meta = getWorkbenchMeta(draft.original);
      const rememberSmall = (small: TagSetSmallCategory) => {
        if (itemOrigin(small.raw) === "default") meta.deletedDefaultTagSetCategoryIds.push(`small:${small.id}`);
        for (const setItem of small.sets) {
          if (itemOrigin(setItem.raw) === "default") meta.deletedDefaultTagSetIds.push(setItem.id);
        }
      };
      const rememberMedium = (medium: TagSetMediumCategory) => {
        if (itemOrigin(medium.raw) === "default") meta.deletedDefaultTagSetCategoryIds.push(`medium:${medium.id}`);
        medium.smallCategories.forEach(rememberSmall);
      };
      const rememberMajor = (major: TagSetMajorCategory) => {
        if (itemOrigin(major.raw) === "default") meta.deletedDefaultTagSetCategoryIds.push(`major:${major.id}`);
        major.mediumCategories.forEach(rememberMedium);
      };
      if (level === "major" && selection.majorIndex !== undefined) {
        const major = draft.majorCategories[selection.majorIndex];
        if (major) rememberMajor(major);
        draft.majorCategories.splice(selection.majorIndex, 1);
      }
      if (level === "medium" && selection.majorIndex !== undefined && selection.mediumIndex !== undefined) {
        const medium = draft.majorCategories[selection.majorIndex]?.mediumCategories[selection.mediumIndex];
        if (medium) rememberMedium(medium);
        draft.majorCategories[selection.majorIndex]?.mediumCategories.splice(selection.mediumIndex, 1);
      }
      if (
        level === "small" &&
        selection.majorIndex !== undefined &&
        selection.mediumIndex !== undefined &&
        selection.smallIndex !== undefined
      ) {
        const small =
          draft.majorCategories[selection.majorIndex]?.mediumCategories[selection.mediumIndex]?.smallCategories[
            selection.smallIndex
          ];
        if (small) rememberSmall(small);
        draft.majorCategories[selection.majorIndex]?.mediumCategories[selection.mediumIndex]?.smallCategories.splice(
          selection.smallIndex,
          1,
        );
      }
      writeWorkbenchMeta(draft.original, meta);
    });
    const next = firstSmallSelection(document);
    setSmallSelection(next);
    setSetSelection(resolveSmall(document, next)?.sets.length ? { ...next, setIndex: 0 } : null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const active = event.active.data.current as DragData | undefined;
    const over = event.over?.data.current as DragData | undefined;
    let successful = false;
    let nextSmallSelection: SmallSelection | null = null;
    let movedSmallSetCount = 0;
    if (!active || !over) {
      dragSounds.cancel();
      return;
    }
    if (active.type === "tag-set-set" && over.type === "tag-set-set-target") {
      let nextSetSelection: SetSelection | null = null;
      update((draft) => {
        const sourceSets =
          draft.majorCategories[active.majorIndex].mediumCategories[active.mediumIndex].smallCategories[
            active.smallIndex
          ].sets;
        const item = sourceSets.splice(active.setIndex, 1)[0];
        if (!item) return;
        const targetSets =
          draft.majorCategories[over.majorIndex].mediumCategories[over.mediumIndex].smallCategories[
            over.smallIndex
          ].sets;
        const sameParent = sameSmall(active, over);
        const adjustedIndex = sameParent && over.setIndex > active.setIndex ? over.setIndex - 1 : over.setIndex;
        const insertIndex = Math.min(Math.max(adjustedIndex, 0), targetSets.length);
        targetSets.splice(insertIndex, 0, item);
        nextSetSelection = { ...over, setIndex: insertIndex };
      });
      if (nextSetSelection) {
        setSmallSelection({
          majorIndex: nextSetSelection.majorIndex,
          mediumIndex: nextSetSelection.mediumIndex,
          smallIndex: nextSetSelection.smallIndex,
        });
        setSetSelection(nextSetSelection);
        setExpandedCategoryKeys((current) => new Set([
          ...current,
          tagSetCategoryKey("major", nextSetSelection),
          tagSetCategoryKey("medium", nextSetSelection),
        ]));
      }
      successful =
        Boolean(nextSetSelection) &&
        (!sameSmall(active, over) || nextSetSelection.setIndex !== active.setIndex);
      dragSounds.finish(successful, soundEnabled);
      return;
    }
    if (active.type === "tag-set-set" && over.type === "tag-set-category-target" && over.level === "small") {
      let nextSetSelection: SetSelection | null = null;
      update((draft) => {
        const sourceSets =
          draft.majorCategories[active.majorIndex].mediumCategories[active.mediumIndex].smallCategories[
            active.smallIndex
          ].sets;
        const item = sourceSets.splice(active.setIndex, 1)[0];
        if (!item) return;
        if (over.majorIndex === undefined || over.mediumIndex === undefined || over.smallIndex === undefined) return;
        const targetSets =
          draft.majorCategories[over.majorIndex].mediumCategories[over.mediumIndex].smallCategories[over.smallIndex].sets;
        const insertIndex = targetSets.length;
        targetSets.push(item);
        nextSetSelection = {
          majorIndex: over.majorIndex,
          mediumIndex: over.mediumIndex,
          smallIndex: over.smallIndex,
          setIndex: insertIndex,
        };
      });
      if (nextSetSelection) {
        setSmallSelection({
          majorIndex: nextSetSelection.majorIndex,
          mediumIndex: nextSetSelection.mediumIndex,
          smallIndex: nextSetSelection.smallIndex,
        });
        setSetSelection(nextSetSelection);
        setExpandedCategoryKeys((current) => new Set([
          ...current,
          tagSetCategoryKey("major", nextSetSelection),
          tagSetCategoryKey("medium", nextSetSelection),
        ]));
      }
      successful = Boolean(nextSetSelection) && !sameSmall(active, nextSetSelection);
      dragSounds.finish(successful, soundEnabled);
      return;
    }
    if (active.type !== "tag-set-category" || over.type !== "tag-set-category-target") {
      dragSounds.cancel();
      return;
    }
    update((draft) => {
      if (active.level === "major" && over.level === "major") {
        moveItem(draft.majorCategories, active.majorIndex ?? -1, over.majorIndex ?? -1);
      }
      if (active.level === "medium" && active.majorIndex !== undefined && active.mediumIndex !== undefined) {
        const item = draft.majorCategories[active.majorIndex]?.mediumCategories.splice(active.mediumIndex, 1)[0];
        if (!item) return;
        const targetMajorIndex = over.majorIndex ?? active.majorIndex;
        const targetMediums = draft.majorCategories[targetMajorIndex]?.mediumCategories;
        if (!targetMediums) return;
        const targetIndex = over.level === "medium" && over.mediumIndex !== undefined ? over.mediumIndex : targetMediums.length;
        targetMediums.splice(Math.min(targetIndex, targetMediums.length), 0, item);
      }
      if (
        active.level === "small" &&
        active.majorIndex !== undefined &&
        active.mediumIndex !== undefined &&
        active.smallIndex !== undefined
      ) {
        const sourceSmalls =
          draft.majorCategories[active.majorIndex]?.mediumCategories[active.mediumIndex]?.smallCategories;
        const item = sourceSmalls?.splice(active.smallIndex, 1)[0];
        if (!item) return;
        movedSmallSetCount = item.sets.length;
        const targetMajorIndex = over.majorIndex ?? active.majorIndex;
        const targetMediumIndex = over.level === "medium" ? over.mediumIndex : over.mediumIndex ?? active.mediumIndex;
        if (targetMajorIndex === undefined || targetMediumIndex === undefined) return;
        const targetSmalls =
          draft.majorCategories[targetMajorIndex]?.mediumCategories[targetMediumIndex]?.smallCategories;
        if (!targetSmalls) return;
        const sameParent = active.majorIndex === targetMajorIndex && active.mediumIndex === targetMediumIndex;
        const requestedIndex =
          over.level === "small" && over.smallIndex !== undefined ? over.smallIndex : targetSmalls.length;
        const adjustedIndex = sameParent && requestedIndex > active.smallIndex ? requestedIndex - 1 : requestedIndex;
        const insertIndex = Math.min(Math.max(adjustedIndex, 0), targetSmalls.length);
        targetSmalls.splice(insertIndex, 0, item);
        nextSmallSelection = { majorIndex: targetMajorIndex, mediumIndex: targetMediumIndex, smallIndex: insertIndex };
      }
    });
    if (nextSmallSelection) {
      setSmallSelection(nextSmallSelection);
      setSetSelection(movedSmallSetCount > 0 ? { ...nextSmallSelection, setIndex: 0 } : null);
      setExpandedCategoryKeys((current) => new Set([
        ...current,
        tagSetCategoryKey("major", nextSmallSelection),
        tagSetCategoryKey("medium", nextSmallSelection),
      ]));
    }
    successful = true;
    dragSounds.finish(successful, soundEnabled);
  };

  const selectSmall = (next: SmallSelection) => {
    setSmallSelection(next);
    const small = resolveSmall(document, next);
    setSetSelection(small?.sets.length ? { ...next, setIndex: 0 } : null);
  };

  const addSet = () => {
    if (!selectedSmall) return;
    const nextIndex = selectedSmall.sets.length;
    update((draft) => {
      const target = draft.majorCategories[smallSelection.majorIndex].mediumCategories[smallSelection.mediumIndex]
        .smallCategories[smallSelection.smallIndex];
      const id = nextSetId(target.id, target.sets);
      target.sets.push({
        id,
        name: "",
        nameJa: "",
        nameEn: "",
        creator: "",
        sourceUrl: "",
        imageUrl: "",
        imagePath: "",
        tags: [],
        raw: markLocal({}),
      });
    });
    setSetSelection({ ...smallSelection, setIndex: nextIndex });
  };

  const deleteSelectedSet = () => {
    if (!setSelection || !selectedSet) return;
    deleteSet(setSelection, selectedSet);
  };

  const deleteSet = (targetSelection: SetSelection, targetSet: TagSetItem) => {
    const deleteName = targetSet.name || targetSet.id;
    if (!window.confirm(`${deleteName} を削除しますか？`)) return;
    const nextIndex = Math.max(0, targetSelection.setIndex - 1);
    update((draft) => {
      const meta = getWorkbenchMeta(draft.original);
      if (itemOrigin(targetSet.raw) === "default") {
        meta.deletedDefaultTagSetIds.push(targetSet.id);
        writeWorkbenchMeta(draft.original, meta);
      }
      draft.majorCategories[targetSelection.majorIndex].mediumCategories[targetSelection.mediumIndex].smallCategories[
        targetSelection.smallIndex
      ].sets.splice(targetSelection.setIndex, 1);
    });
    const nextSmall = resolveSmall(document, targetSelection);
    setSetSelection(nextSmall && nextSmall.sets.length > 1 ? { ...targetSelection, setIndex: nextIndex } : null);
  };

  const editSelectedSet = (recipe: (item: TagSetItem) => void) => {
    if (!setSelection) return;
    update((draft) => {
      const target =
        draft.majorCategories[setSelection.majorIndex].mediumCategories[setSelection.mediumIndex].smallCategories[
          setSelection.smallIndex
        ].sets[setSelection.setIndex];
      if (target) recipe(target);
    });
  };

  const setLocalImagePreview = (setId: string, file: File) => {
    setImagePreviewUrls((current) => {
      if (current[setId]) URL.revokeObjectURL(current[setId]);
      const next = { ...current, [setId]: URL.createObjectURL(file) };
      imagePreviewUrlsRef.current = next;
      return next;
    });
  };

  const fetchImageFromSourcePage = async () => {
    if (!selectedSet?.sourceUrl) {
      setImageStatus("出典URLを入力してください。");
      return;
    }
    setImageStatus("画像を探しています…");
    try {
      const imageUrl = await blueskyPostImageUrl(selectedSet.sourceUrl).catch(() => null);
      let sourceImageUrl = blueskySourceImageProxyUrl(selectedSet.sourceUrl) ?? imageUrl;
      if (!sourceImageUrl) {
        const pageResponse = await fetch(selectedSet.sourceUrl);
        if (!pageResponse.ok) throw new Error(`ページを取得できませんでした: HTTP ${pageResponse.status}`);
        sourceImageUrl = extractPreviewImageUrl(await pageResponse.text(), selectedSet.sourceUrl);
      }
      const imageResponse = await fetch(sourceImageUrl);
      if (!imageResponse.ok) throw new Error(`画像を取得できませんでした: HTTP ${imageResponse.status}`);
      const blob = await imageResponse.blob();
      const suggestedName = imageFileNameFromDisplayName(
        selectedSet.name,
        selectedSet.nameJa || selectedSet.nameEn || selectedSet.id,
      );
      const savedImage = await saveImageBlob(blob, suggestedName, promptWorkbenchDataDir);
      editSelectedSet((item) => {
        item.imageUrl = savedImage.path;
        item.imagePath = savedImage.path;
      });
      setImageStatus(`${savedImage.fileName} を保存しました。`);
    } catch (error) {
      setImageStatus(error instanceof Error ? error.message : "画像を取得できませんでした。");
    }
  };

  const replaceImageWithLocalFile = (file?: File) => {
    if (!selectedSet || !file) return;
    setLocalImagePreview(selectedSet.id, file);
    editSelectedSet((item) => {
      item.imageUrl = "";
      item.imagePath = file.name;
    });
    setImageStatus(`${file.name} に差し替えました。`);
  };

  const clearSelectedSetImage = async () => {
    if (!selectedSet) return;
    const savedImagePath = selectedSet.imagePath || selectedSet.imageUrl;
    try {
      if (savedImagePath) await deleteSavedImage(savedImagePath, promptWorkbenchDataDir);
    } catch (error) {
      setImageStatus(error instanceof Error ? error.message : "保存済み画像を削除できませんでした。");
      return;
    }
    setImagePreviewUrls((current) => {
      if (current[selectedSet.id]) URL.revokeObjectURL(current[selectedSet.id]);
      const next = { ...current };
      delete next[selectedSet.id];
      imagePreviewUrlsRef.current = next;
      return next;
    });
    editSelectedSet((item) => {
      item.imageUrl = "";
      item.imagePath = "";
    });
    setImageStatus("画像を削除しました。");
  };

  const selectedSetImageSrc = selectedSet
    ? imagePreviewUrls[selectedSet.id] || savedTagSetImageUrl(selectedSet.imagePath, promptWorkbenchDataDir) || selectedSet.imageUrl
    : "";

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={onTagSetDragStart}
      onDragOver={onTagSetDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => dragSounds.cancel()}
    >
    <main
      className="tag-set-editor master-detail"
      aria-label="タグセット編集"
      onPointerDownCapture={(event) => {
        if (favoriteMenu && !(event.target as HTMLElement).closest(".tag-set-favorite-menu")) setFavoriteMenu(null);
      }}
      style={
        {
          "--tag-set-sidebar-width": `${sidebarWidth}px`,
          "--tag-set-list-width": `${setListWidth}px`,
          "--tag-set-row-height": `${setRowHeight}px`,
        } as CSSProperties
      }
    >
      <aside className="tag-set-sidebar" aria-label="タグセット分類">
        <div className="tag-set-panel-head">
          <div className="tag-set-sidebar-title">
            <strong>分類</strong>
            <button
              className="tag-set-add-category-button"
              type="button"
              onClick={() => (addingCategory ? closeAddCategoryForm() : openAddCategoryForm())}
              aria-label={addingCategory ? "分類追加フォームを閉じる" : "大中小分類を追加"}
              aria-expanded={addingCategory}
            >
              {addingCategory ? <X /> : <Plus />}
              {addingCategory ? "閉じる" : "大中小分類を追加"}
            </button>
          </div>
          {addingCategory && (
            <form
              className="tag-set-category-add-form add-form"
              aria-label="分類を追加"
              onSubmit={(event) => {
                event.preventDefault();
                addCategory();
              }}
              onKeyDown={(event) => event.key === "Escape" && closeAddCategoryForm()}
            >
              <div className="add-form-heading">
                <div>
                  <strong>分類を追加</strong>
                  <span>種類と追加先を選択</span>
                </div>
              </div>
              <fieldset className="category-level-picker">
                <legend>分類の種類</legend>
                {(["major", "medium", "small"] as const).map((level) => (
                  <label key={level} className={addCategoryLevel === level ? "is-selected" : ""}>
                    <input
                      type="radio"
                      name="tag-set-category-level"
                      value={level}
                      checked={addCategoryLevel === level}
                      onChange={() => changeAddCategoryLevel(level)}
                    />
                    <span>{level === "major" ? "大分類" : level === "medium" ? "中分類" : "小分類"}</span>
                  </label>
                ))}
              </fieldset>
              {addCategoryLevel !== "major" && (
                <label className="add-form-field">
                  <span>追加先</span>
                  <select
                    value={addCategoryParent}
                    onChange={(event) => setAddCategoryParent(event.target.value)}
                    aria-label="分類の追加先"
                  >
                    {addParentOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="add-form-field">
                <span>日本語名</span>
                <input
                  value={addCategoryLabel}
                  onChange={(event) => setAddCategoryLabel(event.target.value)}
                  placeholder={addCategoryLevel === "major" ? "例：人物" : addCategoryLevel === "medium" ? "例：服装" : "例：制服"}
                  aria-label="新しい分類の日本語名"
                />
              </label>
              <label className="add-form-field">
                <span>英語名</span>
                <input
                  value={addCategoryLabelEn}
                  onChange={(event) => setAddCategoryLabelEn(event.target.value)}
                  placeholder="任意"
                  aria-label="新しい分類の英語名"
                />
              </label>
              <div className="add-form-actions">
                <button type="button" onClick={closeAddCategoryForm}>
                  キャンセル
                </button>
                <button
                  className="primary-button"
                  type="submit"
                  disabled={!addCategoryLabel.trim() || (addCategoryLevel !== "major" && !addCategoryParent)}
                >
                  <Plus />
                  {addCategoryLevel === "major" ? "大分類" : addCategoryLevel === "medium" ? "中分類" : "小分類"}を追加
                </button>
              </div>
            </form>
          )}
          <label className="tag-set-search">
            <Search />
            <input
              value={categoryQuery}
              onChange={(event) => setCategoryQuery(event.target.value)}
              placeholder="分類を検索"
              aria-label="分類を検索"
            />
            {categoryQuery && (
              <button type="button" onClick={() => setCategoryQuery("")} aria-label="分類検索を消去">
                <X />
              </button>
            )}
          </label>
          <button type="button" onClick={toggleAllCategories}>
            {allCategoriesExpanded ? <ChevronRight /> : <ChevronDown />}
            {allCategoriesExpanded ? "すべて折りたたむ" : "すべて展開"}
          </button>
        </div>
        <div className="tag-set-tree">
          {document.majorCategories.map((major, majorIndex) => {
            const majorKey = tagSetCategoryKey("major", { majorIndex });
            const majorExpanded = Boolean(categoryNeedle) || expandedCategoryKeys.has(majorKey);
            const majorMatches = normalize(visibleText(major.labelJa, major.labelEn)).includes(categoryNeedle);
            return (
              <section className="tag-set-tree-group" key={major.id}>
                <TagSetCategoryRow
                  id={major.id}
                  level="major"
                  label={major.labelJa}
                  labelEn={major.labelEn}
                  originTitle={originTitle(major.raw)}
                  count={major.mediumCategories.length}
                  expanded={majorExpanded}
                  hasChildren={major.mediumCategories.length > 0}
                  data={{ type: "tag-set-category", level: "major", majorIndex }}
                  editing={editingCategoryKey === tagSetCategoryKey("major", { majorIndex })}
                  onToggle={() => {
                    setExpandedCategoryKeys((current) => {
                      const next = new Set(current);
                      if (next.has(majorKey)) next.delete(majorKey);
                      else next.add(majorKey);
                      return next;
                    });
                  }}
                  onStartEdit={() => setEditingCategoryKey(tagSetCategoryKey("major", { majorIndex }))}
                  onCancelEdit={() => setEditingCategoryKey(null)}
                  onSaveEdit={(labelJa, labelEn) => applyCategoryEdit("major", { majorIndex }, labelJa, labelEn)}
                  onDelete={() => deleteCategory("major", { majorIndex }, major.labelJa)}
                />
                {majorExpanded && major.mediumCategories.map((medium, mediumIndex) => {
                  const mediumKey = tagSetCategoryKey("medium", { majorIndex, mediumIndex });
                  const mediumExpanded = Boolean(categoryNeedle) || expandedCategoryKeys.has(mediumKey);
                  const mediumMatches = normalize(visibleText(medium.labelJa, medium.labelEn)).includes(categoryNeedle);
                  const visibleSmalls = medium.smallCategories
                    .map((small, smallIndex) => ({ small, smallIndex }))
                    .filter(({ small }) =>
                      !categoryNeedle ||
                      majorMatches ||
                      mediumMatches ||
                      normalize(visibleText(small.labelJa, small.labelEn)).includes(categoryNeedle),
                    );
                  if (categoryNeedle && !visibleSmalls.length) return null;
                  return (
                    <div className="tag-set-tree-branch" key={medium.id}>
                      <TagSetCategoryRow
                        id={medium.id}
                        level="medium"
                        label={medium.labelJa}
                        labelEn={medium.labelEn}
                        originTitle={originTitle(medium.raw)}
                        count={medium.smallCategories.length}
                        expanded={mediumExpanded}
                        hasChildren={medium.smallCategories.length > 0}
                        data={{ type: "tag-set-category", level: "medium", majorIndex, mediumIndex }}
                        editing={editingCategoryKey === tagSetCategoryKey("medium", { majorIndex, mediumIndex })}
                        onToggle={() => {
                          setExpandedCategoryKeys((current) => {
                            const next = new Set(current);
                            if (next.has(mediumKey)) next.delete(mediumKey);
                            else next.add(mediumKey);
                            return next;
                          });
                        }}
                        onStartEdit={() => setEditingCategoryKey(tagSetCategoryKey("medium", { majorIndex, mediumIndex }))}
                        onCancelEdit={() => setEditingCategoryKey(null)}
                        onSaveEdit={(labelJa, labelEn) =>
                          applyCategoryEdit("medium", { majorIndex, mediumIndex }, labelJa, labelEn)
                        }
                        onDelete={() => deleteCategory("medium", { majorIndex, mediumIndex }, medium.labelJa)}
                      />
                      {mediumExpanded && visibleSmalls.map(({ small, smallIndex }) => {
                        const selection = { majorIndex, mediumIndex, smallIndex };
                        return (
                          <TagSetCategoryRow
                            key={small.id}
                            id={small.id}
                            level="small"
                            label={small.labelJa}
                            labelEn={small.labelEn}
                            originTitle={originTitle(small.raw)}
                            count={small.sets.length}
                            selected={sameSmall(smallSelection, selection)}
                            data={{ type: "tag-set-category", level: "small", ...selection }}
                            editing={editingCategoryKey === tagSetCategoryKey("small", selection)}
                            onSelect={() => selectSmall(selection)}
                            onStartEdit={() => setEditingCategoryKey(tagSetCategoryKey("small", selection))}
                            onCancelEdit={() => setEditingCategoryKey(null)}
                            onSaveEdit={(labelJa, labelEn) => applyCategoryEdit("small", selection, labelJa, labelEn)}
                            onDelete={() => deleteCategory("small", selection, small.labelJa)}
                          />
                        );
                      })}
                    </div>
                  );
                })}
              </section>
            );
          })}
        </div>
      </aside>
      <button
        className="tag-set-pane-resizer"
        type="button"
        aria-label="分類ペインの幅を変更"
        onPointerDown={(event) => startPaneResize("sidebar", event)}
      />

      <section className="tag-set-list-panel" aria-label="タグセット一覧">
        <div className="tag-set-panel-head">
          <div>
            <strong>{selectedSmall?.labelJa ?? "小分類なし"}</strong>
            <span>
              {[selectedMajor?.labelJa, selectedMedium?.labelJa].filter(Boolean).join(" > ") || "分類未選択"}
            </span>
          </div>
          <label className="tag-set-search">
            <Search />
            <input
              value={setQuery}
              onChange={(event) => setSetQuery(event.target.value)}
              placeholder="セットを検索"
              aria-label="セットを検索"
            />
            {setQuery && (
              <button type="button" onClick={() => setSetQuery("")} aria-label="セット検索を消去">
                <X />
              </button>
            )}
          </label>
          <button type="button" onClick={addSet} disabled={!selectedSmall}>
            <Plus />
            セット追加
          </button>
        </div>
        <div className="tag-set-list">
          {filteredSets.length ? (
            filteredSets.map(({ setItem, index }) => {
              const selected =
                setSelection &&
                sameSmall(setSelection, smallSelection) &&
                setSelection.setIndex === index;
              return (
                <TagSetSetRow
                  key={setItem.id}
                  setItem={setItem}
                  index={index}
                  selection={{ ...smallSelection, setIndex: index }}
                  selected={Boolean(selected)}
                  favorite={favoriteTagSetKeys.has(favoriteTagSetKey(setItem.id))}
                  imageSrc={imagePreviewUrls[setItem.id] || savedTagSetImageUrl(setItem.imagePath, promptWorkbenchDataDir) || setItem.imageUrl}
                  onSelect={() => setSetSelection({ ...smallSelection, setIndex: index })}
                  onFavoriteMenu={(targetSet, point) => {
                    setFavoriteMenu({
                      setId: targetSet.id,
                      setName: targetSet.nameJa || targetSet.name || targetSet.id,
                      x: point.x,
                      y: point.y,
                    });
                  }}
                  onDelete={() => {
                    deleteSet({ ...smallSelection, setIndex: index }, setItem);
                  }}
                />
              );
            })
          ) : (
            <div className="tag-set-empty">
              <strong>セットがありません</strong>
              <p>検索条件を変えるか、新しいセットを追加してください。</p>
            </div>
          )}
        </div>
      </section>
      <button
        className="tag-set-pane-resizer"
        type="button"
        aria-label="セット一覧ペインの幅を変更"
        onPointerDown={(event) => startPaneResize("setList", event)}
      />

      <section className="tag-set-detail-panel" aria-label="タグセット詳細">
        <div className="tag-set-panel-head detail-head">
          <div>
            <strong>セット詳細</strong>
          </div>
          <button className="danger-icon-button" type="button" disabled={!selectedSet} onClick={deleteSelectedSet}>
            <Trash2 />
          </button>
        </div>
        {selectedSet ? (
          <div className="tag-set-detail-form">
            <label>
              <span>表示名</span>
              <input
                value={selectedSet.name}
                onChange={(event) =>
                  editSelectedSet((item) => {
                    item.name = event.target.value;
                    item.nameJa = event.target.value;
                  })
                }
              />
            </label>
            <label>
              <span>英語名</span>
              <input
                value={selectedSet.nameEn}
                onChange={(event) =>
                  editSelectedSet((item) => {
                    item.nameEn = event.target.value;
                  })
                }
              />
            </label>
            <label>
              <span>
                <User />
                製作者
              </span>
              <input
                value={selectedSet.creator}
                placeholder="任意"
                onChange={(event) =>
                  editSelectedSet((item) => {
                    item.creator = event.target.value;
                  })
                }
              />
            </label>
            <label>
              <span>
                <Link />
                出典URL
              </span>
              <input
                value={selectedSet.sourceUrl}
                placeholder="任意"
                onChange={(event) =>
                  editSelectedSet((item) => {
                    item.sourceUrl = event.target.value;
                  })
                }
              />
            </label>
            {selectedSet.sourceUrl && (
              <a className="tag-set-source-link" href={selectedSet.sourceUrl} target="_blank" rel="noreferrer">
                <ExternalLink />
                出典URLを開く
              </a>
            )}
            <label className="tag-set-tags-field">
              <span>タグ</span>
              <textarea
                value={tagDraft}
                spellCheck={false}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setTagDraft(nextValue);
                  editSelectedSet((item) => {
                    item.tags = nextValue
                      .split(",")
                      .map((tag) => tag.trim())
                      .filter(Boolean);
                  });
                }}
              />
            </label>
            <section className="tag-set-image-panel" aria-label="タグセット画像">
              <div className="tag-set-image-head">
                <span>
                  <Image />
                  画像
                </span>
                {selectedSet.imagePath && <small>{selectedSet.imagePath}</small>}
              </div>
              {selectedSetImageSrc ? (
                <img className="tag-set-image-preview" src={selectedSetImageSrc} alt={selectedSet.name || "タグセット画像"} />
              ) : (
                <div className="tag-set-image-empty">画像なし</div>
              )}
              <div className="tag-set-image-actions">
                <button type="button" onClick={() => void fetchImageFromSourcePage()} disabled={!selectedSet.sourceUrl}>
                  ページから画像取得
                </button>
                <button type="button" onClick={() => imageFileInputRef.current?.click()}>
                  画像を選んで差し替え
                </button>
                <button type="button" onClick={clearSelectedSetImage} disabled={!selectedSet.imageUrl && !selectedSet.imagePath}>
                  削除
                </button>
              </div>
              <input
                ref={imageFileInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                  replaceImageWithLocalFile(event.target.files?.[0]);
                  event.currentTarget.value = "";
                }}
              />
              {imageStatus && <small className="tag-set-image-status">{imageStatus}</small>}
            </section>
          </div>
        ) : (
          <div className="tag-set-empty">
            <strong>編集するセットを選択してください</strong>
            <p>中央の一覧からセットを選ぶと、ここに詳細が表示されます。</p>
          </div>
        )}
      </section>
      {favoriteMenu && (
        <div
          className="tag-set-favorite-menu"
          role="menu"
          style={{ left: favoriteMenu.x, top: favoriteMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <strong>{favoriteMenu.setName}</strong>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onToggleFavorite(favoriteMenu.setId, favoriteMenu.setName);
              setFavoriteMenu(null);
            }}
          >
            <Star fill={favoriteTagSetKeys.has(favoriteTagSetKey(favoriteMenu.setId)) ? "currentColor" : "none"} />
            {favoriteTagSetKeys.has(favoriteTagSetKey(favoriteMenu.setId)) ? "お気に入りから削除" : "お気に入りに追加"}
          </button>
          <button type="button" onClick={() => setFavoriteMenu(null)}>
            <X />
            閉じる
          </button>
        </div>
      )}
    </main>
    </DndContext>
  );
}
