export type BlendMode =
  | "normal"
  | "add"
  | "multiply"
  | "screen"
  | "darken"
  | "lighten"
  | "overlay"
  | "color-dodge"
  | "color-burn"
  | "hard-light"
  | "soft-light"
  | "difference"
  | "exclusion";

export interface ColorAdjustments {
  brightness: number;          // 0 to 2, default 1
  contrast: number;            // 0 to 2, default 1
  saturation: number;          // 0 to 2, default 1
  hue: number;                 // -180 to 180, default 0
  temperature: number;         // -100 to 100, default 0 (warm/cool)
  shadows: [number, number];   // color wheel [x,y] -1 to 1, default [0,0]
  midtones: [number, number];  // color wheel [x,y] -1 to 1, default [0,0]
  highlights: [number, number];// color wheel [x,y] -1 to 1, default [0,0]
}

export const DEFAULT_COLOR_ADJUSTMENTS: ColorAdjustments = {
  brightness: 1,
  contrast: 1,
  saturation: 1,
  hue: 0,
  temperature: 0,
  shadows: [0, 0],
  midtones: [0, 0],
  highlights: [0, 0],
};

export interface BaseLayer {
  id: string;
  name: string;
  visible: boolean;
  blendMode: BlendMode;
  colorAdjustments?: ColorAdjustments;
}

export interface ImageLayer extends BaseLayer {
  type: "image";
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

/** Always fills the full canvas; not draggable/resizable. */
export interface FillLayer extends BaseLayer {
  type: "fill";
  color: string;
}

export interface TextStroke {
  color: string;
  width: number;
}

export interface TextDropShadow {
  color: string;
  blur: number;
  distance: number;
  angle: number;
  alpha: number;
}

export interface TextLayer extends BaseLayer {
  type: "text";
  text: string;
  x: number;
  y: number;
  rotation: number;
  fontFamily: string;
  fontSize: number;
  fill: string;
  fontWeight: number;
  italic: boolean;
  align: "left" | "center" | "right";
  stroke?: TextStroke;
  dropShadow?: TextDropShadow;
}

export type ShapeKind = "rect" | "ellipse" | "line" | "arrow";

/** rect/ellipse use a box (x,y,w,h); line/arrow use endpoints (x1,y1,x2,y2). */
export interface ShapeLayer extends BaseLayer {
  type: "shape";
  shapeKind: ShapeKind;
  // box shapes:
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  // line/arrow:
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  fill?: string;
  strokeColor?: string;
  strokeWidth: number;
}

export type Layer = ImageLayer | FillLayer | TextLayer | ShapeLayer;

/**
 * Partial update payload covering fields from any layer type. `type` is omitted
 * (it never changes via an update) so the literal-type fields don't conflict.
 */
export type LayerChanges = Partial<Omit<ImageLayer, "type">> &
  Partial<Omit<FillLayer, "type">> &
  Partial<Omit<TextLayer, "type">> &
  Partial<Omit<ShapeLayer, "type">>;

export interface Project {
  version: 1;
  canvasWidth: number;
  canvasHeight: number;
  /** Stacking order: index 0 = bottom (back), last index = top (front). */
  layers: Layer[];
  globalAdjustments: ColorAdjustments;
}

export function normalizeProject(project: Project): Project {
  return {
    ...project,
    globalAdjustments: project.globalAdjustments ?? { ...DEFAULT_COLOR_ADJUSTMENTS },
    layers: project.layers.map((layer, index) => ({
      ...layer,
      name: layer.name ?? `Layer ${index + 1}`,
      visible: layer.visible ?? true,
      blendMode: layer.blendMode ?? "normal",
    })),
  };
}
