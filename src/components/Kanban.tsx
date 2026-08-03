import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Check, GripVertical, MoreVertical, Search } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, useRef } from "react";
import type { CategoryNode, TagOccurrence } from "../domain/types";

interface TagRowProps {
  tag: TagOccurrence;
  selected: boolean;
  duplicateCount: number;
  visibleIds: string[];
  onSelect: (uid: string, mode: "single" | "toggle" | "range", visibleIds: string[]) => void;
  onEdit: (tag: TagOccurrence) => void;
}

function TagRow({ tag, selected, duplicateCount, visibleIds, onSelect, onEdit }: TagRowProps) {
  const draggable = useDraggable({
    id: `tag:${tag.uid}`,
    data: { type: "tag", tagId: tag.uid, categoryId: tag.categoryId },
  });
  const droppable = useDroppable({
    id: `tag-target:${tag.uid}`,
    data: { type: "tag-target", tagId: tag.uid, categoryId: tag.categoryId },
  });
  const setNodeRef = (node: HTMLElement | null) => {
    draggable.setNodeRef(node);
    droppable.setNodeRef(node);
  };
  return (
    <div
      ref={setNodeRef}
      className={`tag-row ${selected ? "is-selected" : ""} ${droppable.isOver ? "is-drop-before" : ""} ${draggable.isDragging ? "is-dragging" : ""}`}
      style={{ transform: CSS.Translate.toString(draggable.transform) }}
      role="option"
      aria-selected={selected}
      tabIndex={0}
      onClick={(event) =>
        onSelect(
          tag.uid,
          event.shiftKey ? "range" : event.ctrlKey || event.metaKey ? "toggle" : "single",
          visibleIds,
        )
      }
      onKeyDown={(event) => {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          onSelect(
            tag.uid,
            event.shiftKey ? "range" : event.ctrlKey || event.metaKey ? "toggle" : "single",
            visibleIds,
          );
        }
      }}
      onDoubleClick={() => onEdit(tag)}
      data-tag-id={tag.uid}
    >
      <button
        className="tag-check"
        type="button"
        aria-label={`${tag.prompt}を選択`}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(tag.uid, "toggle", visibleIds);
        }}
      >
        {selected && <Check />}
      </button>
      <span className="tag-prompt" title={tag.prompt}>
        {tag.prompt}
      </span>
      <span className="tag-translation" title={tag.translationJa}>
        {tag.translationJa || "—"}
      </span>
      {duplicateCount > 1 && <span className="duplicate-badge">{duplicateCount}か所</span>}
      <button
        className="drag-handle"
        type="button"
        aria-label={`${tag.prompt}をドラッグ`}
        {...draggable.attributes}
        {...draggable.listeners}
      >
        <GripVertical />
      </button>
      <button
        className="row-menu"
        type="button"
        aria-label={`${tag.prompt}を編集`}
        onClick={(event) => {
          event.stopPropagation();
          onEdit(tag);
        }}
      >
        <MoreVertical />
      </button>
    </div>
  );
}

interface LaneProps {
  category: CategoryNode;
  tags: TagOccurrence[];
  selectedIds: Set<string>;
  duplicateCounts: Map<string, number>;
  laneIndex: number;
  query: string;
  showDuplicatesOnly: boolean;
  showSelectedOnly: boolean;
  onSelect: TagRowProps["onSelect"];
  onSelectAll: (uids: string[]) => void;
  onEdit: (tag: TagOccurrence) => void;
  onAdd: (categoryId: string) => void;
}

export function KanbanLane(props: LaneProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const droppable = useDroppable({
    id: `lane:${props.category.id}`,
    data: { type: "category-target", categoryId: props.category.id, level: "small" },
  });
  const visible = useMemo(
    () =>
      props.tags.filter((tag) => {
        const matches =
          !props.query ||
          `${tag.prompt} ${tag.translationJa} ${tag.aliases.join(" ")}`
            .toLocaleLowerCase()
            .includes(props.query.toLocaleLowerCase());
        return (
          matches &&
          (!props.showDuplicatesOnly ||
            (props.duplicateCounts.get(tag.prompt.toLocaleLowerCase()) ?? 0) > 1) &&
          (!props.showSelectedOnly || props.selectedIds.has(tag.uid))
        );
      }),
    [props],
  );
  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 39,
    overscan: 8,
    initialRect: { width: 300, height: 620 },
  });
  const testMode = import.meta.env.MODE === "test";
  const visibleIds = visible.map((tag) => tag.uid);
  const allSelected = visibleIds.length > 0 && visibleIds.every((uid) => props.selectedIds.has(uid));
  return (
    <section
      ref={droppable.setNodeRef}
      className={`kanban-lane lane-color-${props.laneIndex % 4} ${droppable.isOver ? "is-over" : ""}`}
      aria-label={`${props.category.labelJa}のタグ`}
    >
      <header className="lane-header">
        <div>
          <h3>{props.category.labelJa}</h3>
          <span>{props.tags.length}</span>
        </div>
        <button className="row-menu" type="button" aria-label={`${props.category.labelJa}のメニュー`}>
          <MoreVertical />
        </button>
      </header>
      <label className="search-control lane-search">
        <Search />
        <input placeholder="この小分類を検索" aria-label={`${props.category.labelJa}内を検索`} />
      </label>
      <div className="lane-select-row">
        <button type="button" onClick={() => props.onSelectAll(allSelected ? [] : visibleIds)}>
          <span className={`select-box ${allSelected ? "checked" : ""}`}>{allSelected && <Check />}</span>
          表示中を全選択
        </button>
        <button type="button" onClick={() => props.onAdd(props.category.id)}>
          タグ追加
        </button>
      </div>
      {droppable.isOver && <div className="lane-drop-target">ここに挿入</div>}
      <div ref={parentRef} className="tag-list" role="listbox" aria-multiselectable="true">
        {visible.length === 0 ? (
          <div className="lane-empty">
            <strong>表示するタグがありません</strong>
            <span>検索条件を変えるかタグを追加してください。</span>
          </div>
        ) : testMode ? (
          visible.map((tag) => (
            <TagRow
              key={tag.uid}
              tag={tag}
              selected={props.selectedIds.has(tag.uid)}
              duplicateCount={props.duplicateCounts.get(tag.prompt.toLocaleLowerCase()) ?? 0}
              visibleIds={visibleIds}
              onSelect={props.onSelect}
              onEdit={props.onEdit}
            />
          ))
        ) : (
          <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
            {virtualizer.getVirtualItems().map((item) => {
              const tag = visible[item.index];
              return (
                <div
                  key={tag.uid}
                  style={{
                    position: "absolute",
                    insetInline: 0,
                    height: `${item.size}px`,
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  <TagRow
                    tag={tag}
                    selected={props.selectedIds.has(tag.uid)}
                    duplicateCount={props.duplicateCounts.get(tag.prompt.toLocaleLowerCase()) ?? 0}
                    visibleIds={visibleIds}
                    onSelect={props.onSelect}
                    onEdit={props.onEdit}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
