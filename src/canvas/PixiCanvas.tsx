import { useEffect, useRef } from "react";
import { Application, Assets, Container, Graphics, Sprite } from "pixi.js";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Layer } from "../types/project";

const HANDLE_SIZE = 10;
const MIN_SIZE = 20;

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
  onLayerChange: (id: string, changes: Partial<Layer>) => void;
}

interface LayerEntry {
  container: Container;
  sprite: Sprite;
  outline: Graphics;
  handles: Map<HandleType, Graphics>;
  src: string;
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

  layersRef.current = layers;
  onLayerChangeRef.current = onLayerChange;
  onSelectRef.current = onSelect;

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
        stage.on("pointerdown", () => onSelectRef.current(null));
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

        if (!entry || entry.src !== layer.src) {
          if (entry) {
            entry.container.destroy({ children: true });
            entries.delete(layer.id);
          }
          const texture = await Assets.load(convertFileSrc(layer.src));
          if (cancelled) return;

          const sprite = new Sprite(texture);
          sprite.anchor.set(0, 0);

          const outline = new Graphics();

          const container = new Container();
          container.addChild(sprite, outline);
          container.eventMode = "static";
          container.cursor = "move";
          stage!.addChild(container);

          const handles = new Map<HandleType, Graphics>();
          for (const { type, cursor } of HANDLE_DEFS) {
            const handle = new Graphics();
            handle.eventMode = "static";
            handle.cursor = cursor;
            container.addChild(handle);
            handles.set(type, handle);
            attachResizeHandlers(handle, type, layer.id, onLayerChangeRef, layersRef);
          }

          entry = { container, sprite, outline, handles, src: layer.src };
          entries.set(layer.id, entry);

          attachDragHandlers(container, layer.id, onSelectRef, onLayerChangeRef, layersRef);
        }

        const selected = layer.id === selectedId;

        entry.container.position.set(layer.x, layer.y);
        entry.sprite.width = layer.width;
        entry.sprite.height = layer.height;
        entry.container.rotation = layer.rotation;

        entry.outline.clear();
        if (selected) {
          entry.outline.rect(0, 0, layer.width, layer.height);
          entry.outline.stroke({ width: 2, color: 0x4f9eff });
        }

        for (const [type, handle] of entry.handles) {
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
    }

    void sync();

    return () => {
      cancelled = true;
    };
  }, [layers, selectedId]);

  return <div ref={hostRef} className="pixi-canvas-host" />;
}

function attachDragHandlers(
  container: Container,
  layerId: string,
  onSelectRef: React.MutableRefObject<(id: string | null) => void>,
  onLayerChangeRef: React.MutableRefObject<
    (id: string, changes: Partial<Layer>) => void
  >,
  layersRef: React.MutableRefObject<Layer[]>
) {
  let dragging = false;
  let startPointer = { x: 0, y: 0 };
  let startPos = { x: 0, y: 0 };

  container.on("pointerdown", (e) => {
    e.stopPropagation();
    onSelectRef.current(layerId);
    dragging = true;
    startPointer = { x: e.global.x, y: e.global.y };
    const layer = layersRef.current.find((l) => l.id === layerId);
    startPos = { x: layer?.x ?? 0, y: layer?.y ?? 0 };
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
    (id: string, changes: Partial<Layer>) => void
  >,
  layersRef: React.MutableRefObject<Layer[]>
) {
  let resizing = false;
  let startPointer = { x: 0, y: 0 };
  let start: Rect = { x: 0, y: 0, width: 0, height: 0 };

  handle.on("pointerdown", (e) => {
    e.stopPropagation();
    resizing = true;
    startPointer = { x: e.global.x, y: e.global.y };
    const layer = layersRef.current.find((l) => l.id === layerId);
    start = {
      x: layer?.x ?? 0,
      y: layer?.y ?? 0,
      width: layer?.width ?? 0,
      height: layer?.height ?? 0,
    };
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
