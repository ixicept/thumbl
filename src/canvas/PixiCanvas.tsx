import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  Application,
  Assets,
  ColorMatrixFilter,
  Container,
  Graphics,
  RenderTexture,
  Sprite,
  Text,
  TextStyle,
} from "pixi.js";
import "pixi.js/advanced-blend-modes";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { ColorAdjustments, Layer, LayerChanges } from "../types/project";
import { DEFAULT_COLOR_ADJUSTMENTS } from "../types/project";

const HANDLE_RADIUS = 6;
const ENDPOINT_RADIUS = 6;
const ROTATION_STEM = 28;
const MIN_SIZE = 0.01;   // normalized (1% of canvas)
const MIN_FONT = 4;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;
const SELECT_COLOR = 0x4f9eff;

// Normalized ↔ pixel coordinate helpers
// Normalized space: (0,0) = canvas center, canvas spans [-0.5, 0.5] × [-0.5, 0.5]
// Sizes: 1.0 = full canvas width/height
function toPixX(nx: number, cw: number) { return (nx + 0.5) * cw; }
function toPixY(ny: number, ch: number) { return (ny + 0.5) * ch; }
function toPixW(nw: number, cw: number) { return nw * cw; }
function toPixH(nh: number, ch: number) { return nh * ch; }

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

function computeResize(type: HandleType, dx: number, dy: number, start: Rect, locked = false): Rect {
  const left = type.includes("l");
  const right = type.includes("r");
  const top = type.includes("t");
  const bottom = type.includes("b");

  let { x, y, width, height } = start;

  if (left) { width = start.width - dx; x = start.x + dx; }
  else if (right) { width = start.width + dx; }

  if (top) { height = start.height - dy; y = start.y + dy; }
  else if (bottom) { height = start.height + dy; }

  if (locked && start.width > 0 && start.height > 0) {
    const ratio = start.width / start.height;
    const isH = left || right;
    const isV = top || bottom;
    if (isH && isV) {
      // corner: use whichever axis changed more proportionally
      const scale = Math.abs(width / start.width - 1) >= Math.abs(height / start.height - 1)
        ? width / start.width
        : height / start.height;
      const newW = start.width * scale;
      const newH = start.height * scale;
      if (left) x = start.x + start.width - newW;
      if (top) y = start.y + start.height - newH;
      width = newW;
      height = newH;
    } else if (isH) {
      height = width / ratio;
      if (top) y = start.y + start.height - height;
    } else if (isV) {
      width = height * ratio;
      if (left) x = start.x + start.width - width;
    }
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

/** Bounding box in normalized coords for box-style layers. */
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

// --- Color filter helpers ---

function isDefaultAdj(adj: ColorAdjustments): boolean {
  const d = DEFAULT_COLOR_ADJUSTMENTS;
  return (
    adj.brightness === d.brightness &&
    adj.contrast === d.contrast &&
    adj.saturation === d.saturation &&
    adj.hue === d.hue &&
    adj.temperature === d.temperature &&
    adj.shadows[0] === 0 && adj.shadows[1] === 0 &&
    adj.midtones[0] === 0 && adj.midtones[1] === 0 &&
    adj.highlights[0] === 0 && adj.highlights[1] === 0
  );
}

function wheelToRGB([wx, wy]: [number, number]): [number, number, number] {
  const dist = Math.sqrt(wx * wx + wy * wy);
  if (dist < 0.001) return [0, 0, 0];
  const a = Math.atan2(wy, wx);
  const r = ((Math.cos(a) + 1) / 2 - 0.5) * 2 * dist;
  const g = ((Math.cos(a - (2 * Math.PI) / 3) + 1) / 2 - 0.5) * 2 * dist;
  const b = ((Math.cos(a + (2 * Math.PI) / 3) + 1) / 2 - 0.5) * 2 * dist;
  return [r, g, b];
}

function buildColorFilter(adj: ColorAdjustments): ColorMatrixFilter | null {
  if (isDefaultAdj(adj)) return null;
  const f = new ColorMatrixFilter();
  f.brightness(adj.brightness, false);
  if (adj.contrast !== 1) f.contrast(adj.contrast - 1, true);
  if (adj.saturation !== 1) f.saturate(adj.saturation - 1, true);
  if (adj.hue !== 0) f.hue(adj.hue, true);

  const m = Array.from(f.matrix) as number[];

  const t = adj.temperature / 300;
  m[4] += t;
  m[14] -= t;

  const [sr, sg, sb] = wheelToRGB(adj.shadows);
  m[4] += sr * 0.25;
  m[9] += sg * 0.25;
  m[14] += sb * 0.25;

  const [hr, hg, hb] = wheelToRGB(adj.highlights);
  m[0] *= 1 + hr * 0.4;
  m[6] *= 1 + hg * 0.4;
  m[12] *= 1 + hb * 0.4;

  const [mr, mg, mb] = wheelToRGB(adj.midtones);
  m[4] += mr * 0.12;
  m[9] += mg * 0.12;
  m[14] += mb * 0.12;
  m[0] *= 1 + mr * 0.2;
  m[6] *= 1 + mg * 0.2;
  m[12] *= 1 + mb * 0.2;

  f.matrix = m as typeof f.matrix;
  return f;
}

export interface PixiCanvasHandle {
  exportImage(format: "png" | "jpeg", quality?: number): Promise<string>;
  mergeLayersToImage(layerIds: string[]): Promise<{ dataUrl: string; x: number; y: number; width: number; height: number } | null>;
  screenToNormalized(clientX: number, clientY: number): { x: number; y: number } | null;
}

interface PixiCanvasProps {
  canvasWidth: number;
  canvasHeight: number;
  layers: Layer[];
  selectedId: string | null;
  selectedIds: string[];
  globalAdjustments: ColorAdjustments;
  onSelect: (id: string | null) => void;
  onShiftSelect: (id: string) => void;
  onLayerChange: (id: string, changes: LayerChanges) => void;
  onMarqueeSelect: (normRect: { x1: number; y1: number; x2: number; y2: number }) => void;
  aspectLocked?: boolean;
}

interface LayerEntry {
  container: Container;
  content: Sprite | Graphics | Text;
  outline: Graphics;
  handles: Map<HandleType, Graphics>;
  anchorHandle?: Graphics;
  rotationHandle?: Graphics;
  endpointHandles: Graphics[];
  hitLine?: Graphics;
  cacheKey: string;
}

export const PixiCanvas = forwardRef<PixiCanvasHandle, PixiCanvasProps>(function PixiCanvas({
  canvasWidth,
  canvasHeight,
  layers,
  selectedId,
  selectedIds,
  globalAdjustments,
  onSelect,
  onShiftSelect,
  onLayerChange,
  onMarqueeSelect,
  aspectLocked = false,
}: PixiCanvasProps, ref) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const stageRef = useRef<Container | null>(null);
  const entriesRef = useRef<Map<string, LayerEntry>>(new Map());
  const layersRef = useRef<Layer[]>(layers);
  const onLayerChangeRef = useRef(onLayerChange);
  const onSelectRef = useRef(onSelect);
  const onShiftSelectRef = useRef(onShiftSelect);
  const onMarqueeSelectRef = useRef(onMarqueeSelect);
  const cwRef = useRef(canvasWidth);
  const chRef = useRef(canvasHeight);
  const aspectLockedRef = useRef(aspectLocked);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef(pan);
  const zoomRef = useRef(zoom);

  const [stageReady, setStageReady] = useState(false);
  const [marqueeBox, setMarqueeBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const isBackgroundClickRef = useRef(false);
  const suppressNextClickRef = useRef(false);
  const marqueeIdsRef = useRef<string[]>([]);
  const selectedIdRef = useRef<string | null>(selectedId);
  const selectedIdsRef = useRef<string[]>(selectedIds);
  const isBatchDraggingRef = useRef(false);
  selectedIdRef.current = selectedId;
  selectedIdsRef.current = selectedIds;

  layersRef.current = layers;
  onLayerChangeRef.current = onLayerChange;
  onSelectRef.current = onSelect;
  onShiftSelectRef.current = onShiftSelect;
  onMarqueeSelectRef.current = onMarqueeSelect;
  cwRef.current = canvasWidth;
  chRef.current = canvasHeight;
  aspectLockedRef.current = aspectLocked;
  panRef.current = pan;
  zoomRef.current = zoom;

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    function handleWheel(e: WheelEvent) {
      e.preventDefault();
      if (e.ctrlKey) {
        setZoom((z) => {
          const next = z * (e.deltaY < 0 ? 1.06 : 1 / 1.06);
          return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
        });
      } else if (e.shiftKey) {
        const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY;
        setPan((p) => ({ x: p.x - delta, y: p.y }));
      } else {
        setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
      }
    }

    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handleWheel);
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    function resetBackgroundClick() { isBackgroundClickRef.current = false; }
    viewport.addEventListener("pointerdown", resetBackgroundClick, { capture: true });

    function handlePointerDown(e: PointerEvent) {
      if (e.button === 1) {
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
          viewport!.style.cursor = "";
        }
        viewport!.style.cursor = "grabbing";
        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
      } else if (e.button === 0 && isBackgroundClickRef.current) {
        const startX = e.clientX;
        const startY = e.clientY;
        let marqueeing = false;

        function toNorm(clientX: number, clientY: number) {
          const vpRect = viewport!.getBoundingClientRect();
          const cx = vpRect.left + vpRect.width / 2;
          const cy = vpRect.top + vpRect.height / 2;
          return {
            x: (clientX - cx - panRef.current.x) / zoomRef.current / cwRef.current,
            y: (clientY - cy - panRef.current.y) / zoomRef.current / chRef.current,
          };
        }

        function applyMarqueeOutlines(normRect: { x1: number; y1: number; x2: number; y2: number }) {
          const newIds = layersRef.current.filter((l) => layerInRect(l, normRect)).map((l) => l.id);
          const prevIds = marqueeIdsRef.current;
          const cw = cwRef.current;
          const ch = chRef.current;
          for (const id of prevIds) {
            if (!newIds.includes(id) && id !== selectedIdRef.current) {
              entriesRef.current.get(id)?.outline.clear();
            }
          }
          for (const id of newIds) {
            if (!prevIds.includes(id) && id !== selectedIdRef.current) {
              const entry = entriesRef.current.get(id);
              const layer = layersRef.current.find((l) => l.id === id);
              if (entry && layer && layer.type !== "fill" &&
                  !(layer.type === "shape" && (layer.shapeKind === "line" || layer.shapeKind === "arrow"))) {
                const pw = layer.type === "text" ? entry.content.width : toPixW(boxRect(layer).width, cw);
                const ph = layer.type === "text" ? entry.content.height : toPixH(boxRect(layer).height, ch);
                entry.outline.clear();
                entry.outline.rect(0, 0, pw, ph).stroke({ width: 1, color: SELECT_COLOR });
              }
            }
          }
          marqueeIdsRef.current = newIds;
        }

        function clearMarqueeOutlines() {
          for (const id of marqueeIdsRef.current) {
            if (id !== selectedIdRef.current) {
              entriesRef.current.get(id)?.outline.clear();
            }
          }
          marqueeIdsRef.current = [];
        }

        function onMove(ev: PointerEvent) {
          if (!marqueeing) {
            if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
            marqueeing = true;
          }
          setMarqueeBox({
            left: Math.min(startX, ev.clientX),
            top: Math.min(startY, ev.clientY),
            width: Math.abs(ev.clientX - startX),
            height: Math.abs(ev.clientY - startY),
          });
          const n1 = toNorm(startX, startY);
          const n2 = toNorm(ev.clientX, ev.clientY);
          applyMarqueeOutlines({
            x1: Math.min(n1.x, n2.x), y1: Math.min(n1.y, n2.y),
            x2: Math.max(n1.x, n2.x), y2: Math.max(n1.y, n2.y),
          });
        }
        function onUp(ev: PointerEvent) {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          if (!marqueeing) return;
          clearMarqueeOutlines();
          setMarqueeBox(null);
          suppressNextClickRef.current = true;
          const n1 = toNorm(startX, startY);
          const n2 = toNorm(ev.clientX, ev.clientY);
          onMarqueeSelectRef.current({
            x1: Math.min(n1.x, n2.x),
            y1: Math.min(n1.y, n2.y),
            x2: Math.max(n1.x, n2.x),
            y2: Math.max(n1.y, n2.y),
          });
        }
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      }
    }

    viewport.addEventListener("pointerdown", handlePointerDown);
    return () => {
      viewport.removeEventListener("pointerdown", handlePointerDown);
      viewport.removeEventListener("pointerdown", resetBackgroundClick, { capture: true });
    };
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
        app.canvas.style.display = "block";
        appRef.current = app;
        const stage = new Container();
        stage.eventMode = "static";
        stage.hitArea = app.screen;
        stage.on("pointerdown", (e) => {
          if (e.button !== 0) return;
          isBackgroundClickRef.current = true;
          onSelectRef.current(null);
        });
        app.stage.addChild(stage);
        stageRef.current = stage;
        setStageReady(true);
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

  // Auto-fit zoom whenever a new canvas is loaded
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    if (vw === 0 || vh === 0) return;
    const fitZoom = Math.min(
      (vw * 0.85) / canvasWidth,
      (vh * 0.85) / canvasHeight
    );
    setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fitZoom)));
    setPan({ x: 0, y: 0 });
  }, [canvasWidth, canvasHeight]);

  // Global color grade applied to the whole stage
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const f = buildColorFilter(globalAdjustments);
    stage.filters = f ? [f] : [];
  }, [globalAdjustments, stageReady]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const cw = canvasWidth;
    const ch = canvasHeight;
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

          let anchorHandle: Graphics | undefined;
          let rotHandle: Graphics | undefined;
          if (interaction === "box" || interaction === "text") {
            container.eventMode = "static";
            container.cursor = "move";
            attachDragHandlers(container, layer.id, onSelectRef, onShiftSelectRef, onLayerChangeRef, layersRef, selectedIdsRef, cwRef, chRef, isBatchDraggingRef, entriesRef);
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
                attachResizeHandlers(handle, type, layer.id, onLayerChangeRef, layersRef, cwRef, chRef, aspectLockedRef);
              }
            }
            // anchor point handle — visual only, interaction handled by HTML overlay
            anchorHandle = new Graphics();
            anchorHandle.visible = false;
            container.addChild(anchorHandle);

            // rotation handle — stem + circle above top-center
            rotHandle = new Graphics();
            rotHandle.eventMode = "static";
            rotHandle.cursor = "crosshair";
            container.addChild(rotHandle);
            attachRotationHandlers(rotHandle, layer.id, onSelectRef, onLayerChangeRef, layersRef, cwRef, chRef);
          } else if (interaction === "endpoint") {
            hitLine = new Graphics();
            hitLine.eventMode = "static";
            hitLine.cursor = "move";
            container.addChild(hitLine);
            attachLineBodyDragHandlers(hitLine, layer.id, onSelectRef, onLayerChangeRef, layersRef, selectedIdsRef, cwRef, chRef, isBatchDraggingRef, entriesRef);
            for (const which of ["start", "end"] as const) {
              const handle = new Graphics();
              handle.eventMode = "static";
              handle.cursor = "move";
              container.addChild(handle);
              endpointHandles.push(handle);
              attachEndpointHandlers(handle, which, layer.id, onLayerChangeRef, layersRef, cwRef, chRef);
            }
          } else {
            container.eventMode = "none";
          }

          entry = { container, content, outline, handles, anchorHandle, rotationHandle: rotHandle, endpointHandles, hitLine, cacheKey };
          entries.set(layer.id, entry);
        }

        const selected = interaction !== "none" && layer.id === selectedId;

        entry.container.visible = layer.visible;
        entry.content.blendMode = layer.blendMode;

        const layerAdj = layer.colorAdjustments;
        const layerFilter = layerAdj ? buildColorFilter(layerAdj) : null;
        entry.content.filters = layerFilter ? [layerFilter] : [];

        // --- content geometry / styling ---
        // x, y = CENTER of layer in normalized space.
        // We set container.pivot to the layer's pixel center so position IS the center
        // and rotation/scale always happen around that point.
        if (layer.type === "image") {
          const pw = toPixW(layer.width, cw);
          const ph = toPixH(layer.height, ch);
          const sprite = entry.content as Sprite;
          sprite.width = pw;
          sprite.height = ph;
          // Apply flip by negating scale and offsetting position within the container
          sprite.scale.x = layer.flipX ? -Math.abs(sprite.scale.x) : Math.abs(sprite.scale.x);
          sprite.scale.y = layer.flipY ? -Math.abs(sprite.scale.y) : Math.abs(sprite.scale.y);
          sprite.x = layer.flipX ? pw : 0;
          sprite.y = layer.flipY ? ph : 0;
          const ax = layer.anchorX ?? 0;
          const ay = layer.anchorY ?? 0;
          entry.container.pivot.set(pw * (0.5 + ax), ph * (0.5 + ay));
          entry.container.position.set(toPixX(layer.x, cw), toPixY(layer.y, ch));
          entry.container.rotation = layer.rotation;
          entry.container.skew.set(layer.yaw ?? 0, layer.pitch ?? 0);
        } else if (layer.type === "fill") {
          entry.container.pivot.set(0, 0);
          entry.container.position.set(0, 0);
          entry.container.rotation = 0;
          const g = entry.content as Graphics;
          g.clear();
          g.rect(0, 0, cw, ch).fill(layer.color);
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
          // pivot at measured text center so rotation is around the text center
          entry.container.pivot.set(t.width / 2, t.height / 2);
          entry.container.position.set(toPixX(layer.x, cw), toPixY(layer.y, ch));
          entry.container.rotation = layer.rotation;
        } else if (layer.type === "shape") {
          const g = entry.content as Graphics;
          g.clear();
          if (layer.shapeKind === "rect" || layer.shapeKind === "ellipse") {
            const pw = toPixW(layer.width ?? 0, cw);
            const ph = toPixH(layer.height ?? 0, ch);
            entry.container.pivot.set(pw / 2, ph / 2);
            entry.container.position.set(toPixX(layer.x ?? 0, cw), toPixY(layer.y ?? 0, ch));
            entry.container.rotation = layer.rotation ?? 0;
            if (layer.shapeKind === "rect") g.rect(0, 0, pw, ph);
            else g.ellipse(pw / 2, ph / 2, pw / 2, ph / 2);
            if (layer.fill) g.fill(layer.fill);
            if (layer.strokeWidth > 0 && layer.strokeColor)
              g.stroke({ width: layer.strokeWidth, color: layer.strokeColor });
          } else {
            entry.container.pivot.set(0, 0);
            entry.container.position.set(0, 0);
            entry.container.rotation = 0;
            drawLine(g, layer, false, cw, ch);
            if (entry.hitLine) drawLine(entry.hitLine, layer, true, cw, ch);
          }
        }

        // --- selection outline + handles ---
        const pw = layer.type === "text" ? entry.content.width : toPixW(boxRect(layer).width, cw);
        const ph = layer.type === "text" ? entry.content.height : toPixH(boxRect(layer).height, ch);

        const showSelection = selected && !isBatchDraggingRef.current;

        entry.outline.clear();
        // image/shape box outlines are rendered as HTML overlays (not clipped by canvas)
        if (showSelection && interaction === "text") {
          entry.outline.rect(0, 0, pw, ph).stroke({ width: 1, color: SELECT_COLOR });
        }

        // edge / corner handles — HTML overlay handles box layers; PixiJS only for text
        for (const [type, handle] of entry.handles) {
          if (interaction === "box") {
            handle.clear();
            handle.visible = false;
          } else {
            const { x, y } = handlePosition(type, pw, ph);
            handle.clear();
            handle.circle(x, y, HANDLE_RADIUS).fill(0xffffff).stroke({ width: 1.5, color: SELECT_COLOR });
            handle.visible = showSelection;
          }
        }

        // anchor handle is rendered by the HTML overlay; keep PixiJS object hidden
        if (entry.anchorHandle) {
          entry.anchorHandle.visible = false;
        }

        // rotation handle — HTML overlay handles box layers; PixiJS only for text
        if (entry.rotationHandle) {
          if (interaction === "box") {
            entry.rotationHandle.clear();
            entry.rotationHandle.visible = false;
          } else {
            entry.rotationHandle.clear();
            if (showSelection) {
              const rx = pw / 2;
              entry.rotationHandle.moveTo(rx, 0).lineTo(rx, -ROTATION_STEM).stroke({ width: 1, color: SELECT_COLOR });
              entry.rotationHandle.circle(rx, -ROTATION_STEM, HANDLE_RADIUS).fill(0xffffff).stroke({ width: 1.5, color: SELECT_COLOR });
            }
            entry.rotationHandle.visible = showSelection;
          }
        }

        // --- endpoint handles (converted from normalized to pixels) ---
        if (layer.type === "shape" && interaction === "endpoint") {
          const pts = [
            { x: toPixX(layer.x1 ?? 0, cw), y: toPixY(layer.y1 ?? 0, ch) },
            { x: toPixX(layer.x2 ?? 0, cw), y: toPixY(layer.y2 ?? 0, ch) },
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
  }, [layers, selectedId, canvasWidth, canvasHeight, stageReady]);

  useImperativeHandle(ref, () => ({
    async exportImage(format: "png" | "jpeg", quality = 0.92): Promise<string> {
      const app = appRef.current;
      if (!app) throw new Error("Canvas not ready");

      // hide all selection UI before capturing
      const hidden: Graphics[] = [];
      for (const entry of entriesRef.current.values()) {
        const nodes = [
          entry.outline,
          ...Array.from(entry.handles.values()),
          entry.anchorHandle,
          entry.rotationHandle,
          ...entry.endpointHandles,
          entry.hitLine,
        ].filter((n): n is Graphics => !!n);
        for (const n of nodes) {
          if (n.visible) { n.visible = false; hidden.push(n); }
        }
      }

      // render a clean frame then extract
      app.renderer.render(app.stage);
      const c2d = app.renderer.extract.canvas(app.stage) as HTMLCanvasElement;
      const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";
      const dataUrl = c2d.toDataURL(mimeType, quality);

      // restore UI
      for (const n of hidden) n.visible = true;

      return dataUrl;
    },
    async mergeLayersToImage(layerIds: string[]): Promise<{ dataUrl: string; x: number; y: number; width: number; height: number } | null> {
      const app = appRef.current;
      const stage = stageRef.current;
      if (!app || !stage) return null;
      const cw = cwRef.current;
      const ch = chRef.current;

      // Compute AABB of merged layers in pixel space
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

      function expand(corners: [number, number][]) {
        for (const [x, y] of corners) {
          minX = Math.min(minX, x); minY = Math.min(minY, y);
          maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
      }

      function rotCorners(cx: number, cy: number, hw: number, hh: number, rot: number): [number, number][] {
        return ([[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]] as [number, number][]).map(
          ([x, y]) => [cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)] as [number, number]
        );
      }

      for (const id of layerIds) {
        const layer = layersRef.current.find((l) => l.id === id);
        if (!layer) continue;
        if (layer.type === "image") {
          expand(rotCorners(toPixX(layer.x, cw), toPixY(layer.y, ch), toPixW(layer.width, cw) / 2, toPixH(layer.height, ch) / 2, layer.rotation));
        } else if (layer.type === "text") {
          const entry = entriesRef.current.get(id);
          if (entry) expand(rotCorners(toPixX(layer.x, cw), toPixY(layer.y, ch), entry.content.width / 2, entry.content.height / 2, layer.rotation ?? 0));
        } else if (layer.type === "shape") {
          if (layer.shapeKind === "line" || layer.shapeKind === "arrow") {
            expand([[toPixX(layer.x1 ?? 0, cw), toPixY(layer.y1 ?? 0, ch)], [toPixX(layer.x2 ?? 0, cw), toPixY(layer.y2 ?? 0, ch)]]);
          } else {
            expand(rotCorners(toPixX(layer.x ?? 0, cw), toPixY(layer.y ?? 0, ch), toPixW(layer.width ?? 0, cw) / 2, toPixH(layer.height ?? 0, ch) / 2, layer.rotation ?? 0));
          }
        }
      }
      if (!isFinite(minX)) return null;

      const margin = 2;
      const px = Math.max(0, Math.floor(minX) - margin);
      const py = Math.max(0, Math.floor(minY) - margin);
      const bboxW = Math.min(cw, Math.ceil(maxX) + margin) - px;
      const bboxH = Math.min(ch, Math.ceil(maxY) + margin) - py;
      if (bboxW <= 0 || bboxH <= 0) return null;

      // Hide layers not being merged and their selection UI
      const hiddenContainers: Container[] = [];
      for (const [id, entry] of entriesRef.current) {
        if (!layerIds.includes(id) && entry.container.visible) {
          entry.container.visible = false;
          hiddenContainers.push(entry.container);
        }
      }
      const hiddenUI: Graphics[] = [];
      for (const id of layerIds) {
        const entry = entriesRef.current.get(id);
        if (!entry) continue;
        const nodes = [entry.outline, ...Array.from(entry.handles.values()), entry.anchorHandle, entry.rotationHandle, ...entry.endpointHandles, entry.hitLine]
          .filter((n): n is Graphics => !!n && n.visible);
        for (const n of nodes) { n.visible = false; hiddenUI.push(n); }
      }

      // Shift stage so the bounding box starts at (0,0), render into exact-size texture
      stage.position.set(-px, -py);
      const rt = RenderTexture.create({ width: bboxW, height: bboxH });
      app.renderer.render({ container: app.stage, target: rt });
      stage.position.set(0, 0);

      const c2d = app.renderer.extract.canvas(rt) as HTMLCanvasElement;
      const dataUrl = c2d.toDataURL("image/png");
      rt.destroy(true);

      // Restore hidden layers/UI
      for (const c of hiddenContainers) c.visible = true;
      for (const n of hiddenUI) n.visible = true;

      const normX = (px + bboxW / 2) / cw - 0.5;
      const normY = (py + bboxH / 2) / ch - 0.5;
      return { dataUrl, x: normX, y: normY, width: bboxW / cw, height: bboxH / ch };
    },
    screenToNormalized(clientX: number, clientY: number) {
      const viewport = viewportRef.current;
      if (!viewport) return null;
      const rect = viewport.getBoundingClientRect();
      const relX = clientX - (rect.left + rect.width / 2) - pan.x;
      const relY = clientY - (rect.top + rect.height / 2) - pan.y;
      return {
        x: relX / zoom / canvasWidth,
        y: relY / zoom / canvasHeight,
      };
    },
  }), [pan, zoom, canvasWidth, canvasHeight]);

  return (
    <div ref={viewportRef} className="pixi-canvas-viewport" onClick={(e) => {
      if (suppressNextClickRef.current) { suppressNextClickRef.current = false; return; }
      if (e.target === e.currentTarget) onSelectRef.current(null);
    }}>
      <div
        ref={hostRef}
        className="pixi-canvas-host"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        }}
      />
      {marqueeBox && (
        <div style={{
          position: "fixed",
          left: marqueeBox.left,
          top: marqueeBox.top,
          width: marqueeBox.width,
          height: marqueeBox.height,
          border: "1.5px solid #4f9eff",
          background: "rgba(79, 158, 255, 0.12)",
          pointerEvents: "none",
          zIndex: 9998,
        }} />
      )}
      {/* HTML selection outlines + handles — not clipped by PixiJS canvas */}
      {layers.map((layer) => {
        if (layer.type === "fill" || layer.type === "text") return null;
        if (layer.type === "shape" && (layer.shapeKind === "line" || layer.shapeKind === "arrow")) return null;
        const isSelected = selectedIds.includes(layer.id);

        const vpW = viewportRef.current?.clientWidth ?? 0;
        const vpH = viewportRef.current?.clientHeight ?? 0;
        const nx = layer.type === "image" ? layer.x : (layer.x ?? 0);
        const ny = layer.type === "image" ? layer.y : (layer.y ?? 0);
        const nw = layer.type === "image" ? layer.width : (layer.width ?? 0);
        const nh = layer.type === "image" ? layer.height : (layer.height ?? 0);
        const rot = layer.type === "image" ? layer.rotation : (layer.rotation ?? 0);

        const ax = layer.type === "image" ? (layer.anchorX ?? 0) : 0;
        const ay = layer.type === "image" ? (layer.anchorY ?? 0) : 0;
        const w = nw * canvasWidth * zoom;
        const h = nh * canvasHeight * zoom;
        const cx = vpW / 2 + pan.x + (nx - nw * ax) * canvasWidth * zoom;
        const cy = vpH / 2 + pan.y + (ny - nh * ay) * canvasHeight * zoom;
        const HR = Math.max(4, Math.min(HANDLE_RADIUS, Math.min(w, h) * 0.05));
        const showHandles = layer.id === selectedId;
        const layerId = layer.id;

        function makeResizeDown(type: HandleType) {
          return (e: React.PointerEvent) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            const startX = e.clientX;
            const startY = e.clientY;
            const snap = layersRef.current.find((l) => l.id === layerId);
            if (!snap) return;
            const cw = cwRef.current;
            const ch = chRef.current;
            const z = zoomRef.current;

            if (snap.type === "image") {
              // Anchor-based resize: anchor world position (snap.x, snap.y) stays fixed.
              const startW = snap.width;
              const startH = snap.height;
              const iax = snap.anchorX ?? 0;
              const iay = snap.anchorY ?? 0;
              const pivotX = snap.x;
              const pivotY = snap.y;
              const AR = startW / startH;

              const onMove = (ev: PointerEvent) => {
                const dx = (ev.clientX - startX) / (cw * z);
                const dy = (ev.clientY - startY) / (ch * z);

                let newW = startW;
                if (type === "l" || type === "tl" || type === "bl") {
                  const f = 0.5 + iax;
                  if (f > 0.001) newW = Math.max(0.01, startW - dx / f);
                } else if (type === "r" || type === "tr" || type === "br") {
                  const f = 0.5 - iax;
                  if (f > 0.001) newW = Math.max(0.01, startW + dx / f);
                }

                let newH = startH;
                if (type === "t" || type === "tl" || type === "tr") {
                  const f = 0.5 + iay;
                  if (f > 0.001) newH = Math.max(0.01, startH - dy / f);
                } else if (type === "b" || type === "bl" || type === "br") {
                  const f = 0.5 - iay;
                  if (f > 0.001) newH = Math.max(0.01, startH + dy / f);
                }

                // aspect lock only applies to corner handles; middle handles always move one axis
                const isCorner = type === "tl" || type === "tr" || type === "bl" || type === "br";
                if (aspectLockedRef.current && isCorner && startW > 0 && startH > 0) {
                  newH = Math.max(0.01, newW / AR);
                }

                onLayerChangeRef.current(layerId, { x: pivotX, y: pivotY, width: newW, height: newH });
              };
              const onUp = () => {
                document.removeEventListener("pointermove", onMove);
                document.removeEventListener("pointerup", onUp);
              };
              document.addEventListener("pointermove", onMove);
              document.addEventListener("pointerup", onUp);
            } else {
              // Shape layers: classic opposite-corner resize
              const start = boxRect(snap);
              const startTL = { x: start.x - start.width / 2, y: start.y - start.height / 2, width: start.width, height: start.height };
              const onMove = (ev: PointerEvent) => {
                const dx = (ev.clientX - startX) / (cw * z);
                const dy = (ev.clientY - startY) / (ch * z);
                const r = computeResize(type, dx, dy, startTL, aspectLockedRef.current);
                onLayerChangeRef.current(layerId, { x: r.x + r.width / 2, y: r.y + r.height / 2, width: r.width, height: r.height });
              };
              const onUp = () => {
                document.removeEventListener("pointermove", onMove);
                document.removeEventListener("pointerup", onUp);
              };
              document.addEventListener("pointermove", onMove);
              document.addEventListener("pointerup", onUp);
            }
          };
        }

        function makeMoveDown() {
          return (e: React.PointerEvent) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            if (e.shiftKey) onShiftSelectRef.current(layerId);
            else onSelectRef.current(layerId);
            const startX = e.clientX;
            const startY = e.clientY;
            const snap = layersRef.current.find((l) => l.id === layerId);
            if (!snap) return;
            const start = layerMoveStart(snap);
            if (!start) return;
            const cw = cwRef.current;
            const ch = chRef.current;
            const z = zoomRef.current;
            const onMove = (ev: PointerEvent) => {
              const dx = (ev.clientX - startX) / (cw * z);
              const dy = (ev.clientY - startY) / (ch * z);
              onLayerChangeRef.current(layerId, applyMoveDelta(start, dx, dy));
            };
            const onUp = () => {
              document.removeEventListener("pointermove", onMove);
              document.removeEventListener("pointerup", onUp);
            };
            document.addEventListener("pointermove", onMove);
            document.addEventListener("pointerup", onUp);
          };
        }

        function makeAnchorDown() {
          return (e: React.PointerEvent) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            const snap = layersRef.current.find((l) => l.id === layerId);
            if (!snap || snap.type !== "image") return;
            const startX = e.clientX;
            const startY = e.clientY;
            const startAnchorX = snap.anchorX ?? 0;
            const startAnchorY = snap.anchorY ?? 0;
            const startPosX = snap.x;
            const startPosY = snap.y;
            const snapW = snap.width;
            const snapH = snap.height;
            const snapRot = snap.rotation;
            const cw = cwRef.current;
            const ch = chRef.current;
            const z = zoomRef.current;
            const onMove = (ev: PointerEvent) => {
              // delta in normalized canvas units
              const dx = (ev.clientX - startX) / (cw * z);
              const dy = (ev.clientY - startY) / (ch * z);
              // rotate into layer-local space
              const cos = Math.cos(-snapRot);
              const sin = Math.sin(-snapRot);
              const dlx = dx * cos - dy * sin;
              const dly = dx * sin + dy * cos;
              const dax = dlx / snapW;
              const day = dly / snapH;
              onLayerChangeRef.current(layerId, {
                anchorX: startAnchorX + dax,
                anchorY: startAnchorY + day,
                x: startPosX + snapW * dax,
                y: startPosY + snapH * day,
              });
            };
            const onUp = () => {
              document.removeEventListener("pointermove", onMove);
              document.removeEventListener("pointerup", onUp);
            };
            document.addEventListener("pointermove", onMove);
            document.addEventListener("pointerup", onUp);
          };
        }

        function makeRotationDown() {
          return (e: React.PointerEvent) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            const vp = viewportRef.current!;
            const vpRect = vp.getBoundingClientRect();
            const cx_page = vpRect.left + vp.clientWidth / 2 + pan.x + nx * cwRef.current * zoomRef.current;
            const cy_page = vpRect.top + vp.clientHeight / 2 + pan.y + ny * chRef.current * zoomRef.current;
            const startAngle = Math.atan2(e.clientY - cy_page, e.clientX - cx_page);
            const startRotation = rot;
            const onMove = (ev: PointerEvent) => {
              const currentAngle = Math.atan2(ev.clientY - cy_page, ev.clientX - cx_page);
              onLayerChangeRef.current(layerId, { rotation: startRotation + (currentAngle - startAngle) });
            };
            const onUp = () => {
              document.removeEventListener("pointermove", onMove);
              document.removeEventListener("pointerup", onUp);
            };
            document.addEventListener("pointermove", onMove);
            document.addEventListener("pointerup", onUp);
          };
        }

        const resizeHandles: [HandleType, number, number, string][] = [
          ["tl", -w / 2 - HR, -h / 2 - HR, "nwse-resize"],
          ["t",  -HR,          -h / 2 - HR, "ns-resize"],
          ["tr",  w / 2 - HR, -h / 2 - HR, "nesw-resize"],
          ["l",  -w / 2 - HR, -HR,          "ew-resize"],
          ["r",   w / 2 - HR, -HR,          "ew-resize"],
          ["bl", -w / 2 - HR,  h / 2 - HR, "nesw-resize"],
          ["b",  -HR,           h / 2 - HR, "ns-resize"],
          ["br",  w / 2 - HR,  h / 2 - HR, "nwse-resize"],
        ];

        const handleBase: React.CSSProperties = {
          position: "absolute",
          width: HR * 2,
          height: HR * 2,
          borderRadius: "50%",
          background: "#ffffff",
          border: "1.5px solid #4f9eff",
          boxSizing: "border-box",
          pointerEvents: "all",
        };

        return (
          <React.Fragment key={layer.id}>
            {/* Transparent drag area — enables move/select when layer is outside canvas */}
            <div
              style={{
                position: "absolute",
                left: cx - w / 2, top: cy - h / 2,
                width: w, height: h,
                transform: `rotate(${rot}rad)`,
                transformOrigin: "center",
                cursor: "move",
                pointerEvents: "all",
              }}
              onPointerDown={makeMoveDown()}
            />
            {/* Outline — only when selected */}
            {isSelected && <div style={{
              position: "absolute",
              left: cx - w / 2, top: cy - h / 2,
              width: w, height: h,
              border: "1px solid #4f9eff",
              transform: `rotate(${rot}rad)`,
              transformOrigin: "center",
              pointerEvents: "none",
              boxSizing: "border-box",
            }} />}
            {/* Handles — centered at layer center, child coords are layer-local */}
            {showHandles && (
              <div style={{ position: "absolute", left: cx, top: cy, width: 0, height: 0, transform: `rotate(${rot}rad)` }}>
                {resizeHandles.map(([type, lx, ly, cursor]) => (
                  <div key={type} style={{ ...handleBase, left: lx, top: ly, cursor }} onPointerDown={makeResizeDown(type)} />
                ))}
                {/* Rotation stem */}
                <div style={{ position: "absolute", left: -0.5, top: -(h / 2 + ROTATION_STEM), width: 1, height: ROTATION_STEM, background: "#4f9eff", pointerEvents: "none" }} />
                {/* Rotation handle */}
                <div style={{ ...handleBase, left: -HR, top: -(h / 2 + ROTATION_STEM + HR * 2), cursor: "grab" }} onPointerDown={makeRotationDown()} />
              </div>
            )}
            {/* Anchor handle — same size as the resize handles */}
            {showHandles && layer.type === "image" && (() => {
              const HA = HR;
              const margin = Math.max(2, HA * 0.3);
              const apx = vpW / 2 + pan.x + nx * canvasWidth * zoom;
              const apy = vpH / 2 + pan.y + ny * canvasHeight * zoom;
              return (
                <div
                  style={{
                    position: "absolute",
                    left: apx - HA,
                    top: apy - HA,
                    width: HA * 2,
                    height: HA * 2,
                    borderRadius: "50%",
                    background: "#ffffff",
                    border: "1.5px solid #4f9eff",
                    boxSizing: "border-box",
                    cursor: "crosshair",
                    pointerEvents: "all",
                    overflow: "hidden",
                  }}
                  onPointerDown={makeAnchorDown()}
                >
                  <div style={{ position: "absolute", left: margin, right: margin, top: "calc(50% - 0.75px)", height: "1.5px", background: "#4f9eff", pointerEvents: "none" }} />
                  <div style={{ position: "absolute", top: margin, bottom: margin, left: "calc(50% - 0.75px)", width: "1.5px", background: "#4f9eff", pointerEvents: "none" }} />
                </div>
              );
            })()}
          </React.Fragment>
        );
      })}
    </div>
  );
});

type MoveStart =
  | { kind: "box"; x: number; y: number }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number };

function layerMoveStart(layer: Layer): MoveStart | null {
  if (layer.type === "fill") return null;
  if (layer.type === "shape" && (layer.shapeKind === "line" || layer.shapeKind === "arrow")) {
    return { kind: "line", x1: layer.x1 ?? 0, y1: layer.y1 ?? 0, x2: layer.x2 ?? 0, y2: layer.y2 ?? 0 };
  }
  return { kind: "box", x: layer.x ?? 0, y: layer.y ?? 0 };
}

function applyMoveDelta(start: MoveStart, dx: number, dy: number): LayerChanges {
  if (start.kind === "line") {
    return { x1: start.x1 + dx, y1: start.y1 + dy, x2: start.x2 + dx, y2: start.y2 + dy };
  }
  return { x: start.x + dx, y: start.y + dy };
}

function layerInRect(layer: Layer, rect: { x1: number; y1: number; x2: number; y2: number }): boolean {
  if (layer.type === "fill") return false;
  if (layer.type === "shape" && (layer.shapeKind === "line" || layer.shapeKind === "arrow")) {
    const inR = (x: number, y: number) => x >= rect.x1 && x <= rect.x2 && y >= rect.y1 && y <= rect.y2;
    return inR(layer.x1 ?? 0, layer.y1 ?? 0) || inR(layer.x2 ?? 0, layer.y2 ?? 0);
  }
  if (layer.type === "text") {
    return layer.x >= rect.x1 && layer.x <= rect.x2 && layer.y >= rect.y1 && layer.y <= rect.y2;
  }
  const x = layer.x ?? 0, y = layer.y ?? 0, w = layer.width ?? 0, h = layer.height ?? 0;
  return (x - w / 2) < rect.x2 && (x + w / 2) > rect.x1 && (y - h / 2) < rect.y2 && (y + h / 2) > rect.y1;
}

function drawLine(
  g: Graphics,
  layer: Extract<Layer, { type: "shape" }>,
  hit: boolean,
  cw: number,
  ch: number
) {
  const x1 = toPixX(layer.x1 ?? 0, cw);
  const y1 = toPixY(layer.y1 ?? 0, ch);
  const x2 = toPixX(layer.x2 ?? 0, cw);
  const y2 = toPixY(layer.y2 ?? 0, ch);
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

function restoreSelectionUI(
  layerId: string,
  layers: Layer[],
  entries: Map<string, LayerEntry>,
  cw: number,
  ch: number
) {
  const entry = entries.get(layerId);
  const layer = layers.find((l) => l.id === layerId);
  if (!entry || !layer) return;
  const interaction = interactionFor(layer);
  if (interaction !== "box" && interaction !== "text") return;
  const pw = layer.type === "text" ? entry.content.width : toPixW(boxRect(layer).width, cw);
  const ph = layer.type === "text" ? entry.content.height : toPixH(boxRect(layer).height, ch);
  entry.outline.clear();
  if (layer.type === "text") {
    entry.outline.rect(0, 0, pw, ph).stroke({ width: 1, color: SELECT_COLOR });
  }
  for (const [type, handle] of entry.handles) {
    if (interaction === "box") {
      handle.clear(); handle.visible = false;
    } else {
      const { x, y } = handlePosition(type, pw, ph);
      handle.clear();
      handle.circle(x, y, HANDLE_RADIUS).fill(0xffffff).stroke({ width: 1.5, color: SELECT_COLOR });
      handle.visible = true;
    }
  }
  if (entry.anchorHandle) {
    entry.anchorHandle.visible = false;
  }
  if (entry.rotationHandle) {
    if (interaction === "box") {
      entry.rotationHandle.clear(); entry.rotationHandle.visible = false;
    } else {
      const rx = pw / 2;
      entry.rotationHandle.clear();
      entry.rotationHandle.moveTo(rx, 0).lineTo(rx, -ROTATION_STEM).stroke({ width: 1, color: SELECT_COLOR });
      entry.rotationHandle.circle(rx, -ROTATION_STEM, HANDLE_RADIUS).fill(0xffffff).stroke({ width: 1.5, color: SELECT_COLOR });
      entry.rotationHandle.visible = true;
    }
  }
}


function attachDragHandlers(
  container: Container,
  layerId: string,
  onSelectRef: React.MutableRefObject<(id: string | null) => void>,
  onShiftSelectRef: React.MutableRefObject<(id: string) => void>,
  onLayerChangeRef: React.MutableRefObject<(id: string, changes: LayerChanges) => void>,
  layersRef: React.MutableRefObject<Layer[]>,
  selectedIdsRef: React.MutableRefObject<string[]>,
  cwRef: React.MutableRefObject<number>,
  chRef: React.MutableRefObject<number>,
  isBatchDraggingRef: React.MutableRefObject<boolean>,
  entriesRef: React.MutableRefObject<Map<string, LayerEntry>>
) {
  let dragging = false;
  let startPointer = { x: 0, y: 0 };
  let batchStarts: { id: string; start: MoveStart }[] = [];

  container.on("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (e.shiftKey) onShiftSelectRef.current(layerId);
    else onSelectRef.current(layerId);
    dragging = true;
    startPointer = { x: e.global.x, y: e.global.y };
    const selIds = selectedIdsRef.current;
    const idsToMove = selIds.includes(layerId) && selIds.length > 1 ? selIds : [layerId];
    batchStarts = idsToMove.flatMap((id) => {
      const layer = layersRef.current.find((l) => l.id === id);
      const start = layer ? layerMoveStart(layer) : null;
      return start ? [{ id, start }] : [];
    });
    if (batchStarts.length > 1) isBatchDraggingRef.current = true;
  });

  const move = (e: { global: { x: number; y: number } }) => {
    if (!dragging) return;
    const dx = (e.global.x - startPointer.x) / cwRef.current;
    const dy = (e.global.y - startPointer.y) / chRef.current;
    for (const { id, start } of batchStarts) {
      onLayerChangeRef.current(id, applyMoveDelta(start, dx, dy));
    }
  };

  function endDrag() {
    dragging = false;
    if (isBatchDraggingRef.current) {
      isBatchDraggingRef.current = false;
      restoreSelectionUI(layerId, layersRef.current, entriesRef.current, cwRef.current, chRef.current);
    }
  }

  container.on("globalpointermove", move);
  container.on("pointerup", endDrag);
  container.on("pointerupoutside", endDrag);
}

function attachResizeHandlers(
  handle: Graphics,
  handleType: HandleType,
  layerId: string,
  onLayerChangeRef: React.MutableRefObject<(id: string, changes: LayerChanges) => void>,
  layersRef: React.MutableRefObject<Layer[]>,
  cwRef: React.MutableRefObject<number>,
  chRef: React.MutableRefObject<number>,
  aspectLockedRef: React.MutableRefObject<boolean>
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
    const cw = cwRef.current;
    const ch = chRef.current;
    const dx = (e.global.x - startPointer.x) / cw;
    const dy = (e.global.y - startPointer.y) / ch;
    // start.x/y is the CENTER; computeResize expects top-left
    const startTL = {
      x: start.x - start.width / 2,
      y: start.y - start.height / 2,
      width: start.width,
      height: start.height,
    };
    const r = computeResize(handleType, dx, dy, startTL, aspectLockedRef.current);
    // convert result back to center
    onLayerChangeRef.current(layerId, {
      x: r.x + r.width / 2,
      y: r.y + r.height / 2,
      width: r.width,
      height: r.height,
    });
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
  layersRef: React.MutableRefObject<Layer[]>,
  selectedIdsRef: React.MutableRefObject<string[]>,
  cwRef: React.MutableRefObject<number>,
  chRef: React.MutableRefObject<number>,
  isBatchDraggingRef: React.MutableRefObject<boolean>,
  entriesRef: React.MutableRefObject<Map<string, LayerEntry>>
) {
  let dragging = false;
  let startPointer = { x: 0, y: 0 };
  let batchStarts: { id: string; start: MoveStart }[] = [];

  target.on("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onSelectRef.current(layerId);
    dragging = true;
    startPointer = { x: e.global.x, y: e.global.y };
    const selIds = selectedIdsRef.current;
    const idsToMove = selIds.includes(layerId) && selIds.length > 1 ? selIds : [layerId];
    batchStarts = idsToMove.flatMap((id) => {
      const layer = layersRef.current.find((l) => l.id === id);
      const start = layer ? layerMoveStart(layer) : null;
      return start ? [{ id, start }] : [];
    });
    if (batchStarts.length > 1) isBatchDraggingRef.current = true;
  });

  const move = (e: { global: { x: number; y: number } }) => {
    if (!dragging) return;
    const dx = (e.global.x - startPointer.x) / cwRef.current;
    const dy = (e.global.y - startPointer.y) / chRef.current;
    for (const { id, start } of batchStarts) {
      onLayerChangeRef.current(id, applyMoveDelta(start, dx, dy));
    }
  };

  function endDrag() {
    dragging = false;
    if (isBatchDraggingRef.current) {
      isBatchDraggingRef.current = false;
      restoreSelectionUI(layerId, layersRef.current, entriesRef.current, cwRef.current, chRef.current);
    }
  }

  target.on("globalpointermove", move);
  target.on("pointerup", endDrag);
  target.on("pointerupoutside", endDrag);
}

function attachEndpointHandlers(
  handle: Graphics,
  which: "start" | "end",
  layerId: string,
  onLayerChangeRef: React.MutableRefObject<(id: string, changes: LayerChanges) => void>,
  layersRef: React.MutableRefObject<Layer[]>,
  cwRef: React.MutableRefObject<number>,
  chRef: React.MutableRefObject<number>
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
    const cw = cwRef.current;
    const ch = chRef.current;
    const dx = (e.global.x - startPointer.x) / cw;
    const dy = (e.global.y - startPointer.y) / ch;
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

function attachRotationHandlers(
  handle: Graphics,
  layerId: string,
  onSelectRef: React.MutableRefObject<(id: string | null) => void>,
  onLayerChangeRef: React.MutableRefObject<(id: string, changes: LayerChanges) => void>,
  layersRef: React.MutableRefObject<Layer[]>,
  cwRef: React.MutableRefObject<number>,
  chRef: React.MutableRefObject<number>
) {
  let active = false;
  let startAngle = 0;
  let startRotation = 0;
  let center = { x: 0, y: 0 };

  handle.on("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onSelectRef.current(layerId);
    active = true;
    const layer = layersRef.current.find((l) => l.id === layerId);
    if (!layer) return;
    const cw = cwRef.current;
    const ch = chRef.current;
    // layer center in PixiJS canvas pixels
    const lx = (layer as { x?: number }).x ?? 0;
    const ly = (layer as { y?: number }).y ?? 0;
    center = { x: toPixX(lx, cw), y: toPixY(ly, ch) };
    startRotation = (layer as { rotation?: number }).rotation ?? 0;
    startAngle = Math.atan2(e.global.y - center.y, e.global.x - center.x);
  });

  const move = (e: { global: { x: number; y: number } }) => {
    if (!active) return;
    const currentAngle = Math.atan2(e.global.y - center.y, e.global.x - center.x);
    onLayerChangeRef.current(layerId, { rotation: startRotation + (currentAngle - startAngle) });
  };

  handle.on("globalpointermove", move);
  handle.on("pointerup", () => (active = false));
  handle.on("pointerupoutside", () => (active = false));
}
