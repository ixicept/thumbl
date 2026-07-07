import { memo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  pointerWithin,
  type CollisionDetection,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  type Modifier,
} from "@dnd-kit/core";

const collisionDetection: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : closestCenter(args);
};
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { BlendMode, Layer, ShapeKind } from "../types/project";
import "./LayersPanel.css";

const SHAPE_GLYPH: Record<ShapeKind, string> = {
  rect: "▭",
  ellipse: "◯",
  line: "╱",
  arrow: "↗",
};

const BLEND_MODES: BlendMode[] = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "add",
];

const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });

interface LayersPanelProps {
  layers: Layer[];
  selectedIds: string[];
  onSelect: (id: string | null) => void;
  onCtrlSelect: (id: string) => void;
  onRangeSelect: (id: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onBatchReorder: (ids: string[], overId: string) => void;
  onToggleVisible: (id: string) => void;
  onBatchSetVisible: (ids: string[], visible: boolean) => void;
  onDelete: (id: string) => void;
  onBlendModeChange: (id: string, blendMode: BlendMode) => void;
  onColorChange: (id: string, color: string) => void;
  onRename: (id: string, name: string) => void;
  onMerge?: () => void;
}

export function LayersPanel({
  layers,
  selectedIds,
  onSelect,
  onCtrlSelect,
  onRangeSelect,
  onReorder,
  onBatchReorder,
  onToggleVisible,
  onBatchSetVisible,
  onDelete,
  onBlendModeChange,
  onColorChange,
  onRename,
  onMerge,
}: LayersPanelProps) {
  const sensors = useSensors(useSensor(PointerSensor));
  const displayLayers = [...layers].reverse();

  const mergeableCount = selectedIds.filter((id) => {
    const l = layers.find((x) => x.id === id);
    return l && l.type !== "fill";
  }).length;
  const canMerge = mergeableCount >= 2;

  const [activeId, setActiveId] = useState<string | null>(null);
  const [dragDelta, setDragDelta] = useState<{ x: number; y: number } | null>(null);

  const isBatchDrag = activeId !== null && selectedIds.includes(activeId) && selectedIds.length > 1;

  // During batch drag, exclude non-active selected layers from sortable so dnd-kit
  // doesn't calculate conflicting sort transforms for them.
  const sortableIds = isBatchDrag
    ? displayLayers.filter((l) => !selectedIds.includes(l.id) || l.id === activeId).map((l) => l.id)
    : displayLayers.map((l) => l.id);

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
    setDragDelta(null);
  }

  function handleDragMove(event: DragMoveEvent) {
    if (isBatchDrag) setDragDelta(event.delta);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    setDragDelta(null);

    if (!over || active.id === over.id) return;

    if (isBatchDrag) {
      onBatchReorder(selectedIds, String(over.id));
    } else {
      const oldDisplayIndex = displayLayers.findIndex((l) => l.id === active.id);
      const newDisplayIndex = displayLayers.findIndex((l) => l.id === over.id);
      if (oldDisplayIndex === -1 || newDisplayIndex === -1) return;
      const fromIndex = layers.length - 1 - oldDisplayIndex;
      const toIndex = layers.length - 1 - newDisplayIndex;
      onReorder(fromIndex, toIndex);
    }
  }

  function handleDragCancel() {
    setActiveId(null);
    setDragDelta(null);
  }

  return (
    <div className="layers-panel-content">
      {canMerge && onMerge && (
        <button className="layers-merge-btn" onClick={onMerge}>
          Merge {mergeableCount} layers
        </button>
      )}
{displayLayers.length === 0 && (
        <p className="layers-panel-empty">No layers yet</p>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        modifiers={[verticalOnly]}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
          <ul className="layers-list">
            {displayLayers.map((layer) => {
              const isGroupMember =
                isBatchDrag &&
                selectedIds.includes(layer.id) &&
                layer.id !== activeId;
              return (
                <LayerRow
                  key={layer.id}
                  layer={layer}
                  selected={selectedIds.includes(layer.id)}
                  selectedIds={selectedIds}
                  isGroupMember={isGroupMember}
                  dragDelta={isGroupMember ? dragDelta : null}
                  onSelect={onSelect}
                  onCtrlSelect={onCtrlSelect}
                  onRangeSelect={onRangeSelect}
                  onToggleVisible={onToggleVisible}
                  onBatchSetVisible={onBatchSetVisible}
                  onDelete={onDelete}
                  onBlendModeChange={onBlendModeChange}
                  onColorChange={onColorChange}
                  onRename={onRename}
                />
              );
            })}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  );
}

interface LayerRowProps {
  layer: Layer;
  selected: boolean;
  selectedIds: string[];
  isGroupMember: boolean;
  dragDelta: { x: number; y: number } | null;
  onSelect: (id: string | null) => void;
  onCtrlSelect: (id: string) => void;
  onRangeSelect: (id: string) => void;
  onToggleVisible: (id: string) => void;
  onBatchSetVisible: (ids: string[], visible: boolean) => void;
  onDelete: (id: string) => void;
  onBlendModeChange: (id: string, blendMode: BlendMode) => void;
  onColorChange: (id: string, color: string) => void;
  onRename: (id: string, name: string) => void;
}

const LayerRow = memo(function LayerRow({
  layer,
  selected,
  selectedIds,
  isGroupMember,
  dragDelta,
  onSelect,
  onCtrlSelect,
  onRangeSelect,
  onToggleVisible,
  onBatchSetVisible,
  onDelete,
  onBlendModeChange,
  onColorChange,
  onRename,
}: LayerRowProps) {
  // Disable sortable for group members so dnd-kit doesn't apply competing transforms
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: layer.id,
    disabled: isGroupMember,
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(layer.name);

  const style = isGroupMember
    ? {
        transform: dragDelta ? `translateY(${dragDelta.y}px)` : undefined,
        transition: "none",
        zIndex: 100,
        opacity: 0.85,
      }
    : {
        transform: CSS.Transform.toString(transform),
        transition,
      };

  function startEditing() {
    setDraft(layer.name);
    setEditing(true);
  }

  function commit() {
    const next = draft.trim();
    if (next && next !== layer.name) onRename(layer.id, next);
    setEditing(false);
  }

  function handleVisibilityClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (selected && selectedIds.length > 1) {
      onBatchSetVisible(selectedIds, !layer.visible);
    } else {
      onToggleVisible(layer.id);
    }
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`layer-row${selected ? " layer-row-selected" : ""}`}
      onClick={(e) => {
        if (e.shiftKey) onRangeSelect(layer.id);
        else if (e.ctrlKey || e.metaKey) onCtrlSelect(layer.id);
        else onSelect(layer.id);
      }}
    >
      <button
        className="layer-drag-handle"
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
      >
        ⠿
      </button>
      <button className="layer-visibility-toggle" onClick={handleVisibilityClick}>
        {layer.visible ? "👁" : "🚫"}
      </button>
      {layer.type === "image" && (
        <img className="layer-thumbnail" src={convertFileSrc(layer.src)} alt="" />
      )}
      {layer.type === "fill" && (
        <input
          type="color"
          className="layer-color-swatch"
          value={layer.color}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onColorChange(layer.id, e.target.value)}
        />
      )}
      {layer.type === "text" && <span className="layer-icon">T</span>}
      {layer.type === "shape" && (
        <span className="layer-icon">{SHAPE_GLYPH[layer.shapeKind]}</span>
      )}
      {editing ? (
        <input
          className="layer-name-edit"
          value={draft}
          autoFocus
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            else if (e.key === "Escape") setEditing(false);
          }}
        />
      ) : (
        <span
          className="layer-name"
          onDoubleClick={(e) => {
            e.stopPropagation();
            startEditing();
          }}
        >
          {layer.name}
        </span>
      )}
      <select
        className="layer-blend-mode"
        value={layer.blendMode}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onBlendModeChange(layer.id, e.target.value as BlendMode)}
      >
        {BLEND_MODES.map((mode) => (
          <option key={mode} value={mode}>
            {mode}
          </option>
        ))}
      </select>
      <button
        className="layer-delete"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(layer.id);
        }}
      >
        ✕
      </button>
    </li>
  );
});
