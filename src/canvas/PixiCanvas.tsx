import { useEffect, useRef, useState } from "react";
import {
  Application,
  Assets,
  Container,
  Graphics,
  Sprite,
  Text,
  TextStyle,
} from "pixi.js";
import "pixi.js/advanced-blend-modes";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Layer, LayerChanges } from "../types/project";

const HANDLE_SIZE = 10;
const ENDPOINT_RADIUS = 6;
const MIN_SIZE = 20;
const MIN_FONT = 4;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;
const SELECT_COLOR = 0x4f9eff;

type HandleType = "tl" | "t" | "tr" | "r" | "br" | "b" | "bl" | "l";

const BOX_HANDLE_DEFS: { type: HandleType; cursor: string }[] = [
  { type: "tl", cursor: "nwse-resize" },
  { type: "t", cursor: "ns-resize" },
  { type: "tr", cursor: "nesw-resize" },
  { type: "r", cursor: "ew-resize" },
  { type: "br", cursor: "nwse-resize" },
  { type: "b", cursor: "ns-resize" },
  { type: "bl", cursor: "nesw-resize" },
  { type: "l", cursor: "ew-resize" },
];

const CORNER_HANDLE_DEFS: { type: HandleType; cursor: string }[] = [
  { type: "tl", cursor: "nwse-resize" },
  { type: "tr", cursor: "nesw-resize" },
  { type: "bl", cursor: "nesw-resize" },
  { type: "br", cursor: "nwse-resize" },
];

function handlePosition(type: HandleType, width: number, height: number) {
  const x = type.includes("l") ? 0 : type.includes("r") ? width : width / 2;
  const y = type.includes("t") ? 0 : type.includes("b") ? height : height / 2;
  return { x, y };
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function computeResize(type: HandleType, dx: number, dy: number, start: Rect): Rect {
  const left = type.includes("l");
  const right = type.includes("r");
  const top = type.includes("t");
  const bottom = type.includes("b");

  let { x, y, width, height } = start;

  if (left) {
    width = start.width - dx;
    x = start.x + dx;
  } else if (right) {
    width = start.width + dx;
  }

  if (top) {
    height = start.height - dy;
    y = start.y + dy;
  } else if (bottom) {
    height = start.height + dy;
  }

  if (width < MIN_SIZE) {
    if (left) x = start.x + start.width - MIN_SIZE;
    width = MIN_SIZE;
  }
  if (height < MIN_SIZE) {
    if (top) y = start.y + start.height - MIN_SIZE;
    height = MIN_SIZE;
  }

  return { x, y, width, height };
}

type Interaction = "box" | "text" | "endpoint" | "none";

function interactionFor(layer: Layer): Interaction {
  switch (layer.type) {
    case "image":
      return "box";
    case "fill":
      return "none";
    case "text":
      return "text";
    case "shape":
      return layer.shapeKind === "line" || layer.shapeKind === "arrow"
        ? "endpoint"
        : "box";
  }
}

/** Bounding box (x/y/width/height) for box-style layers. */
function boxRect(layer: Layer): Rect {
  if (layer.type === "image") {
    return { x: layer.x, y: layer.y, width: layer.width, height: layer.height };
  }
  if (layer.type === "text") {
    return { x: layer.x, y: layer.y, width: 0, height: 0 };
  }
  if (layer.type === "shape") {
    return {
      x: layer.x ?? 0,
      y: layer.y ?? 0,
      width: layer.width ?? 0,
      height: layer.height ?? 0,
    };
  }
  return { x: 0, y: 0, width: 0, height: 0 };
}

function cacheKeyFor(layer: Layer): string {
  switch (layer.type) {
    case "image":
      return `image:${layer.src}`;
    case "fill":
      return "fill";
    case "text":
      return "text";
    case "shape":
      return `shape:${layer.shapeKind}`;
  }
}

interface PixiCanvasProps {
  canvasWidth: number;
  canvasHeight: number;
  layers: Layer[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onLayerChange: (id: string, changes: LayerChanges) => void;
}

interface LayerEntry {
  container: Container;
  content: Sprite | Graphics | Text;
  outline: Graphics;
  handles: Map<HandleType, Graphics>;
  endpointHandles: Graphics[];
  hitLine?: Graphics;
  cacheKey: string;
}

export function PixiCanvas({
  canvasWidth,
  canvasHeight,
  layers,
  selectedId,
  onSelect,
  onLayerChange,
}: PixiCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const stageRef = useRef<Container | null>(null);
  const entriesRef = useRef<Map<string, LayerEntry>>(new Map());
  const layersRef = useRef<Layer[]>(layers);
  const onLayerChangeRef = useRef(onLayerChange);
  const onSelectRef = useRef(onSelect);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  layersRef.current = layers;
  onLayerChangeRef.current = onLayerChange;
  onSelectRef.current = onSelect;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    function handleWheel(e: WheelEvent) {
      e.preventDefault();
      if (e.ctrlKey) {
        setZoom((z) => {
          const next = z * (e.deltaY < 0 ? 1.1 : 1 / 1.1);
          return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
        });
      } else if (e.shiftKey) {
        const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY;
        setPan((p) => ({ x: p.x - delta, y: p.y }));
      } else {
        setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
      }
    }

    host.addEventListener("wheel", handleWheel, { passive: false });
    return () => host.removeEventListener("wheel", handleWheel);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    function handlePointerDown(e: PointerEvent) {
      if (e.button !== 1) return;
      e.preventDefault();

      let lastX = e.clientX;
      let lastY = e.clientY;

      function handlePointerMove(ev: PointerEvent) {
        const dx = ev.clientX - lastX;
        const dy = ev.clientY - lastY;
        lastX = ev.clientX;
        lastY = ev.clientY;
        setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
      }

      function handlePointerUp() {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        host!.style.cursor = "";
      }

      host!.style.cursor = "grabbing";
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    }

    host.addEventListener("pointerdown", handlePointerDown);
    return () => host.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    const app = new Application();

    app
      .init({
        width: canvasWidth,
        height: canvasHeight,
        background: "#2b2b2b",
        antialias: true,
      })
      .then(() => {
        if (cancelled || !hostRef.current) {
          app.destroy(true, { children: true });
          return;
        }
        hostRef.current.appendChild(app.canvas);
        appRef.current = app;
        const stage = new Container();
        stage.eventMode = "static";
        stage.hitArea = app.screen;
        stage.on("pointerdown", (e) => {
          if (e.button !== 0) return;
          onSelectRef.current(null);
        });
        app.stage.addChild(stage);
        stageRef.current = stage;
      });

    return () => {
      cancelled = true;
      entriesRef.current.clear();
      stageRef.current = null;
      if (appRef.current) {
        appRef.current.destroy(true, { children: true });
        appRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (app) {
      app.renderer.resize(canvasWidth, canvasHeight);
    }
  }, [canvasWidth, canvasHeight]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    let cancelled = false;

    async function sync() {
      const entries = entriesRef.current;
      const seen = new Set<string>();

      for (const layer of layers) {
        seen.add(layer.id);
        let entry = entries.get(layer.id);
        const cacheKey = cacheKeyFor(layer);
        const interaction = interactionFor(layer);

        if (!entry || entry.cacheKey !== cacheKey) {
          if (entry) {
            entry.container.destroy({ children: true });
            entries.delete(layer.id);
          }

          let content: Sprite | Graphics | Text;
          if (layer.type === "image") {
            const texture = await Assets.load(convertFileSrc(layer.src));
            if (cancelled) return;
            const sprite = new Sprite(texture);
            sprite.anchor.set(0, 0);
            content = sprite;
          } else if (layer.type === "text") {
            content = new Text({ text: layer.text, style: new TextStyle({}) });
          } else {
            content = new Graphics();
          }

          const outline = new Graphics();
          const container = new Container();
          container.addChild(content);
          container.addChild(outline);
          stage!.addChild(container);

          const handles = new Map<HandleType, Graphics>();
          const endpointHandles: Graphics[] = [];
          let hitLine: Graphics | undefined;

          if (interaction === "box" || interaction === "text") {
            container.eventMode = "static";
            container.cursor = "move";
            attachDragHandlers(container, layer.id, onSelectRef, onLayerChangeRef, layersRef);
            const defs = interaction === "text" ? CORNER_HANDLE_DEFS : BOX_HANDLE_DEFS;
            for (const { type, cursor } of defs) {
              const handle = new Graphics();
              handle.eventMode = "static";
              handle.cursor = cursor;
              container.addChild(handle);
              handles.set(type, handle);
              if (interaction === "text") {
                attachTextResizeHandlers(handle, type, layer.id, onLayerChangeRef, layersRef);
              } else {
                attachResizeHandlers(handle, type, layer.id, onLayerChangeRef, layersRef);
              }
            }
          } else if (interaction === "endpoint") {
            hitLine = new Graphics();
            hitLine.eventMode = "static";
            hitLine.cursor = "move";
            container.addChild(hitLine);
            attachLineBodyDragHandlers(hitLine, layer.id, onSelectRef, onLayerChangeRef, layersRef);
            for (const which of ["start", "end"] as const) {
              const handle = new Graphics();
              handle.eventMode = "static";
              handle.cursor = "move";
              container.addChild(handle);
              endpointHandles.push(handle);
              attachEndpointHandlers(handle, which, layer.id, onLayerChangeRef, layersRef);
            }
          } else {
            container.eventMode = "none";
          }

          entry = { container, content, outline, handles, endpointHandles, hitLine, cacheKey };
          entries.set(layer.id, entry);
        }

        const selected = interaction !== "none" && layer.id === selectedId;

        entry.container.visible = layer.visible;
        entry.content.blendMode = layer.blendMode;

        // --- content geometry / styling ---
        if (layer.type === "image") {
          entry.container.position.set(layer.x, layer.y);
          entry.container.rotation = layer.rotation;
          (entry.content as Sprite).width = layer.width;
          (entry.content as Sprite).height = layer.height;
        } else if (layer.type === "fill") {
          entry.container.position.set(0, 0);
          entry.container.rotation = 0;
          const g = entry.content as Graphics;
          g.clear();
          g.rect(0, 0, canvasWidth, canvasHeight).fill(layer.color);
        } else if (layer.type === "text") {
          const t = entry.content as Text;
          t.style = new TextStyle({
            fontFamily: layer.fontFamily,
            fontSize: layer.fontSize,
            fontWeight: String(layer.fontWeight) as TextStyle["fontWeight"],
            fontStyle: layer.italic ? "italic" : "normal",
            fill: layer.fill,
            align: layer.align,
            ...(layer.stroke
              ? { stroke: { color: layer.stroke.color, width: layer.stroke.width } }
              : {}),
            ...(layer.dropShadow
              ? {
                  dropShadow: {
                    color: layer.dropShadow.color,
                    alpha: layer.dropShadow.alpha,
                    blur: layer.dropShadow.blur,
                    angle: layer.dropShadow.angle,
                    distance: layer.dropShadow.distance,
                  },
                }
              : {}),
          });
          t.text = layer.text;
          entry.container.position.set(layer.x, layer.y);
          entry.container.rotation = layer.rotation;
        } else if (layer.type === "shape") {
          const g = entry.content as Graphics;
          g.clear();
          if (layer.shapeKind === "rect" || layer.shapeKind === "ellipse") {
            entry.container.position.set(layer.x ?? 0, layer.y ?? 0);
            entry.container.rotation = layer.rotation ?? 0;
            const w = layer.width ?? 0;
            const h = layer.height ?? 0;
            if (layer.shapeKind === "rect") g.rect(0, 0, w, h);
            else g.ellipse(w / 2, h / 2, w / 2, h / 2);
            if (layer.fill) g.fill(layer.fill);
            if (layer.strokeWidth > 0 && layer.strokeColor)
              g.stroke({ width: layer.strokeWidth, color: layer.strokeColor });
          } else {
            entry.container.position.set(0, 0);
            entry.container.rotation = 0;
            drawLine(g, layer, false);
            if (entry.hitLine) drawLine(entry.hitLine, layer, true);
          }
        }

        // --- selection outline ---
        entry.outline.clear();
        if (selected && (interaction === "box" || interaction === "text")) {
          const w =
            layer.type === "text" ? entry.content.width : boxRect(layer).width;
          const h =
            layer.type === "text" ? entry.content.height : boxRect(layer).height;
          entry.outline.rect(0, 0, w, h).stroke({ width: 2, color: SELECT_COLOR });
        }

        // --- box / corner handles ---
        for (const [type, handle] of entry.handles) {
          const w =
            layer.type === "text" ? entry.content.width : boxRect(layer).width;
          const h =
            layer.type === "text" ? entry.content.height : boxRect(layer).height;
          const { x, y } = handlePosition(type, w, h);
          handle.clear();
          handle
            .rect(x - HANDLE_SIZE / 2, y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE)
            .fill(SELECT_COLOR);
          handle.visible = selected;
        }

        // --- endpoint handles ---
        if (layer.type === "shape" && interaction === "endpoint") {
          const pts = [
            { x: layer.x1 ?? 0, y: layer.y1 ?? 0 },
            { x: layer.x2 ?? 0, y: layer.y2 ?? 0 },
          ];
          entry.endpointHandles.forEach((handle, i) => {
            handle.clear();
            handle.circle(pts[i].x, pts[i].y, ENDPOINT_RADIUS).fill(SELECT_COLOR);
            handle.visible = selected;
          });
        }
      }

      for (const [id, entry] of entries) {
        if (!seen.has(id)) {
          entry.container.destroy({ children: true });
          entries.delete(id);
        }
      }

      layers.forEach((layer, index) => {
        const entry = entries.get(layer.id);
        if (entry) stage!.setChildIndex(entry.container, index);
      });
    }

    void sync();

    return () => {
      cancelled = true;
    };
  }, [layers, selectedId, canvasWidth, canvasHeight]);

  return (
    <div
      ref={hostRef}
      className="pixi-canvas-host"
      style={{
        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
      }}
    />
  );
}

function drawLine(
  g: Graphics,
  layer: Extract<Layer, { type: "shape" }>,
  hit: boolean
) {
  const x1 = layer.x1 ?? 0;
  const y1 = layer.y1 ?? 0;
  const x2 = layer.x2 ?? 0;
  const y2 = layer.y2 ?? 0;
  const width = hit
    ? Math.max(16, layer.strokeWidth + 12)
    : Math.max(1, layer.strokeWidth);
  const color = layer.strokeColor ?? "#000000";

  g.moveTo(x1, y1).lineTo(x2, y2);

  if (layer.shapeKind === "arrow") {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const headLen = Math.max(12, layer.strokeWidth * 3);
    const a1 = angle + Math.PI - 0.4;
    const a2 = angle + Math.PI + 0.4;
    g.moveTo(x2, y2).lineTo(x2 + headLen * Math.cos(a1), y2 + headLen * Math.sin(a1));
    g.moveTo(x2, y2).lineTo(x2 + headLen * Math.cos(a2), y2 + headLen * Math.sin(a2));
  }

  g.stroke({ width, color, alpha: hit ? 0.001 : 1, cap: "round" });
}

function attachDragHandlers(
  container: Container,
  layerId: string,
  onSelectRef: React.MutableRefObject<(id: string | null) => void>,
  onLayerChangeRef: React.MutableRefObject<(id: string, changes: LayerChanges) => void>,
  layersRef: React.MutableRefObject<Layer[]>
) {
  let dragging = false;
  let startPointer = { x: 0, y: 0 };
  let startPos = { x: 0, y: 0 };

  container.on("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onSelectRef.current(layerId);
    dragging = true;
    startPointer = { x: e.global.x, y: e.global.y };
    const layer = layersRef.current.find((l) => l.id === layerId);
    const r = layer ? boxRect(layer) : { x: 0, y: 0 };
    startPos = { x: r.x, y: r.y };
  });

  const move = (e: { global: { x: number; y: number } }) => {
    if (!dragging) return;
    const dx = e.global.x - startPointer.x;
    const dy = e.global.y - startPointer.y;
    onLayerChangeRef.current(layerId, { x: startPos.x + dx, y: startPos.y + dy });
  };

  container.on("globalpointermove", move);
  container.on("pointerup", () => (dragging = false));
  container.on("pointerupoutside", () => (dragging = false));
}

function attachResizeHandlers(
  handle: Graphics,
  handleType: HandleType,
  layerId: string,
  onLayerChangeRef: React.MutableRefObject<(id: string, changes: LayerChanges) => void>,
  layersRef: React.MutableRefObject<Layer[]>
) {
  let resizing = false;
  let startPointer = { x: 0, y: 0 };
  let start: Rect = { x: 0, y: 0, width: 0, height: 0 };

  handle.on("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    resizing = true;
    startPointer = { x: e.global.x, y: e.global.y };
    const layer = layersRef.current.find((l) => l.id === layerId);
    start = layer ? boxRect(layer) : { x: 0, y: 0, width: 0, height: 0 };
  });

  const move = (e: { global: { x: number; y: number } }) => {
    if (!resizing) return;
    const dx = e.global.x - startPointer.x;
    const dy = e.global.y - startPointer.y;
    onLayerChangeRef.current(layerId, computeResize(handleType, dx, dy, start));
  };

  handle.on("globalpointermove", move);
  handle.on("pointerup", () => (resizing = false));
  handle.on("pointerupoutside", () => (resizing = false));
}

function attachTextResizeHandlers(
  handle: Graphics,
  handleType: HandleType,
  layerId: string,
  onLayerChangeRef: React.MutableRefObject<(id: string, changes: LayerChanges) => void>,
  layersRef: React.MutableRefObject<Layer[]>
) {
  let resizing = false;
  let startPointer = { x: 0, y: 0 };
  let startFont = 0;
  const bottom = handleType.includes("b");

  handle.on("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    resizing = true;
    startPointer = { x: e.global.x, y: e.global.y };
    const layer = layersRef.current.find((l) => l.id === layerId);
    startFont = layer?.type === "text" ? layer.fontSize : 0;
  });

  const move = (e: { global: { x: number; y: number } }) => {
    if (!resizing) return;
    const dy = e.global.y - startPointer.y;
    const delta = bottom ? dy : -dy;
    const fontSize = Math.max(MIN_FONT, startFont + delta);
    onLayerChangeRef.current(layerId, { fontSize });
  };

  handle.on("globalpointermove", move);
  handle.on("pointerup", () => (resizing = false));
  handle.on("pointerupoutside", () => (resizing = false));
}

function attachLineBodyDragHandlers(
  target: Graphics,
  layerId: string,
  onSelectRef: React.MutableRefObject<(id: string | null) => void>,
  onLayerChangeRef: React.MutableRefObject<(id: string, changes: LayerChanges) => void>,
  layersRef: React.MutableRefObject<Layer[]>
) {
  let dragging = false;
  let startPointer = { x: 0, y: 0 };
  let s = { x1: 0, y1: 0, x2: 0, y2: 0 };

  target.on("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onSelectRef.current(layerId);
    dragging = true;
    startPointer = { x: e.global.x, y: e.global.y };
    const layer = layersRef.current.find((l) => l.id === layerId);
    if (layer?.type === "shape") {
      s = {
        x1: layer.x1 ?? 0,
        y1: layer.y1 ?? 0,
        x2: layer.x2 ?? 0,
        y2: layer.y2 ?? 0,
      };
    }
  });

  const move = (e: { global: { x: number; y: number } }) => {
    if (!dragging) return;
    const dx = e.global.x - startPointer.x;
    const dy = e.global.y - startPointer.y;
    onLayerChangeRef.current(layerId, {
      x1: s.x1 + dx,
      y1: s.y1 + dy,
      x2: s.x2 + dx,
      y2: s.y2 + dy,
    });
  };

  target.on("globalpointermove", move);
  target.on("pointerup", () => (dragging = false));
  target.on("pointerupoutside", () => (dragging = false));
}

function attachEndpointHandlers(
  handle: Graphics,
  which: "start" | "end",
  layerId: string,
  onLayerChangeRef: React.MutableRefObject<(id: string, changes: LayerChanges) => void>,
  layersRef: React.MutableRefObject<Layer[]>
) {
  let active = false;
  let startPointer = { x: 0, y: 0 };
  let start = { x: 0, y: 0 };

  handle.on("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    active = true;
    startPointer = { x: e.global.x, y: e.global.y };
    const layer = layersRef.current.find((l) => l.id === layerId);
    if (layer?.type === "shape") {
      start =
        which === "start"
          ? { x: layer.x1 ?? 0, y: layer.y1 ?? 0 }
          : { x: layer.x2 ?? 0, y: layer.y2 ?? 0 };
    }
  });

  const move = (e: { global: { x: number; y: number } }) => {
    if (!active) return;
    const dx = e.global.x - startPointer.x;
    const dy = e.global.y - startPointer.y;
    const changes: LayerChanges =
      which === "start"
        ? { x1: start.x + dx, y1: start.y + dy }
        : { x2: start.x + dx, y2: start.y + dy };
    onLayerChangeRef.current(layerId, changes);
  };

  handle.on("globalpointermove", move);
  handle.on("pointerup", () => (active = false));
  handle.on("pointerupoutside", () => (active = false));
}
