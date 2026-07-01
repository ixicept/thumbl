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
  fonts: FontFamily[];
  canvasWidth: number;
  canvasHeight: number;
  globalAdjustments: ColorAdjustments;
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
  fonts,
  canvasWidth,
  canvasHeight,
  globalAdjustments,
  onChange,
  onGlobalChange,
}: PropertiesPanelProps) {
  const [activeTab, setActiveTab] = useState("Color");
  const set = layer ? (changes: LayerChanges) => onChange(layer.id, changes) : null;

  if (!layer) {
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
          <TransformProps layer={layer} canvasWidth={canvasWidth} canvasHeight={canvasHeight} set={set!} />
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

function TransformProps({
  layer,
  set,
}: {
  layer: Layer;
  canvasWidth: number;
  canvasHeight: number;
  set: (c: LayerChanges) => void;
}) {
  // Normalized space: position ±1.5 range, size 0–2 range, step 0.001
  const posRange = { min: -1.5, max: 1.5, step: 0.001 };
  const sizeRange = { min: 0.001, max: 2, step: 0.001 };

  const fmt = (v: number) => parseFloat(v.toFixed(3));

  if (layer.type === "fill") {
    return <p className="prop-note">Background fills the whole canvas.</p>;
  }

  if (layer.type === "shape" && (layer.shapeKind === "line" || layer.shapeKind === "arrow")) {
    return (
      <>
        <SliderRow label="X1" value={fmt(layer.x1 ?? 0)} {...posRange} onChange={(v) => set({ x1: v })} />
        <SliderRow label="Y1" value={fmt(layer.y1 ?? 0)} {...posRange} onChange={(v) => set({ y1: v })} />
        <SliderRow label="X2" value={fmt(layer.x2 ?? 0)} {...posRange} onChange={(v) => set({ x2: v })} />
        <SliderRow label="Y2" value={fmt(layer.y2 ?? 0)} {...posRange} onChange={(v) => set({ y2: v })} />
      </>
    );
  }

  const x = layer.type === "text" ? layer.x : (layer as { x?: number }).x ?? 0;
  const y = layer.type === "text" ? layer.y : (layer as { y?: number }).y ?? 0;
  const rotation = layer.type === "text" ? layer.rotation : (layer as { rotation?: number }).rotation ?? 0;
  const hasSize = layer.type === "image" || layer.type === "shape";

  return (
    <>
      <SliderRow label="X" value={fmt(x)} {...posRange} onChange={(v) => set({ x: v })} />
      <SliderRow label="Y" value={fmt(y)} {...posRange} onChange={(v) => set({ y: v })} />
      {hasSize && (
        <>
          <SliderRow
            label="Width"
            value={fmt((layer as { width?: number }).width ?? 0)}
            {...sizeRange}
            onChange={(v) => set({ width: v })}
          />
          <SliderRow
            label="Height"
            value={fmt((layer as { height?: number }).height ?? 0)}
            {...sizeRange}
            onChange={(v) => set({ height: v })}
          />
        </>
      )}
      <SliderRow
        label="Rotation°"
        value={radToDeg(rotation)}
        min={-180}
        max={180}
        onChange={(v) => set({ rotation: degToRad(v) })}
      />
    </>
  );
}

// --- Image tab ---

const API_KEY_STORAGE = "thumbl_rmbg_api_key";

type BgPhase = "idle" | "processing" | "error";

function ImageToolsProps({
  layer,
  set,
}: {
  layer: ImageLayer;
  set: (c: LayerChanges) => void;
}) {
  const [phase, setPhase] = useState<BgPhase>("idle");
  const [errMsg, setErrMsg] = useState("");
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(API_KEY_STORAGE) ?? "");

  function saveKey(k: string) {
    setApiKey(k);
    localStorage.setItem(API_KEY_STORAGE, k);
  }

  async function handleRemove() {
    if (!apiKey.trim()) {
      setErrMsg("Enter a remove.bg API key first.");
      setPhase("error");
      return;
    }
    setPhase("processing");
    try {
      const newPath = await invoke<string>("remove_background_api", {
        srcPath: layer.src,
        apiKey: apiKey.trim(),
      });
      set({ src: newPath });
      setPhase("idle");
    } catch (e) {
      setErrMsg(String(e));
      setPhase("error");
    }
  }

  return (
    <Section title="AI Tools">
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
          <a
            className="prop-link"
            href="https://www.remove.bg/api"
            target="_blank"
            rel="noreferrer"
          >
            remove.bg
          </a>{" "}
          (50 credits/month)
        </p>
        {phase === "processing" ? (
          <p className="prop-note">Removing background...</p>
        ) : (
          <button
            className="prop-action-btn"
            disabled={!apiKey.trim()}
            onClick={() => void handleRemove()}
          >
            Remove Background
          </button>
        )}
        {phase === "error" && (
          <p className="prop-note prop-error">{errMsg}</p>
        )}
      </div>
    </Section>
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
