import { useState } from "react";
import type {
  Layer,
  LayerChanges,
  TextDropShadow,
  TextLayer,
  TextStroke,
} from "../types/project";
import { variantsFor, type FontFamily } from "../fonts";
import "./PropertiesPanel.css";

interface PropertiesPanelProps {
  layer: Layer;
  fonts: FontFamily[];
  canvasWidth: number;
  canvasHeight: number;
  onChange: (id: string, changes: LayerChanges) => void;
}

function tabsFor(layer: Layer): string[] {
  switch (layer.type) {
    case "text":
      return ["Text", "Transform"];
    case "shape":
      return ["Shape", "Transform"];
    case "image":
      return ["Transform"];
    case "fill":
      return ["Fill"];
  }
}

export function PropertiesPanel({
  layer,
  fonts,
  canvasWidth,
  canvasHeight,
  onChange,
}: PropertiesPanelProps) {
  const [activeTab, setActiveTab] = useState("Text");
  const set = (changes: LayerChanges) => onChange(layer.id, changes);

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
        {tab === "Text" && layer.type === "text" && (
          <TextProps layer={layer} fonts={fonts} set={set} />
        )}
        {tab === "Shape" && layer.type === "shape" && (
          <ShapeStyleProps layer={layer} set={set} />
        )}
        {tab === "Fill" && layer.type === "fill" && (
          <ColorRow label="Color" value={layer.color} onChange={(v) => set({ color: v })} />
        )}
        {tab === "Transform" && (
          <TransformProps layer={layer} canvasWidth={canvasWidth} canvasHeight={canvasHeight} set={set} />
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
      // user cancelled the pick
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

// --- Transform tab (box treatment) ---

function TransformProps({
  layer,
  canvasWidth,
  canvasHeight,
  set,
}: {
  layer: Layer;
  canvasWidth: number;
  canvasHeight: number;
  set: (c: LayerChanges) => void;
}) {
  const xRange = { min: -canvasWidth, max: canvasWidth * 2 };
  const yRange = { min: -canvasHeight, max: canvasHeight * 2 };
  const sizeRange = { min: 1, max: Math.max(canvasWidth, canvasHeight) * 2 };

  if (layer.type === "fill") {
    return <p className="prop-note">Background fills the whole canvas.</p>;
  }

  if (layer.type === "shape" && (layer.shapeKind === "line" || layer.shapeKind === "arrow")) {
    return (
      <>
        <SliderRow label="X1" value={Math.round(layer.x1 ?? 0)} {...xRange} onChange={(v) => set({ x1: v })} />
        <SliderRow label="Y1" value={Math.round(layer.y1 ?? 0)} {...yRange} onChange={(v) => set({ y1: v })} />
        <SliderRow label="X2" value={Math.round(layer.x2 ?? 0)} {...xRange} onChange={(v) => set({ x2: v })} />
        <SliderRow label="Y2" value={Math.round(layer.y2 ?? 0)} {...yRange} onChange={(v) => set({ y2: v })} />
      </>
    );
  }

  // box-style: image, rect/ellipse, text
  const x = layer.type === "text" ? layer.x : (layer as { x?: number }).x ?? 0;
  const y = layer.type === "text" ? layer.y : (layer as { y?: number }).y ?? 0;
  const rotation = layer.type === "text" ? layer.rotation : (layer as { rotation?: number }).rotation ?? 0;
  const hasSize = layer.type === "image" || layer.type === "shape";

  return (
    <>
      <SliderRow label="X" value={Math.round(x)} {...xRange} onChange={(v) => set({ x: v })} />
      <SliderRow label="Y" value={Math.round(y)} {...yRange} onChange={(v) => set({ y: v })} />
      {hasSize && (
        <>
          <SliderRow
            label="Width"
            value={Math.round((layer as { width?: number }).width ?? 0)}
            {...sizeRange}
            onChange={(v) => set({ width: v })}
          />
          <SliderRow
            label="Height"
            value={Math.round((layer as { height?: number }).height ?? 0)}
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
          <SliderRow label="Outline Width" value={stroke.width} min={0} max={50} onChange={(v) => updateStroke({ width: v })} />
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
