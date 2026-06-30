import { useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
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

interface LayersPanelProps {
  layers: Layer[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onToggleVisible: (id: string) => void;
  onDelete: (id: string) => void;
  onBlendModeChange: (id: string, blendMode: BlendMode) => void;
  onColorChange: (id: string, color: string) => void;
  onRename: (id: string, name: string) => void;
}

export function LayersPanel({
  layers,
  selectedId,
  onSelect,
  onReorder,
  onToggleVisible,
  onDelete,
  onBlendModeChange,
  onColorChange,
  onRename,
}: LayersPanelProps) {
  const sensors = useSensors(useSensor(PointerSensor));
  const displayLayers = [...layers].reverse();

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldDisplayIndex = displayLayers.findIndex((l) => l.id === active.id);
    const newDisplayIndex = displayLayers.findIndex((l) => l.id === over.id);
    if (oldDisplayIndex === -1 || newDisplayIndex === -1) return;

    const fromIndex = layers.length - 1 - oldDisplayIndex;
    const toIndex = layers.length - 1 - newDisplayIndex;
    onReorder(fromIndex, toIndex);
  }

  return (
    <div className="layers-panel-content">
      <h2>Layers</h2>
      {displayLayers.length === 0 && (
        <p className="layers-panel-empty">No layers yet</p>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={displayLayers.map((l) => l.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="layers-list">
            {displayLayers.map((layer) => (
              <LayerRow
                key={layer.id}
                layer={layer}
                selected={layer.id === selectedId}
                onSelect={onSelect}
                onToggleVisible={onToggleVisible}
                onDelete={onDelete}
                onBlendModeChange={onBlendModeChange}
                onColorChange={onColorChange}
                onRename={onRename}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  );
}

interface LayerRowProps {
  layer: Layer;
  selected: boolean;
  onSelect: (id: string | null) => void;
  onToggleVisible: (id: string) => void;
  onDelete: (id: string) => void;
  onBlendModeChange: (id: string, blendMode: BlendMode) => void;
  onColorChange: (id: string, color: string) => void;
  onRename: (id: string, name: string) => void;
}

function LayerRow({
  layer,
  selected,
  onSelect,
  onToggleVisible,
  onDelete,
  onBlendModeChange,
  onColorChange,
  onRename,
}: LayerRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: layer.id });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(layer.name);

  const style = {
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

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`layer-row${selected ? " layer-row-selected" : ""}`}
      onClick={() => onSelect(layer.id)}
    >
      <button
        className="layer-drag-handle"
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
      >
        ⠿
      </button>
      <button
        className="layer-visibility-toggle"
        onClick={(e) => {
          e.stopPropagation();
          onToggleVisible(layer.id);
        }}
      >
        {layer.visible ? "👁" : "🚫"}
      </button>
      {layer.type === "image" && (
        <img
          className="layer-thumbnail"
          src={convertFileSrc(layer.src)}
          alt=""
        />
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
        onChange={(e) =>
          onBlendModeChange(layer.id, e.target.value as BlendMode)
        }
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
}
