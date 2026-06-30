import { useEffect, useRef, useState } from "react";
import { Application, Assets, Container, Graphics, Sprite } from "pixi.js";
import "pixi.js/advanced-blend-modes";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Layer, LayerChanges } from "../types/project";

const HANDLE_SIZE = 10;
const MIN_SIZE = 20;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;

type HandleType = "tl" | "t" | "tr" | "r" | "br" | "b" | "bl" | "l";

const HANDLE_DEFS: { type: HandleType; cursor: string }[] = [
  { type: "tl", cursor: "nwse-resize" },
  { type: "t", cursor: "ns-resize" },
  { type: "tr", cursor: "nesw-resize" },
  { type: "r", cursor: "ew-resize" },
  { type: "br", cursor: "nwse-resize" },
  { type: "b", cursor: "ns-resize" },
  { type: "bl", cursor: "nesw-resize" },
  { type: "l", cursor: "ew-resize" },
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

function computeResize(
  type: HandleType,
  dx: number,
  dy: number,
  start: Rect
): Rect {
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
  content: Sprite | Graphics;
  outline: Graphics;
  handles: Map<HandleType, Graphics>;
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
        const cacheKey = layer.type === "image" ? layer.src : `fill:${layer.color}`;
        const interactive = layer.type === "image";

        if (!entry || entry.cacheKey !== cacheKey) {
          if (entry) {
            entry.container.destroy({ children: true });
            entries.delete(layer.id);
          }

          let content: Sprite | Graphics;
          if (layer.type === "image") {
            const texture = await Assets.load(convertFileSrc(layer.src));
            if (cancelled) return;
            const sprite = new Sprite(texture);
            sprite.anchor.set(0, 0);
            content = sprite;
          } else {
            const fill = new Graphics();
            fill.rect(0, 0, canvasWidth, canvasHeight).fill(layer.color);
            content = fill;
          }

          const outline = new Graphics();

          const container = new Container();
          container.addChild(content, outline);
          stage!.addChild(container);

          const handles = new Map<HandleType, Graphics>();
          if (interactive) {
            container.eventMode = "static";
            container.cursor = "move";
            for (const { type, cursor } of HANDLE_DEFS) {
              const handle = new Graphics();
              handle.eventMode = "static";
              handle.cursor = cursor;
              container.addChild(handle);
              handles.set(type, handle);
              attachResizeHandlers(handle, type, layer.id, onLayerChangeRef, layersRef);
            }
            attachDragHandlers(container, layer.id, onSelectRef, onLayerChangeRef, layersRef);
          } else {
            container.eventMode = "none";
          }

          entry = { container, content, outline, handles, cacheKey };
          entries.set(layer.id, entry);
        }

        const selected = interactive && layer.id === selectedId;

        entry.container.visible = layer.visible;
        entry.content.blendMode = layer.blendMode;

        if (layer.type === "image") {
          entry.container.position.set(layer.x, layer.y);
          entry.container.rotation = layer.rotation;
          (entry.content as Sprite).width = layer.width;
          (entry.content as Sprite).height = layer.height;
        } else {
          entry.container.position.set(0, 0);
          entry.container.rotation = 0;
        }

        entry.outline.clear();
        if (selected && layer.type === "image") {
          entry.outline.rect(0, 0, layer.width, layer.height);
          entry.outline.stroke({ width: 2, color: 0x4f9eff });
        }

        for (const [type, handle] of entry.handles) {
          if (layer.type !== "image") continue;
          const { x, y } = handlePosition(type, layer.width, layer.height);
          handle.clear();
          handle.rect(
            x - HANDLE_SIZE / 2,
            y - HANDLE_SIZE / 2,
            HANDLE_SIZE,
            HANDLE_SIZE
          );
          handle.fill(0x4f9eff);
          handle.visible = selected;
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
  }, [layers, selectedId]);

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

function attachDragHandlers(
  container: Container,
  layerId: string,
  onSelectRef: React.MutableRefObject<(id: string | null) => void>,
  onLayerChangeRef: React.MutableRefObject<
    (id: string, changes: LayerChanges) => void
  >,
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
    startPos = {
      x: layer?.type === "image" ? layer.x : 0,
      y: layer?.type === "image" ? layer.y : 0,
    };
  });

  const move = (e: { global: { x: number; y: number } }) => {
    if (!dragging) return;
    const dx = e.global.x - startPointer.x;
    const dy = e.global.y - startPointer.y;
    onLayerChangeRef.current(layerId, {
      x: startPos.x + dx,
      y: startPos.y + dy,
    });
  };

  container.on("globalpointermove", move);
  container.on("pointerup", () => (dragging = false));
  container.on("pointerupoutside", () => (dragging = false));
}

function attachResizeHandlers(
  handle: Graphics,
  handleType: HandleType,
  layerId: string,
  onLayerChangeRef: React.MutableRefObject<
    (id: string, changes: LayerChanges) => void
  >,
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
    start =
      layer?.type === "image"
        ? { x: layer.x, y: layer.y, width: layer.width, height: layer.height }
        : { x: 0, y: 0, width: 0, height: 0 };
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
