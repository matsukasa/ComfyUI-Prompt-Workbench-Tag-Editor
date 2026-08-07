import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CirclePlus,
  GripVertical,
  History,
  Search,
  Tags,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { sortedChildren } from "../domain/operations";
import type { CategoryNode, TagOccurrence } from "../domain/types";

const colors = ["violet", "coral", "emerald", "sky", "magenta", "cyan", "amber", "indigo"];

interface TreeProps {
  categories: CategoryNode[];
  tags: TagOccurrence[];
  expandedIds: Set<string>;
  selectedMediumId: string | null;
  query: string;
  dragMode: "tag" | "category" | null;
  activeCategoryLevel: CategoryNode["level"] | null;
  activeCategoryId: string | null;
  overCategoryId: string | null;
  changedCategoryIds: Set<string>;
  onQuery: (value: string) => void;
  onToggle: (id: string) => void;
  onSelectMedium: (id: string) => void;
  onEditCategory: (category: CategoryNode, labelJa: string, labelEn: string) => void;
  onDeleteCategory: (category: CategoryNode, descendantCount: number, tagCount: number) => void;
  onAddCategory: (level: CategoryNode["level"], parentId: string, labelJa: string) => void;
  onExpandAll: (expanded: boolean) => void;
}

interface RowProps {
  category: CategoryNode;
  color: string;
  depth: number;
  count: number;
  descendantCount: number;
  expanded: boolean;
  selected: boolean;
  over: boolean;
  hasChildren: boolean;
  dragMode: TreeProps["dragMode"];
  activeCategoryLevel: TreeProps["activeCategoryLevel"];
  activeCategoryId: string | null;
  changed: boolean;
  onToggle: () => void;
  onSelect: () => void;
  onEdit: (labelJa: string, labelEn: string) => void;
  onDelete: () => void;
}

function CategoryRow({
  category,
  color,
  depth,
  count,
  descendantCount,
  expanded,
  selected,
  over,
  hasChildren,
  dragMode,
  activeCategoryLevel,
  activeCategoryId,
  changed,
  onToggle,
  onSelect,
  onEdit,
  onDelete,
}: RowProps) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draftLabelJa, setDraftLabelJa] = useState(category.labelJa);
  const [draftLabelEn, setDraftLabelEn] = useState(category.labelEn);
  const [labelInvalid, setLabelInvalid] = useState(false);
  const labelInputRef = useRef<HTMLInputElement>(null);
  const draggable = useDraggable({
    id: `category:${category.id}`,
    data: { type: "category", categoryId: category.id },
  });
  const droppable = useDroppable({
    id: `tree-category:${category.id}`,
    data: { type: "category-target", categoryId: category.id, level: category.level },
  });
  const setNodeRef = (node: HTMLElement | null) => {
    draggable.setNodeRef(node);
    droppable.setNodeRef(node);
  };
  const categoryDropActive =
    dragMode === "category" && activeCategoryId !== category.id && (over || droppable.isOver);
  const dropPosition =
    categoryDropActive && activeCategoryLevel === category.level
      ? "before"
      : categoryDropActive &&
          ((activeCategoryLevel === "medium" && category.level === "major") ||
            (activeCategoryLevel === "small" && category.level === "medium"))
        ? "child"
        : categoryDropActive
          ? "before"
          : null;
  const style = {
    paddingLeft: `${12 + depth * 20}px`,
    "--drop-inset": `${12 + depth * 20}px`,
  } as React.CSSProperties;
  useEffect(() => {
    if (editing) labelInputRef.current?.focus();
  }, [editing]);
  const beginEditing = () => {
    setDraftLabelJa(category.labelJa);
    setDraftLabelEn(category.labelEn);
    setLabelInvalid(false);
    setConfirmingDelete(false);
    setEditing(true);
  };
  const cancelEditing = () => {
    setDraftLabelJa(category.labelJa);
    setDraftLabelEn(category.labelEn);
    setLabelInvalid(false);
    setConfirmingDelete(false);
    setEditing(false);
  };
  const saveEditing = () => {
    const nextLabelJa = draftLabelJa.trim();
    if (!nextLabelJa) {
      setLabelInvalid(true);
      labelInputRef.current?.focus();
      return;
    }
    onEdit(nextLabelJa, draftLabelEn.trim());
    setLabelInvalid(false);
    setEditing(false);
  };
  const handleEditorKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelEditing();
    }
    if (event.key === "Enter") {
      event.preventDefault();
      saveEditing();
    }
  };
  return (
    <div
      ref={setNodeRef}
      className={`category-row level-${category.level} color-${color} ${editing ? "is-editing" : ""} ${selected ? "is-selected" : ""} ${changed ? "is-modified" : ""} ${dragMode === "tag" && (over || droppable.isOver) ? "is-tag-drop-target" : ""} ${dropPosition === "before" ? "is-drop-before" : ""} ${dropPosition === "child" ? "is-drop-child" : ""} ${draggable.isDragging ? "is-dragging" : ""}`}
      style={style}
      onClick={() => {
        if (!editing) onSelect();
      }}
      data-category-id={category.id}
    >
      <button
        className="tree-toggle"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
        aria-label={expanded ? `${category.labelJa}を折りたたむ` : `${category.labelJa}を展開`}
        disabled={!hasChildren}
      >
        {hasChildren ? expanded ? <ChevronDown /> : <ChevronRight /> : <span />}
      </button>
      <span className="category-level-mark" aria-hidden="true">
        {category.level === "major" ? "大" : category.level === "medium" ? "中" : "小"}
      </span>
      {editing ? (
        <span
          className={`category-inline-editor ${confirmingDelete ? "is-delete-confirming" : ""}`}
          onClick={(event) => event.stopPropagation()}
        >
          {confirmingDelete ? (
            <span className="inline-delete-confirmation" role="group" aria-label={`${category.labelJa}を削除`}>
              <Trash2 aria-hidden="true" />
              <span>
                <strong>{category.labelJa}を削除</strong>
                <small>
                  {descendantCount > 0 ? `配下${descendantCount}分類・` : ""}
                  {count}タグも削除 / 元に戻せます
                </small>
              </span>
              <button className="inline-delete-confirm" type="button" onClick={onDelete}>
                削除する
              </button>
              <button className="inline-delete-back" type="button" onClick={() => setConfirmingDelete(false)}>
                戻る
              </button>
            </span>
          ) : (
            <>
              <input
                ref={labelInputRef}
                className="inline-category-ja"
                value={draftLabelJa}
                aria-label={`${category.labelJa}のカテゴリ名`}
                aria-invalid={labelInvalid}
                onChange={(event) => {
                  setDraftLabelJa(event.target.value);
                  if (event.target.value.trim()) setLabelInvalid(false);
                }}
                onKeyDown={handleEditorKeyDown}
              />
              <input
                className="inline-category-en"
                value={draftLabelEn}
                aria-label={`${category.labelJa}の英語名`}
                onChange={(event) => setDraftLabelEn(event.target.value)}
                onKeyDown={handleEditorKeyDown}
              />
              <button
                className="inline-edit-save"
                type="button"
                aria-label={`${category.labelJa}の変更を保存`}
                onClick={saveEditing}
              >
                <Check />
              </button>
              <button
                className="inline-edit-cancel"
                type="button"
                aria-label={`${category.labelJa}の変更をキャンセル`}
                onClick={cancelEditing}
              >
                <X />
              </button>
              <button
                className="inline-edit-delete"
                type="button"
                aria-label={`${category.labelJa}を削除`}
                onClick={() => setConfirmingDelete(true)}
              >
                <Trash2 />
              </button>
            </>
          )}
        </span>
      ) : (
        <>
          <span
            className="category-label is-editable"
            onDoubleClick={(event) => {
              event.stopPropagation();
              beginEditing();
            }}
          >
            <strong>{category.labelJa}</strong>
            {category.labelEn && <small>{category.labelEn}</small>}
          </span>
          <span className="category-count">{count.toLocaleString()}</span>
          <span className="category-change-indicator" title={changed ? "変更済み" : undefined}>
            {changed && <History aria-label={`${category.labelJa}：変更済み`} />}
          </span>
          <button
            className="drag-handle"
            type="button"
            aria-label={`${category.labelJa}カテゴリをドラッグ`}
            {...draggable.attributes}
            {...draggable.listeners}
          >
            <GripVertical />
          </button>
        </>
      )}
      {dragMode === "tag" && category.level === "small" && (over || droppable.isOver) && (
        <span className="drop-copy">
          <Tags />
          ここへ移動
        </span>
      )}
      {dragMode === "category" &&
        activeCategoryLevel === "major" &&
        category.level === "medium" &&
        (over || droppable.isOver) && (
          <span className="drop-copy">
            <Tags />
            中分類へ変更
          </span>
        )}
    </div>
  );
}

export function CategoryTree(props: TreeProps) {
  const [adding, setAdding] = useState(false);
  const [addLevel, setAddLevel] = useState<CategoryNode["level"]>("small");
  const [addParentId, setAddParentId] = useState(props.selectedMediumId ?? "");
  const [addLabelJa, setAddLabelJa] = useState("");
  const addLabelInputRef = useRef<HTMLInputElement>(null);
  const { setNodeRef: setMajorLevelTargetRef, isOver: isOverMajorLevelTarget } = useDroppable({
    id: "category-level:major",
    data: { type: "category-level-target", targetLevel: "major" },
  });
  const query = props.query.trim().toLocaleLowerCase();
  const tagCount = useMemo(() => {
    const direct = new Map<string, number>();
    for (const tag of props.tags) direct.set(tag.categoryId, (direct.get(tag.categoryId) ?? 0) + 1);
    const count = (id: string): number =>
      (direct.get(id) ?? 0) +
      props.categories
        .filter((item) => item.parentId === id)
        .reduce((sum, child) => sum + count(child.id), 0);
    return new Map(props.categories.map((category) => [category.id, count(category.id)]));
  }, [props.categories, props.tags]);
  const descendantCount = useMemo(() => {
    const count = (id: string): number => {
      const children = props.categories.filter((item) => item.parentId === id);
      return children.length + children.reduce((sum, child) => sum + count(child.id), 0);
    };
    return new Map(props.categories.map((category) => [category.id, count(category.id)]));
  }, [props.categories]);
  const majors = sortedChildren(props.categories, "", "major");
  const mediums = props.categories.filter((category) => category.level === "medium");
  const parentOptions = addLevel === "medium" ? majors : mediums;
  const levelLabels: Record<CategoryNode["level"], string> = {
    major: "大分類",
    medium: "中分類",
    small: "小分類",
  };
  const openAddForm = () => {
    const defaultLevel: CategoryNode["level"] = props.selectedMediumId ? "small" : "major";
    setAddLevel(defaultLevel);
    setAddParentId(
      defaultLevel === "small" ? (props.selectedMediumId ?? mediums[0]?.id ?? "") : majors[0]?.id ?? "",
    );
    setAddLabelJa("");
    setAdding(true);
    requestAnimationFrame(() => addLabelInputRef.current?.focus());
  };
  const closeAddForm = () => {
    setAdding(false);
    setAddLabelJa("");
  };
  const changeAddLevel = (level: CategoryNode["level"]) => {
    setAddLevel(level);
    setAddParentId(
      level === "major"
        ? ""
        : level === "medium"
          ? (majors[0]?.id ?? "")
          : (props.selectedMediumId ?? mediums[0]?.id ?? ""),
    );
  };
  const submitAddCategory = () => {
    const label = addLabelJa.trim();
    if (!label || (addLevel !== "major" && !addParentId)) return;
    props.onAddCategory(addLevel, addParentId, label);
    closeAddForm();
  };
  const matches = (category: CategoryNode) =>
    !query || `${category.labelJa} ${category.labelEn} ${category.id}`.toLocaleLowerCase().includes(query);

  const renderBranch = (category: CategoryNode, depth: number, color: string): React.ReactNode[] => {
    const children = sortedChildren(props.categories, category.id);
    const descendantMatches = children.some(
      (child) => matches(child) || sortedChildren(props.categories, child.id).some(matches),
    );
    if (query && !matches(category) && !descendantMatches) return [];
    const expanded = props.expandedIds.has(category.id) || Boolean(query) || props.dragMode === "tag";
    const rows: React.ReactNode[] = [
      <CategoryRow
        key={category.id}
        category={category}
        color={color}
        depth={depth}
        count={tagCount.get(category.id) ?? 0}
        descendantCount={descendantCount.get(category.id) ?? 0}
        expanded={expanded}
        selected={category.id === props.selectedMediumId}
        over={category.id === props.overCategoryId}
        hasChildren={children.length > 0}
        dragMode={props.dragMode}
        activeCategoryLevel={props.activeCategoryLevel}
        activeCategoryId={props.activeCategoryId}
        changed={props.changedCategoryIds.has(category.id)}
        onToggle={() => props.onToggle(category.id)}
        onSelect={() => category.level === "medium" && props.onSelectMedium(category.id)}
        onEdit={(labelJa, labelEn) => props.onEditCategory(category, labelJa, labelEn)}
        onDelete={() =>
          props.onDeleteCategory(
            category,
            descendantCount.get(category.id) ?? 0,
            tagCount.get(category.id) ?? 0,
          )
        }
      />,
    ];
    if (expanded) for (const child of children) rows.push(...renderBranch(child, depth + 1, color));
    return rows;
  };

  return (
    <aside
      className={`category-sidebar ${adding ? "has-add-form" : ""} ${props.dragMode === "tag" ? "is-tag-drag" : ""}`}
      aria-label="カテゴリーツリー"
    >
      <div className="sidebar-heading">
        <div>
          <h2>{props.dragMode === "tag" ? "移動先を選択" : "カテゴリー"}</h2>
          {props.dragMode === "tag" && <p>大・中分類に重ねると自動展開 / Escでキャンセル</p>}
        </div>
        <button
          className="icon-button"
          type="button"
          onClick={() => (adding ? closeAddForm() : openAddForm())}
          aria-label="カテゴリを追加"
          aria-expanded={adding}
        >
          {adding ? <X /> : <CirclePlus />}
        </button>
      </div>
      {adding && (
        <form
          className="category-add-form add-form"
          aria-label="カテゴリーを追加"
          onSubmit={(event) => {
            event.preventDefault();
            submitAddCategory();
          }}
          onKeyDown={(event) => event.key === "Escape" && closeAddForm()}
        >
          <div className="add-form-heading">
            <div>
              <strong>カテゴリーを追加</strong>
              <span>分類の種類と追加先を選んでください</span>
            </div>
          </div>
          <fieldset className="category-level-picker">
            <legend>分類の種類</legend>
            {(["major", "medium", "small"] as const).map((level) => (
              <label key={level} className={addLevel === level ? "is-selected" : ""}>
                <input
                  type="radio"
                  name="category-level"
                  value={level}
                  checked={addLevel === level}
                  onChange={() => changeAddLevel(level)}
                />
                <span>{levelLabels[level]}</span>
              </label>
            ))}
          </fieldset>
          {addLevel !== "major" && (
            <label className="add-form-field">
              <span>追加先</span>
              <select
                value={addParentId}
                onChange={(event) => setAddParentId(event.target.value)}
                aria-label={`${levelLabels[addLevel]}の追加先`}
              >
                {parentOptions.map((parent) => {
                  const major =
                    parent.level === "medium"
                      ? props.categories.find((category) => category.id === parent.parentId)
                      : null;
                  return (
                    <option key={parent.id} value={parent.id}>
                      {major ? `${major.labelJa} › ` : ""}{parent.labelJa}
                    </option>
                  );
                })}
              </select>
            </label>
          )}
          <label className="add-form-field">
            <span>日本語名</span>
            <input
              ref={addLabelInputRef}
              value={addLabelJa}
              onChange={(event) => setAddLabelJa(event.target.value)}
              placeholder={`例：${addLevel === "major" ? "人物" : addLevel === "medium" ? "髪" : "髪型"}`}
              aria-label="新しいカテゴリーの日本語名"
            />
          </label>
          <div className="add-form-actions">
            <button type="button" onClick={closeAddForm}>キャンセル</button>
            <button
              className="primary-button"
              type="submit"
              disabled={!addLabelJa.trim() || (addLevel !== "major" && !addParentId)}
            >
              <CirclePlus />
              {levelLabels[addLevel]}を追加
            </button>
          </div>
        </form>
      )}
      <label className="search-control sidebar-search">
        <Search />
        <input
          value={props.query}
          onChange={(event) => props.onQuery(event.target.value)}
          placeholder="カテゴリを検索"
          aria-label="カテゴリを検索"
        />
      </label>
      <div className="tree-actions">
        <button type="button" onClick={() => props.onExpandAll(true)}>
          すべて展開
        </button>
        <button type="button" onClick={() => props.onExpandAll(false)}>
          折りたたむ
        </button>
      </div>
      {props.dragMode && (
        <div className="drag-legend">
          <span>
            <Tags />
            タグを移動
          </span>
          <span>
            <GripVertical />
            カテゴリを並べ替え
          </span>
        </div>
      )}
      {props.dragMode === "category" && props.activeCategoryLevel === "medium" && (
        <div
          ref={setMajorLevelTargetRef}
          className={`category-level-drop ${isOverMajorLevelTarget ? "is-over" : ""}`}
        >
          ここへドロップして大分類に変更
        </div>
      )}
      <div className="category-tree" role="tree">
        {majors.flatMap((major, index) => renderBranch(major, 0, colors[index % colors.length]))}
      </div>
    </aside>
  );
}
