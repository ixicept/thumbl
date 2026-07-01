import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  Application,
  Assets,
  ColorMatrixFilter,
  Container,
  Graphics,
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
}

interface PixiCanvasProps {
  canvasWidth: number;
  canvasHeight: number;
  layers: Layer[];
  selectedId: string | null;
  globalAdjustments: ColorAdjustments;
  onSelect: (id: string | null) => void;
  onLayerChange: (id: string, changes: LayerChanges) => void;
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
  globalAdjustments,
  onSelect,
  onLayerChange,
}: PixiCanvasProps, ref) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const stageRef = useRef<Container | null>(null);
  const entriesRef = useRef<Map<string, LayerEntry>>(new Map());
  const layersRef = useRef<Layer[]>(layers);
  const onLayerChangeRef = useRef(onLayerChange);
  const onSelectRef = useRef(onSelect);
  const cwRef = useRef(canvasWidth);
  const chRef = useRef(canvasHeight);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [stageReady, setStageReady] = useState(false);

  layersRef.current = layers;
  onLayerChangeRef.current = onLayerChange;
  onSelectRef.current = onSelect;
  cwRef.current = canvasWidth;
  chRef.current = canvasHeight;

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
        viewport!.style.cursor = "";
        setIsPanning(false);
      }

      viewport!.style.cursor = "grabbing";
      setIsPanning(true);
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    }

    viewport.addEventListener("pointerdown", handlePointerDown);
    return () => viewport.removeEventListener("pointerdown", handlePointerDown);
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
            attachDragHandlers(container, layer.id, onSelectRef, onLayerChangeRef, layersRef, cwRef, chRef);
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
                attachResizeHandlers(handle, type, layer.id, onLayerChangeRef, layersRef, cwRef, chRef);
              }
            }
            // center anchor handle — drag moves the layer, same as body
            anchorHandle = new Graphics();
            anchorHandle.eventMode = "static";
            anchorHandle.cursor = "move";
            container.addChild(anchorHandle);
            attachDragHandlers(anchorHandle, layer.id, onSelectRef, onLayerChangeRef, layersRef, cwRef, chRef);

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
            attachLineBodyDragHandlers(hitLine, layer.id, onSelectRef, onLayerChangeRef, layersRef, cwRef, chRef);
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
          (entry.content as Sprite).width = pw;
          (entry.content as Sprite).height = ph;
          entry.container.pivot.set(pw / 2, ph / 2);
          entry.container.position.set(toPixX(layer.x, cw), toPixY(layer.y, ch));
          entry.container.rotation = layer.rotation;
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

        entry.outline.clear();
        if (selected && (interaction === "box" || interaction === "text")) {
          entry.outline.rect(0, 0, pw, ph).stroke({ width: 1, color: SELECT_COLOR });
        }

        // edge / corner handles — white circles with blue ring
        for (const [type, handle] of entry.handles) {
          const { x, y } = handlePosition(type, pw, ph);
          handle.clear();
          handle
            .circle(x, y, HANDLE_RADIUS)
            .fill(0xffffff)
            .stroke({ width: 1.5, color: SELECT_COLOR });
          handle.visible = selected;
        }

        // anchor point handle at center
        if (entry.anchorHandle) {
          const cx = pw / 2;
          const cy = ph / 2;
          entry.anchorHandle.clear();
          entry.anchorHandle
            .circle(cx, cy, HANDLE_RADIUS)
            .fill(0xffffff)
            .stroke({ width: 1.5, color: SELECT_COLOR });
          entry.anchorHandle.circle(cx, cy, 2.5).fill(SELECT_COLOR);
          entry.anchorHandle.visible = selected;
        }

        // rotation handle — stem line + circle above top-center
        if (entry.rotationHandle) {
          entry.rotationHandle.clear();
          if (selected) {
            const rx = pw / 2;
            entry.rotationHandle
              .moveTo(rx, 0)
              .lineTo(rx, -ROTATION_STEM)
              .stroke({ width: 1, color: SELECT_COLOR });
            entry.rotationHandle
              .circle(rx, -ROTATION_STEM, HANDLE_RADIUS)
              .fill(0xffffff)
              .stroke({ width: 1.5, color: SELECT_COLOR });
          }
          entry.rotationHandle.visible = selected;
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
  }), []);

  return (
    <div ref={viewportRef} className="pixi-canvas-viewport">
      <div
        ref={hostRef}
        className="pixi-canvas-host"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transition: isPanning ? "none" : "transform 0.1s ease-out",
        }}
      />
    </div>
  );
});

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

function attachDragHandlers(
  container: Container,
  layerId: string,
  onSelectRef: React.MutableRefObject<(id: string | null) => void>,
  onLayerChangeRef: React.MutableRefObject<(id: string, changes: LayerChanges) => void>,
  layersRef: React.MutableRefObject<Layer[]>,
  cwRef: React.MutableRefObject<number>,
  chRef: React.MutableRefObject<number>
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
    const cw = cwRef.current;
    const ch = chRef.current;
    onLayerChangeRef.current(layerId, {
      x: startPos.x + dx / cw,
      y: startPos.y + dy / ch,
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
  onLayerChangeRef: React.MutableRefObject<(id: string, changes: LayerChanges) => void>,
  layersRef: React.MutableRefObject<Layer[]>,
  cwRef: React.MutableRefObject<number>,
  chRef: React.MutableRefObject<number>
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
    const r = computeResize(handleType, dx, dy, startTL);
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
  cwRef: React.MutableRefObject<number>,
  chRef: React.MutableRefObject<number>
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
    const cw = cwRef.current;
    const ch = chRef.current;
    const dx = (e.global.x - startPointer.x) / cw;
    const dy = (e.global.y - startPointer.y) / ch;
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
