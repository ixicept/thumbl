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

export function PropertiesPanel({ layer, fonts, onChange }: PropertiesPanelProps) {
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
          <Field label="Color">
            <input
              type="color"
              value={layer.color}
              onChange={(e) => set({ color: e.target.value })}
            />
          </Field>
        )}
        {tab === "Transform" && <TransformProps layer={layer} set={set} />}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="prop-field">
      <span className="prop-label">{label}</span>
      {children}
    </label>
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
  set,
}: {
  layer: Layer;
  set: (c: LayerChanges) => void;
}) {
  if (layer.type === "fill") {
    return <p className="prop-note">Background fills the whole canvas.</p>;
  }

  if (layer.type === "shape" && (layer.shapeKind === "line" || layer.shapeKind === "arrow")) {
    return (
      <>
        <div className="prop-row">
          <Field label="X1">
            <input type="number" value={Math.round(layer.x1 ?? 0)} onChange={(e) => set({ x1: num(e.target.value) })} />
          </Field>
          <Field label="Y1">
            <input type="number" value={Math.round(layer.y1 ?? 0)} onChange={(e) => set({ y1: num(e.target.value) })} />
          </Field>
        </div>
        <div className="prop-row">
          <Field label="X2">
            <input type="number" value={Math.round(layer.x2 ?? 0)} onChange={(e) => set({ x2: num(e.target.value) })} />
          </Field>
          <Field label="Y2">
            <input type="number" value={Math.round(layer.y2 ?? 0)} onChange={(e) => set({ y2: num(e.target.value) })} />
          </Field>
        </div>
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
      <div className="prop-row">
        <Field label="X">
          <input type="number" value={Math.round(x)} onChange={(e) => set({ x: num(e.target.value) })} />
        </Field>
        <Field label="Y">
          <input type="number" value={Math.round(y)} onChange={(e) => set({ y: num(e.target.value) })} />
        </Field>
      </div>
      {hasSize && (
        <div className="prop-row">
          <Field label="Width">
            <input
              type="number"
              value={Math.round((layer as { width?: number }).width ?? 0)}
              onChange={(e) => set({ width: num(e.target.value) })}
            />
          </Field>
          <Field label="Height">
            <input
              type="number"
              value={Math.round((layer as { height?: number }).height ?? 0)}
              onChange={(e) => set({ height: num(e.target.value) })}
            />
          </Field>
        </div>
      )}
      <Field label="Rotation°">
        <input type="number" value={radToDeg(rotation)} onChange={(e) => set({ rotation: degToRad(num(e.target.value)) })} />
      </Field>
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
    <>
      <Field label="Text">
        <textarea value={layer.text} rows={3} onChange={(e) => set({ text: e.target.value })} />
      </Field>

      <Field label="Font">
        <select value={layer.fontFamily} onChange={(e) => changeFamily(e.target.value)}>
          {fonts.length === 0 && <option value={layer.fontFamily}>{layer.fontFamily}</option>}
          {fonts.map((f) => (
            <option key={f.family} value={f.family}>
              {f.family}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Style">
        <select value={styleValue} onChange={(e) => changeStyle(e.target.value)}>
          {variants.map((v) => (
            <option key={`${v.weight}:${v.italic}`} value={`${v.weight}:${v.italic}`}>
              {v.label}
            </option>
          ))}
        </select>
      </Field>

      <div className="prop-row">
        <Field label="Size">
          <input type="number" value={Math.round(layer.fontSize)} onChange={(e) => set({ fontSize: num(e.target.value) })} />
        </Field>
        <Field label="Color">
          <input type="color" value={layer.fill} onChange={(e) => set({ fill: e.target.value })} />
        </Field>
      </div>

      <Field label="Align">
        <select value={layer.align} onChange={(e) => set({ align: e.target.value as TextLayer["align"] })}>
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </Field>

      <label className="prop-check">
        <input
          type="checkbox"
          checked={!!stroke}
          onChange={(e) => set({ stroke: e.target.checked ? { color: "#000000", width: 4 } : undefined })}
        />
        Outline
      </label>
      {stroke && (
        <div className="prop-row">
          <Field label="Color">
            <input type="color" value={stroke.color} onChange={(e) => updateStroke({ color: e.target.value })} />
          </Field>
          <Field label="Width">
            <input type="number" value={stroke.width} onChange={(e) => updateStroke({ width: num(e.target.value) })} />
          </Field>
        </div>
      )}

      <label className="prop-check">
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
        Drop Shadow
      </label>
      {shadow && (
        <>
          <div className="prop-row">
            <Field label="Color">
              <input type="color" value={shadow.color} onChange={(e) => updateShadow({ color: e.target.value })} />
            </Field>
            <Field label="Blur">
              <input type="number" value={shadow.blur} onChange={(e) => updateShadow({ blur: num(e.target.value) })} />
            </Field>
          </div>
          <div className="prop-row">
            <Field label="Distance">
              <input type="number" value={shadow.distance} onChange={(e) => updateShadow({ distance: num(e.target.value) })} />
            </Field>
            <Field label="Angle°">
              <input type="number" value={radToDeg(shadow.angle)} onChange={(e) => updateShadow({ angle: degToRad(num(e.target.value)) })} />
            </Field>
          </div>
        </>
      )}
    </>
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
    <>
      <Field label="Shape">
        <span className="prop-static">{layer.shapeKind}</span>
      </Field>

      {isBox && (
        <Field label="Fill">
          <input type="color" value={layer.fill ?? "#888888"} onChange={(e) => set({ fill: e.target.value })} />
        </Field>
      )}

      <div className="prop-row">
        <Field label={isBox ? "Stroke" : "Color"}>
          <input type="color" value={layer.strokeColor ?? "#000000"} onChange={(e) => set({ strokeColor: e.target.value })} />
        </Field>
        <Field label="Stroke W">
          <input type="number" value={layer.strokeWidth} onChange={(e) => set({ strokeWidth: num(e.target.value) })} />
        </Field>
      </div>
    </>
  );
}
