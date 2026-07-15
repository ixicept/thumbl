import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  ColorAdjustments,
  ImageLayer,
  Layer,
  LayerChanges,
  TextDropShadow,
  TextLayer,
  TextStroke,
} from "../types/project";
import { DEFAULT_COLOR_ADJUSTMENTS } from "../types/project";
import { variantsFor, type FontFamily } from "../fonts";
import "./PropertiesPanel.css";

interface PropertiesPanelProps {
  layer: Layer | null;
  selectedCount: number;
  fonts: FontFamily[];
  canvasWidth: number;
  canvasHeight: number;
  globalAdjustments: ColorAdjustments;
  aspectLocked: boolean;
  onAspectLockedChange: (v: boolean) => void;
  onChange: (id: string, changes: LayerChanges) => void;
  onGlobalChange: (adj: ColorAdjustments) => void;
}

function tabsFor(layer: Layer): string[] {
  switch (layer.type) {
    case "text":
      return ["Text", "Color", "Transform"];
    case "shape":
      return ["Shape", "Color", "Transform"];
    case "image":
      return ["Image", "Color", "Transform"];
    case "fill":
      return ["Fill", "Color"];
  }
}

export function PropertiesPanel({
  layer,
  selectedCount,
  fonts,
  canvasWidth,
  canvasHeight,
  globalAdjustments,
  aspectLocked,
  onAspectLockedChange,
  onChange,
  onGlobalChange,
}: PropertiesPanelProps) {
  const [activeTab, setActiveTab] = useState("Color");
  const set = layer ? (changes: LayerChanges) => onChange(layer.id, changes) : null;

  if (!layer) {
    if (selectedCount > 1) {
      return (
        <div className="properties-panel-content">
          <div className="prop-panel-title">{selectedCount} layers selected</div>
        </div>
      );
    }
    return (
      <div className="properties-panel-content">
        <div className="prop-panel-title">Global Color</div>
        <ColorProps adj={globalAdjustments} onChange={onGlobalChange} />
      </div>
    );
  }

  const tabs = tabsFor(layer);
  const tab = tabs.includes(activeTab) ? activeTab : tabs[0];

  return (
    <div className="properties-panel-content">
      <div className="prop-tabs">
        {tabs.map((t) => (
          <button
            key={t}
            className={`prop-tab${t === tab ? " prop-tab-active" : ""}`}
            onClick={() => setActiveTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="prop-tab-body">
        {tab === "Image" && layer.type === "image" && (
          <ImageToolsProps layer={layer} set={set!} />
        )}
        {tab === "Text" && layer.type === "text" && (
          <TextProps layer={layer} fonts={fonts} set={set!} />
        )}
        {tab === "Shape" && layer.type === "shape" && (
          <ShapeStyleProps layer={layer} set={set!} />
        )}
        {tab === "Fill" && layer.type === "fill" && (
          <ColorRow label="Color" value={layer.color} onChange={(v) => set!({ color: v })} />
        )}
        {tab === "Color" && (
          <ColorProps
            adj={layer.colorAdjustments ?? { ...DEFAULT_COLOR_ADJUSTMENTS }}
            onChange={(adj) => set!({ colorAdjustments: adj })}
          />
        )}
        {tab === "Transform" && (
          <TransformProps layer={layer} canvasWidth={canvasWidth} canvasHeight={canvasHeight} set={set!} aspectLocked={aspectLocked} onAspectLockedChange={onAspectLockedChange} />
        )}
      </div>
    </div>
  );
}

// --- Row primitives ---

function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="prop-row-item">
      <span className="prop-row-label">{label}</span>
      <div className="prop-row-control">{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="prop-section">
      <button type="button" className="prop-section-header" onClick={() => setOpen((o) => !o)}>
        <span className={`prop-chevron${open ? "" : " prop-chevron-collapsed"}`}>⌄</span>
        {title}
      </button>
      {open && <div className="prop-section-body">{children}</div>}
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <PropRow label={label}>
      <input
        type="range"
        className="prop-slider"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <input
        type="number"
        className="prop-slider-number"
        value={value}
        step={step}
        onChange={(e) => onChange(num(e.target.value))}
      />
    </PropRow>
  );
}

function EyedropperIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M19.5 4.5 L21 6 L17 10 L15.5 8.5 Z" />
      <path d="M15.5 8.5 L5 19 L3 21 L5 19 L3 21" />
      <path d="M13.5 6.5 L17.5 10.5 L6 22 L2 22 L2 18 Z" />
    </svg>
  );
}

const SUPPORTS_EYEDROPPER =
  typeof window !== "undefined" && "EyeDropper" in window;

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  async function pick() {
    try {
      type EyeDropperResult = { sRGBHex: string };
      type EyeDropperCtor = new () => { open: () => Promise<EyeDropperResult> };
      const EyeDropper = (window as unknown as { EyeDropper: EyeDropperCtor }).EyeDropper;
      const result = await new EyeDropper().open();
      onChange(result.sRGBHex);
    } catch {
      // user cancelled
    }
  }

  return (
    <PropRow label={label}>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      {SUPPORTS_EYEDROPPER && (
        <button type="button" className="prop-eyedropper" title="Pick color from screen" onClick={pick}>
          <EyedropperIcon />
        </button>
      )}
    </PropRow>
  );
}

function num(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

const radToDeg = (r: number) => Math.round((r * 180) / Math.PI);
const degToRad = (d: number) => (d * Math.PI) / 180;

// --- Color tab ---

const WHEEL_SIZE = 72;
const WHEEL_R = WHEEL_SIZE / 2 - 1;

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function ColorWheel({
  label,
  value,
  onChange,
}: {
  label: string;
  value: [number, number];
  onChange: (v: [number, number]) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const size = WHEEL_SIZE;
    const cx = size / 2;
    const cy = size / 2;
    const imageData = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x - cx) / WHEEL_R;
        const dy = (y - cy) / WHEEL_R;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const i = (y * size + x) * 4;
        if (dist > 1) {
          imageData.data[i + 3] = 0;
          continue;
        }
        const hue = ((Math.atan2(dy, dx) / (Math.PI * 2)) * 360 + 360) % 360;
        const [r, g, b] = hslToRgb(hue, dist, 0.5);
        imageData.data[i] = r;
        imageData.data[i + 1] = g;
        imageData.data[i + 2] = b;
        imageData.data[i + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }, []);

  const cx = WHEEL_SIZE / 2;
  const cy = WHEEL_SIZE / 2;
  const dotX = cx + value[0] * WHEEL_R;
  const dotY = cy + value[1] * WHEEL_R;

  function pick(clientX: number, clientY: number, rect: DOMRect) {
    const x = clientX - rect.left - cx;
    const y = clientY - rect.top - cy;
    const dist = Math.sqrt(x * x + y * y);
    const clamped = Math.min(dist, WHEEL_R);
    const angle = Math.atan2(y, x);
    onChange([
      (Math.cos(angle) * clamped) / WHEEL_R,
      (Math.sin(angle) * clamped) / WHEEL_R,
    ]);
  }

  return (
    <div className="color-wheel-item">
      <div
        className="color-wheel-wrap"
        onMouseDown={(e) => {
          dragging.current = true;
          pick(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
        }}
        onMouseMove={(e) => {
          if (!dragging.current) return;
          pick(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
        }}
        onMouseUp={() => { dragging.current = false; }}
        onMouseLeave={() => { dragging.current = false; }}
      >
        <canvas ref={canvasRef} width={WHEEL_SIZE} height={WHEEL_SIZE} />
        <div className="color-wheel-dot" style={{ left: dotX - 4, top: dotY - 4 }} />
      </div>
      <button
        type="button"
        className="color-wheel-reset"
        title="Reset"
        onClick={() => onChange([0, 0])}
      >
        ↺
      </button>
      <span className="color-wheel-label">{label}</span>
    </div>
  );
}

function ColorProps({
  adj,
  onChange,
}: {
  adj: ColorAdjustments;
  onChange: (adj: ColorAdjustments) => void;
}) {
  const set = (partial: Partial<ColorAdjustments>) => onChange({ ...adj, ...partial });

  return (
    <>
      <Section title="Basic">
        <SliderRow label="Brightness" value={adj.brightness} min={0} max={2} step={0.01} onChange={(v) => set({ brightness: v })} />
        <SliderRow label="Contrast" value={adj.contrast} min={0} max={2} step={0.01} onChange={(v) => set({ contrast: v })} />
        <SliderRow label="Saturation" value={adj.saturation} min={0} max={2} step={0.01} onChange={(v) => set({ saturation: v })} />
        <SliderRow label="Hue" value={adj.hue} min={-180} max={180} onChange={(v) => set({ hue: v })} />
        <SliderRow label="Temperature" value={adj.temperature} min={-100} max={100} onChange={(v) => set({ temperature: v })} />
      </Section>
      <Section title="Color Wheels">
        <div className="color-wheels-row">
          <ColorWheel label="Shadows" value={adj.shadows} onChange={(v) => set({ shadows: v })} />
          <ColorWheel label="Midtones" value={adj.midtones} onChange={(v) => set({ midtones: v })} />
          <ColorWheel label="Highlights" value={adj.highlights} onChange={(v) => set({ highlights: v })} />
        </div>
      </Section>
    </>
  );
}

// --- Transform tab ---

const td = (v: number) => parseFloat((v * 100).toFixed(1));
const fd = (v: number) => v / 100;
const rnd3 = (v: number) => parseFloat(v.toFixed(3));

function TRow({
  label,
  children,
  onReset,
}: {
  label: string;
  children: React.ReactNode;
  onReset: () => void;
}) {
  return (
    <div className="trow">
      <span className="trow-label">{label}</span>
      <div className="trow-controls">{children}</div>
      <button className="trow-reset" title="Reset" onClick={onReset}>↺</button>
    </div>
  );
}

function TNum({
  value,
  min = -100,
  max = 100,
  step = 0.1,
  onChange,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="number"
      className="trow-num"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(num(e.target.value))}
    />
  );
}

function TransformProps({
  layer,
  set,
  aspectLocked: locked,
  onAspectLockedChange: setLocked,
}: {
  layer: Layer;
  canvasWidth: number;
  canvasHeight: number;
  set: (c: LayerChanges) => void;
  aspectLocked: boolean;
  onAspectLockedChange: (v: boolean) => void;
}) {

  if (layer.type === "fill") {
    return <p className="prop-note">Background fills the whole canvas.</p>;
  }

  const isLine = layer.type === "shape" && (layer.shapeKind === "line" || layer.shapeKind === "arrow");
  const hasSize = (layer.type === "image" || layer.type === "shape") && !isLine;
  const hasFlip = layer.type === "image";

  const x = (layer as { x?: number }).x ?? 0;
  const y = (layer as { y?: number }).y ?? 0;
  const rotation = (layer as { rotation?: number }).rotation ?? 0;
  const width = (layer as { width?: number }).width ?? 0;
  const height = (layer as { height?: number }).height ?? 0;
  const flipX = (layer as { flipX?: boolean }).flipX ?? false;
  const flipY = (layer as { flipY?: boolean }).flipY ?? false;
  const hasAnchorSkew = layer.type === "image";
  const anchorX = (layer as { anchorX?: number }).anchorX ?? 0;
  const anchorY = (layer as { anchorY?: number }).anchorY ?? 0;
  const pitch = (layer as { pitch?: number }).pitch ?? 0;
  const yaw = (layer as { yaw?: number }).yaw ?? 0;

  function setW(dv: number) {
    const w = fd(dv);
    if (locked && width > 0) set({ width: w, height: w * (height / width) });
    else set({ width: w });
  }
  function setH(dv: number) {
    const h = fd(dv);
    if (locked && height > 0) set({ height: h, width: h * (width / height) });
    else set({ height: h });
  }

  const resetAll = () => set({ x: 0, y: 0, ...(hasSize ? { width: 0.5, height: 0.5 } : {}), rotation: 0, ...(hasFlip ? { flipX: false, flipY: false } : {}), ...(hasAnchorSkew ? { anchorX: 0, anchorY: 0, pitch: 0, yaw: 0 } : {}) });

  return (
    <div className="transform-panel">
      <div className="transform-header">
        <span className="transform-title">Transform</span>
        <button className="trow-reset" title="Reset all" onClick={resetAll}>↺</button>
      </div>

      {isLine ? (
        <>
          <TRow label="Point 1" onReset={() => set({ x1: 0, y1: 0 })}>
            <span className="trow-axis">X</span>
            <TNum value={td((layer as { x1?: number }).x1 ?? 0)} onChange={(v) => set({ x1: fd(v) })} />
            <span />
            <span className="trow-axis">Y</span>
            <TNum value={td((layer as { y1?: number }).y1 ?? 0)} onChange={(v) => set({ y1: fd(v) })} />
          </TRow>
          <TRow label="Point 2" onReset={() => set({ x2: 0, y2: 0 })}>
            <span className="trow-axis">X</span>
            <TNum value={td((layer as { x2?: number }).x2 ?? 0)} onChange={(v) => set({ x2: fd(v) })} />
            <span />
            <span className="trow-axis">Y</span>
            <TNum value={td((layer as { y2?: number }).y2 ?? 0)} onChange={(v) => set({ y2: fd(v) })} />
          </TRow>
        </>
      ) : (
        <>
          {hasSize && (
            <TRow label="Size" onReset={() => set({ width: 0.5, height: 0.5 })}>
              <span className="trow-axis">W</span>
              <TNum value={td(width)} min={0.1} max={100} onChange={setW} />
              <button
                className={`trow-lock${locked ? " trow-lock-active" : ""}`}
                title={locked ? "Unlock ratio" : "Lock ratio"}
                onClick={() => setLocked(!locked)}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" opacity={locked ? 1 : 0.55}>
                  <path d="M4.715 6.542 3.343 7.914a3 3 0 1 0 4.243 4.243l1.828-1.829A3 3 0 0 0 8.586 5.5L8 6.086a1.002 1.002 0 0 0-.154.199 2 2 0 0 1 .861 3.337L6.88 11.45a2 2 0 1 1-2.83-2.83l.793-.792a4.018 4.018 0 0 1-.128-1.287z"/>
                  <path d="M6.586 4.672A3 3 0 0 0 7.414 9.5l.775-.776a2 2 0 0 1-.896-3.346L9.12 3.55a2 2 0 1 1 2.83 2.83l-.793.792c.112.42.155.855.128 1.287l1.372-1.372a3 3 0 1 0-4.243-4.243z"/>
                </svg>
              </button>
              <span className="trow-axis">H</span>
              <TNum value={td(height)} min={0.1} max={100} onChange={setH} />
            </TRow>
          )}

          <TRow label="Position" onReset={() => set({ x: 0, y: 0 })}>
            <span className="trow-axis">X</span>
            <TNum value={td(x)} onChange={(v) => set({ x: fd(v) })} />
            <span />
            <span className="trow-axis">Y</span>
            <TNum value={td(y)} onChange={(v) => set({ y: fd(v) })} />
          </TRow>

          <TRow label="Rotation" onReset={() => set({ rotation: 0 })}>
            <input
              type="range"
              className="trow-slider"
              style={{ gridColumn: "1 / 5" }}
              min={-360}
              max={360}
              value={radToDeg(rotation)}
              onChange={(e) => set({ rotation: degToRad(num(e.target.value)) })}
            />
            <TNum value={radToDeg(rotation)} min={-360} max={360} step={1} onChange={(v) => set({ rotation: degToRad(v) })} />
          </TRow>

          {hasAnchorSkew && (
            <>
              <TRow label="Anchor" onReset={() => set({ anchorX: 0, anchorY: 0, x: x - width * anchorX, y: y - height * anchorY })}>
                <span className="trow-axis">X</span>
                <TNum value={td(anchorX)} min={-50} max={50} onChange={(v) => {
                  const dax = fd(v) - anchorX;
                  set({ anchorX: fd(v), x: x + width * dax });
                }} />
                <span />
                <span className="trow-axis">Y</span>
                <TNum value={td(anchorY)} min={-50} max={50} onChange={(v) => {
                  const day = fd(v) - anchorY;
                  set({ anchorY: fd(v), y: y + height * day });
                }} />
              </TRow>
              <TRow label="Pitch" onReset={() => set({ pitch: 0 })}>
                <input
                  type="range"
                  className="trow-slider"
                  style={{ gridColumn: "1 / 5" }}
                  min={-1.5}
                  max={1.5}
                  step={0.001}
                  value={pitch}
                  onChange={(e) => set({ pitch: parseFloat(e.target.value) })}
                />
                <TNum value={rnd3(pitch)} min={-1.5} max={1.5} step={0.001} onChange={(v) => set({ pitch: v })} />
              </TRow>
              <TRow label="Yaw" onReset={() => set({ yaw: 0 })}>
                <input
                  type="range"
                  className="trow-slider"
                  style={{ gridColumn: "1 / 5" }}
                  min={-1.5}
                  max={1.5}
                  step={0.001}
                  value={yaw}
                  onChange={(e) => set({ yaw: parseFloat(e.target.value) })}
                />
                <TNum value={rnd3(yaw)} min={-1.5} max={1.5} step={0.001} onChange={(v) => set({ yaw: v })} />
              </TRow>
            </>
          )}

          {hasFlip && (
            <TRow label="Flip" onReset={() => set({ flipX: false, flipY: false })}>
              <div style={{ gridColumn: "1 / 6", display: "flex", gap: 6 }}>
                <button
                  className={`trow-flip-btn${flipX ? " trow-flip-active" : ""}`}
                  title="Flip horizontal"
                  onClick={() => set({ flipX: !flipX })}
                >
                  ↔
                </button>
                <button
                  className={`trow-flip-btn${flipY ? " trow-flip-active" : ""}`}
                  title="Flip vertical"
                  onClick={() => set({ flipY: !flipY })}
                >
                  ↕
                </button>
              </div>
            </TRow>
          )}
        </>
      )}
    </div>
  );
}

// --- Image tab ---

const API_KEY_STORAGE = "thumbl_rmbg_api_key";

type LocalPhase = "checking" | "not_downloaded" | "downloading" | "ready" | "processing" | "error";
type ApiPhase = "idle" | "processing" | "error";

function ImageToolsProps({
  layer,
  set,
}: {
  layer: ImageLayer;
  set: (c: LayerChanges) => void;
}) {
  const [localPhase, setLocalPhase] = useState<LocalPhase>("checking");
  const [localErr, setLocalErr] = useState("");
  const [apiPhase, setApiPhase] = useState<ApiPhase>("idle");
  const [apiErr, setApiErr] = useState("");
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(API_KEY_STORAGE) ?? "");

  useEffect(() => {
    invoke<boolean>("get_bg_model_status")
      .then((ready) => setLocalPhase(ready ? "ready" : "not_downloaded"))
      .catch(() => setLocalPhase("not_downloaded"));
  }, []);

  async function handleDownload() {
    setLocalPhase("downloading");
    try {
      await invoke("download_bg_model");
      setLocalPhase("ready");
    } catch (e) {
      setLocalErr(String(e));
      setLocalPhase("error");
    }
  }

  async function handleLocalRemove() {
    setLocalPhase("processing");
    try {
      const newPath = await invoke<string>("remove_background_local", { srcPath: layer.src });
      set({ src: newPath });
      setLocalPhase("ready");
    } catch (e) {
      setLocalErr(String(e));
      setLocalPhase("error");
    }
  }

  function saveKey(k: string) {
    setApiKey(k);
    localStorage.setItem(API_KEY_STORAGE, k);
  }

  async function handleApiRemove() {
    if (!apiKey.trim()) {
      setApiErr("Enter a remove.bg API key first.");
      setApiPhase("error");
      return;
    }
    setApiPhase("processing");
    try {
      const newPath = await invoke<string>("remove_background_api", {
        srcPath: layer.src,
        apiKey: apiKey.trim(),
      });
      set({ src: newPath });
      setApiPhase("idle");
    } catch (e) {
      setApiErr(String(e));
      setApiPhase("error");
    }
  }

  return (
    <>
      <Section title="Local AI (Free)">
        <div className="prop-bg-remove">
          {localPhase === "checking" && (
            <p className="prop-note">Checking model...</p>
          )}
          {localPhase === "not_downloaded" && (
            <>
              <p className="prop-note">u2net model not downloaded yet (~176 MB).</p>
              <button className="prop-action-btn" onClick={() => void handleDownload()}>
                Download Model
              </button>
            </>
          )}
          {localPhase === "downloading" && (
            <p className="prop-note">Downloading model (~176 MB)...</p>
          )}
          {localPhase === "ready" && (
            <button className="prop-action-btn" onClick={() => void handleLocalRemove()}>
              Remove Background (Local)
            </button>
          )}
          {localPhase === "processing" && (
            <p className="prop-note">Processing... (may take a few seconds)</p>
          )}
          {localPhase === "error" && (
            <>
              <p className="prop-note prop-error">{localErr}</p>
              <button className="prop-action-btn" onClick={() => setLocalPhase("not_downloaded")}>
                Retry
              </button>
            </>
          )}
        </div>
      </Section>
      <Section title="remove.bg API">
        <div className="prop-bg-remove">
          <PropRow label="API Key">
            <input
              type="password"
              className="prop-api-key-input"
              placeholder="remove.bg key"
              value={apiKey}
              onChange={(e) => saveKey(e.target.value)}
            />
          </PropRow>
          <p className="prop-note">
            Free at{" "}
            <a className="prop-link" href="https://www.remove.bg/api" target="_blank" rel="noreferrer">
              remove.bg
            </a>{" "}
            (50 credits/month)
          </p>
          {apiPhase === "processing" ? (
            <p className="prop-note">Removing background...</p>
          ) : (
            <button
              className="prop-action-btn"
              disabled={!apiKey.trim()}
              onClick={() => void handleApiRemove()}
            >
              Remove Background
            </button>
          )}
          {apiPhase === "error" && (
            <p className="prop-note prop-error">{apiErr}</p>
          )}
        </div>
      </Section>
    </>
  );
}

// --- Text tab ---

function TextProps({
  layer,
  fonts,
  set,
}: {
  layer: TextLayer;
  fonts: FontFamily[];
  set: (c: LayerChanges) => void;
}) {
  const stroke = layer.stroke;
  const shadow = layer.dropShadow;
  const variants = variantsFor(fonts, layer.fontFamily);
  const styleValue = `${layer.fontWeight}:${layer.italic}`;

  const changeFamily = (family: string) => {
    const vs = variantsFor(fonts, family);
    const keep = vs.find((v) => v.weight === layer.fontWeight && v.italic === layer.italic);
    const chosen = keep ?? vs[0];
    set({ fontFamily: family, fontWeight: chosen.weight, italic: chosen.italic });
  };

  const changeStyle = (value: string) => {
    const [w, i] = value.split(":");
    set({ fontWeight: Number(w), italic: i === "true" });
  };

  const updateStroke = (changes: Partial<TextStroke>) =>
    set({ stroke: { color: "#000000", width: 4, ...stroke, ...changes } });
  const updateShadow = (changes: Partial<TextDropShadow>) =>
    set({
      dropShadow: {
        color: "#000000",
        blur: 4,
        distance: 4,
        angle: Math.PI / 4,
        alpha: 0.7,
        ...shadow,
        ...changes,
      },
    });

  return (
    <Section title="Text">
      <textarea
        className="prop-textarea"
        value={layer.text}
        rows={4}
        onChange={(e) => set({ text: e.target.value })}
      />

      <PropRow label="Font">
        <select value={layer.fontFamily} onChange={(e) => changeFamily(e.target.value)}>
          {fonts.length === 0 && <option value={layer.fontFamily}>{layer.fontFamily}</option>}
          {fonts.map((f) => (
            <option key={f.family} value={f.family}>
              {f.family}
            </option>
          ))}
        </select>
      </PropRow>

      <PropRow label="">
        <select value={styleValue} onChange={(e) => changeStyle(e.target.value)}>
          {variants.map((v) => (
            <option key={`${v.weight}:${v.italic}`} value={`${v.weight}:${v.italic}`}>
              {v.label}
            </option>
          ))}
        </select>
      </PropRow>

      <ColorRow label="Color" value={layer.fill} onChange={(v) => set({ fill: v })} />

      <SliderRow label="Size" value={Math.round(layer.fontSize)} min={1} max={400} onChange={(v) => set({ fontSize: v })} />

      <PropRow label="Align">
        <select value={layer.align} onChange={(e) => set({ align: e.target.value as TextLayer["align"] })}>
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </PropRow>

      <PropRow label="Outline">
        <input
          type="checkbox"
          checked={!!stroke}
          onChange={(e) => set({ stroke: e.target.checked ? { color: "#000000", width: 4 } : undefined })}
        />
      </PropRow>
      {stroke && (
        <>
          <ColorRow label="Outline Color" value={stroke.color} onChange={(v) => updateStroke({ color: v })} />
          <SliderRow label="Outline W" value={stroke.width} min={0} max={50} onChange={(v) => updateStroke({ width: v })} />
        </>
      )}

      <PropRow label="Drop Shadow">
        <input
          type="checkbox"
          checked={!!shadow}
          onChange={(e) =>
            set({
              dropShadow: e.target.checked
                ? { color: "#000000", blur: 4, distance: 4, angle: Math.PI / 4, alpha: 0.7 }
                : undefined,
            })
          }
        />
      </PropRow>
      {shadow && (
        <>
          <ColorRow label="Shadow Color" value={shadow.color} onChange={(v) => updateShadow({ color: v })} />
          <SliderRow label="Blur" value={shadow.blur} min={0} max={50} onChange={(v) => updateShadow({ blur: v })} />
          <SliderRow label="Distance" value={shadow.distance} min={0} max={100} onChange={(v) => updateShadow({ distance: v })} />
          <SliderRow label="Angle°" value={radToDeg(shadow.angle)} min={-180} max={180} onChange={(v) => updateShadow({ angle: degToRad(v) })} />
        </>
      )}
    </Section>
  );
}

// --- Shape style tab ---

function ShapeStyleProps({
  layer,
  set,
}: {
  layer: Extract<Layer, { type: "shape" }>;
  set: (c: LayerChanges) => void;
}) {
  const isBox = layer.shapeKind === "rect" || layer.shapeKind === "ellipse";

  return (
    <Section title="Shape">
      <PropRow label="Type">
        <span className="prop-static">{layer.shapeKind}</span>
      </PropRow>

      {isBox && <ColorRow label="Fill" value={layer.fill ?? "#888888"} onChange={(v) => set({ fill: v })} />}

      <ColorRow
        label={isBox ? "Stroke" : "Color"}
        value={layer.strokeColor ?? "#000000"}
        onChange={(v) => set({ strokeColor: v })}
      />
      <SliderRow label="Stroke W" value={layer.strokeWidth} min={0} max={50} onChange={(v) => set({ strokeWidth: v })} />
    </Section>
  );
}
