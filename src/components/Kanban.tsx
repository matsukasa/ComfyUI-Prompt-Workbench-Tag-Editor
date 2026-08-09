import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  Check,
  CirclePlus,
  GripVertical,
  MoreVertical,
  Move,
  MoveDown,
  PencilLine,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CategoryNode, TagOccurrence } from "../domain/types";

interface TagRowProps {
  tag: TagOccurrence;
  selected: boolean;
  duplicateCount: number;
  changeLabel?: string;
  recentlyMoved: boolean;
  visibleIds: string[];
  onSelect: (uid: string, mode: "single" | "toggle" | "range", visibleIds: string[]) => void;
  onEdit: (tag: TagOccurrence, prompt: string, translationJa: string) => void;
  onDelete: (tag: TagOccurrence) => void;
  onMoveRequest: (tag: TagOccurrence, point: { x: number; y: number }) => void;
}

function TagRow({
  tag,
  selected,
  duplicateCount,
  changeLabel,
  recentlyMoved,
  visibleIds,
  onSelect,
  onEdit,
  onDelete,
  onMoveRequest,
}: TagRowProps) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState(tag.prompt);
  const [draftTranslation, setDraftTranslation] = useState(tag.translationJa);
  const [promptInvalid, setPromptInvalid] = useState(false);
  const promptInputRef = useRef<HTMLInputElement>(null);
  const translationInputRef = useRef<HTMLTextAreaElement>(null);
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
  useEffect(() => {
    if (editing) promptInputRef.current?.focus();
  }, [editing]);
  const beginEditing = () => {
    setDraftPrompt(tag.prompt);
    setDraftTranslation(tag.translationJa);
    setPromptInvalid(false);
    setConfirmingDelete(false);
    setEditing(true);
  };
  const cancelEditing = () => {
    setDraftPrompt(tag.prompt);
    setDraftTranslation(tag.translationJa);
    setPromptInvalid(false);
    setConfirmingDelete(false);
    setEditing(false);
  };
  const saveEditing = () => {
    const nextPrompt = draftPrompt.trim();
    if (!nextPrompt) {
      setPromptInvalid(true);
      promptInputRef.current?.focus();
      return;
    }
    onEdit(tag, nextPrompt, draftTranslation.trim());
    setPromptInvalid(false);
    setEditing(false);
  };
  return (
    <div
      ref={setNodeRef}
      className={`tag-row ${editing ? "is-editing" : ""} ${selected ? "is-selected" : ""} ${changeLabel ? "is-modified" : ""} ${recentlyMoved ? "is-recently-moved" : ""} ${droppable.isOver ? "is-drop-before" : ""} ${draggable.isDragging ? "is-dragging" : ""}`}
      style={{ transform: CSS.Translate.toString(draggable.transform) }}
      role="option"
      aria-selected={selected}
      tabIndex={0}
      onContextMenu={(event) => {
        if (editing && (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement))
          return;
        event.preventDefault();
        onMoveRequest(tag, { x: event.clientX, y: event.clientY });
      }}
      onClick={(event) => {
        if (editing) return;
        onSelect(
          tag.uid,
          event.shiftKey ? "range" : event.ctrlKey || event.metaKey ? "toggle" : "single",
          visibleIds,
        );
      }}
      onKeyDown={(event) => {
        if (editing) return;
        if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          onMoveRequest(tag, { x: rect.left + Math.min(rect.width * 0.72, rect.width - 12), y: rect.top + rect.height / 2 });
          return;
        }
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          onSelect(
            tag.uid,
            event.shiftKey ? "range" : event.ctrlKey || event.metaKey ? "toggle" : "single",
            visibleIds,
          );
        }
      }}
      data-tag-id={tag.uid}
    >
      {droppable.isOver && (
        <span className="tag-drop-marker" aria-hidden="true">
          <MoveDown />
        </span>
      )}
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
      {editing ? (
        confirmingDelete ? (
          <span
            className="tag-inline-delete-confirmation inline-delete-confirmation"
            role="group"
            aria-label={`${tag.prompt}を削除`}
          >
            <Trash2 aria-hidden="true" />
            <span>
              <strong>{tag.prompt}を削除</strong>
              <small>保存前なら元に戻せます</small>
            </span>
            <button
              className="inline-delete-confirm"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onDelete(tag);
              }}
            >
              削除する
            </button>
            <button
              className="inline-delete-back"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setConfirmingDelete(false);
              }}
            >
              戻る
            </button>
          </span>
        ) : (
          <>
          <input
            ref={promptInputRef}
            className="inline-tag-prompt"
            value={draftPrompt}
            aria-label={`${tag.prompt}のタグ名`}
            aria-invalid={promptInvalid}
            onChange={(event) => {
              setDraftPrompt(event.target.value);
              if (event.target.value.trim()) setPromptInvalid(false);
            }}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") cancelEditing();
              if (event.key === "Enter") {
                event.preventDefault();
                translationInputRef.current?.focus();
              }
            }}
          />
          <textarea
            ref={translationInputRef}
            className="inline-tag-translation"
            value={draftTranslation}
            rows={1}
            aria-label={`${tag.prompt}の日本語訳`}
            onChange={(event) => setDraftTranslation(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") cancelEditing();
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                saveEditing();
              }
            }}
          />
          <button
            className="inline-edit-save"
            type="button"
            aria-label={`${tag.prompt}の変更を保存`}
            onClick={(event) => {
              event.stopPropagation();
              saveEditing();
            }}
          >
            <Check />
          </button>
          <button
            className="inline-edit-cancel"
            type="button"
            aria-label={`${tag.prompt}の変更をキャンセル`}
            onClick={(event) => {
              event.stopPropagation();
              cancelEditing();
            }}
          >
            <X />
          </button>
          <button
            className="inline-edit-delete"
            type="button"
            aria-label={`${tag.prompt}を削除`}
            onClick={(event) => {
              event.stopPropagation();
              setConfirmingDelete(true);
            }}
          >
            <Trash2 />
          </button>
        </>
        )
      ) : (
        <>
          <span
            className="tag-prompt"
            title={tag.prompt}
            onDoubleClick={(event) => {
              event.stopPropagation();
              beginEditing();
            }}
          >
            {tag.prompt}
          </span>
          <span
            className="tag-translation"
            title={tag.translationJa}
            onDoubleClick={(event) => {
              event.stopPropagation();
              beginEditing();
            }}
          >
            {tag.translationJa || "—"}
          </span>
          {duplicateCount > 1 && <span className="duplicate-badge">{duplicateCount}か所</span>}
          <span
            className="change-indicator"
            title={changeLabel}
            aria-label={changeLabel ? `${tag.prompt}：${changeLabel}` : undefined}
          >
            {changeLabel &&
              (changeLabel.includes("追加") ? (
                <CirclePlus />
              ) : changeLabel.includes("移動") ? (
                <Move />
              ) : (
                <PencilLine />
              ))}
          </span>
          <button
            className="drag-handle"
            type="button"
            aria-label={`${tag.prompt}をドラッグ`}
            {...draggable.attributes}
            {...draggable.listeners}
          >
            <GripVertical />
          </button>
        </>
      )}
    </div>
  );
}

interface LaneProps {
  category: CategoryNode;
  tags: TagOccurrence[];
  selectedIds: Set<string>;
  duplicateCounts: Map<string, number>;
  changeLabels: Map<string, string>;
  laneIndex: number;
  query: string;
  showDuplicatesOnly: boolean;
  showSelectedOnly: boolean;
  focused: boolean;
  deemphasized: boolean;
  dragActive: boolean;
  recentlyMovedIds: Set<string>;
  onSelect: TagRowProps["onSelect"];
  onSelectAll: (uids: string[]) => void;
  onEdit: TagRowProps["onEdit"];
  onDelete: TagRowProps["onDelete"];
  onMoveRequest: TagRowProps["onMoveRequest"];
  onAdd: (categoryId: string, values: string[]) => void;
}

export function KanbanLane(props: LaneProps) {
  const [adding, setAdding] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const tagInputRef = useRef<HTMLTextAreaElement>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const droppable = useDroppable({
    id: `lane:${props.category.id}`,
    data: { type: "category-target", categoryId: props.category.id, level: "small" },
  });
  const endDroppable = useDroppable({
    id: `lane-end:${props.category.id}`,
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
    estimateSize: () => 44,
    overscan: 8,
    initialRect: { width: 300, height: 620 },
  });
  const testMode = import.meta.env.MODE === "test";
  const visibleIds = visible.map((tag) => tag.uid);
  const allSelected = visibleIds.length > 0 && visibleIds.every((uid) => props.selectedIds.has(uid));
  const showEndTarget = props.dragActive && (droppable.isOver || endDroppable.isOver);
  const tagsToAdd = tagDraft.split(/[\n,]/u).map((value) => value.trim()).filter(Boolean);
  const closeAddForm = () => {
    setAdding(false);
    setTagDraft("");
  };
  const submitTags = () => {
    if (!tagsToAdd.length) return;
    props.onAdd(props.category.id, tagsToAdd);
    closeAddForm();
  };
  return (
    <section
      ref={droppable.setNodeRef}
      className={`kanban-lane lane-color-${props.laneIndex % 4} ${adding ? "has-add-form" : ""} ${props.focused ? "is-focused" : ""} ${props.deemphasized ? "is-deemphasized" : ""} ${droppable.isOver || endDroppable.isOver ? "is-over" : ""}`}
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
        <button
          type="button"
          onClick={() => {
            if (adding) closeAddForm();
            else {
              setAdding(true);
              requestAnimationFrame(() => tagInputRef.current?.focus());
            }
          }}
          aria-expanded={adding}
        >
          {adding ? "閉じる" : "タグ追加"}
        </button>
      </div>
      {adding && (
        <form
          className="tag-add-form add-form"
          aria-label={`${props.category.labelJa}にタグを追加`}
          onSubmit={(event) => {
            event.preventDefault();
            submitTags();
          }}
          onKeyDown={(event) => event.key === "Escape" && closeAddForm()}
        >
          <div className="add-form-heading">
            <div>
              <strong>「{props.category.labelJa}」に追加</strong>
              <span>プロンプトで使う英語タグを入力</span>
            </div>
            <button className="icon-button" type="button" onClick={closeAddForm} aria-label="タグ追加を閉じる">
              <X />
            </button>
          </div>
          <label className="add-form-field">
            <span>タグ名</span>
            <textarea
              ref={tagInputRef}
              value={tagDraft}
              onChange={(event) => setTagDraft(event.target.value)}
              placeholder={"例：long_hair\nponytail\nbraided_hair"}
              aria-label={`${props.category.labelJa}に追加するタグ名`}
              rows={4}
            />
          </label>
          <div className="tag-add-summary" aria-live="polite">
            {tagsToAdd.length > 0 ? `${tagsToAdd.length}件のタグを追加します` : "1行に1件ずつ入力できます"}
          </div>
          <div className="add-form-actions">
            <button type="button" onClick={closeAddForm}>キャンセル</button>
            <button className="primary-button" type="submit" disabled={!tagsToAdd.length}>
              <CirclePlus />
              {tagsToAdd.length > 0 ? `${tagsToAdd.length}件を追加` : "タグを追加"}
            </button>
          </div>
        </form>
      )}
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
              changeLabel={props.changeLabels.get(tag.uid)}
              recentlyMoved={props.recentlyMovedIds.has(tag.uid)}
              visibleIds={visibleIds}
              onSelect={props.onSelect}
              onEdit={props.onEdit}
              onDelete={props.onDelete}
              onMoveRequest={props.onMoveRequest}
            />
          ))
        ) : (
          <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
            {virtualizer.getVirtualItems().map((item) => {
              const tag = visible[item.index];
              return (
                <div
                  key={tag.uid}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  style={{
                    position: "absolute",
                    insetInline: 0,
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  <TagRow
                    tag={tag}
                    selected={props.selectedIds.has(tag.uid)}
                    duplicateCount={props.duplicateCounts.get(tag.prompt.toLocaleLowerCase()) ?? 0}
                    changeLabel={props.changeLabels.get(tag.uid)}
                    recentlyMoved={props.recentlyMovedIds.has(tag.uid)}
                    visibleIds={visibleIds}
                    onSelect={props.onSelect}
                    onEdit={props.onEdit}
                    onDelete={props.onDelete}
                    onMoveRequest={props.onMoveRequest}
                  />
                </div>
              );
            })}
          </div>
        )}
        <div
          ref={endDroppable.setNodeRef}
          className={`lane-end-drop ${showEndTarget ? "is-over" : ""}`}
          aria-hidden="true"
        >
          {showEndTarget && (
            <span className="tag-drop-marker">
              <MoveDown />
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
