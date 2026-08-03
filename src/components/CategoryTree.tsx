import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronRight, CirclePlus, GripVertical, Search, Tags } from "lucide-react";
import { useMemo } from "react";
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
  overCategoryId: string | null;
  onQuery: (value: string) => void;
  onToggle: (id: string) => void;
  onSelectMedium: (id: string) => void;
  onAddCategory: () => void;
  onExpandAll: (expanded: boolean) => void;
}

interface RowProps {
  category: CategoryNode;
  color: string;
  depth: number;
  count: number;
  expanded: boolean;
  selected: boolean;
  over: boolean;
  hasChildren: boolean;
  dragMode: TreeProps["dragMode"];
  onToggle: () => void;
  onSelect: () => void;
}

function CategoryRow({
  category,
  color,
  depth,
  count,
  expanded,
  selected,
  over,
  hasChildren,
  dragMode,
  onToggle,
  onSelect,
}: RowProps) {
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
  const style = {
    transform: CSS.Translate.toString(draggable.transform),
    paddingLeft: `${12 + depth * 20}px`,
  };
  return (
    <div
      ref={setNodeRef}
      className={`category-row level-${category.level} color-${color} ${selected ? "is-selected" : ""} ${over || droppable.isOver ? "is-drop-target" : ""} ${draggable.isDragging ? "is-dragging" : ""}`}
      style={style}
      onClick={onSelect}
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
      <span className="category-label">
        <strong>{category.labelJa}</strong>
        {category.labelEn && <small>{category.labelEn}</small>}
      </span>
      <span className="category-count">{count.toLocaleString()}</span>
      <button
        className="drag-handle"
        type="button"
        aria-label={`${category.labelJa}カテゴリをドラッグ`}
        {...draggable.attributes}
        {...draggable.listeners}
      >
        <GripVertical />
      </button>
      {dragMode === "tag" && category.level === "small" && (over || droppable.isOver) && (
        <span className="drop-copy">
          <Tags />
          ここへ移動
        </span>
      )}
    </div>
  );
}

export function CategoryTree(props: TreeProps) {
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
  const majors = sortedChildren(props.categories, "", "major");
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
        expanded={expanded}
        selected={category.id === props.selectedMediumId}
        over={category.id === props.overCategoryId}
        hasChildren={children.length > 0}
        dragMode={props.dragMode}
        onToggle={() => props.onToggle(category.id)}
        onSelect={() => category.level === "medium" && props.onSelectMedium(category.id)}
      />,
    ];
    if (expanded) for (const child of children) rows.push(...renderBranch(child, depth + 1, color));
    return rows;
  };

  return (
    <aside
      className={`category-sidebar ${props.dragMode === "tag" ? "is-tag-drag" : ""}`}
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
          onClick={props.onAddCategory}
          aria-label="カテゴリを追加"
        >
          <CirclePlus />
        </button>
      </div>
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
      <div className="category-tree" role="tree">
        {majors.flatMap((major, index) => renderBranch(major, 0, colors[index % colors.length]))}
      </div>
      <div className="color-legend">
        <strong>カラーレジェンド</strong>
        <div>
          <span className="legend-dot success" />
          成功・完了 <span className="legend-dot selection" />
          選択 <span className="legend-dot warning" />
          注意
        </div>
        <div>
          <span className="legend-level major" />
          大分類 <span className="legend-level medium" />
          中分類 <span className="legend-level small" />
          小分類
        </div>
      </div>
    </aside>
  );
}
