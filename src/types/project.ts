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

export interface BaseLayer {
  id: string;
  name: string;
  visible: boolean;
  blendMode: BlendMode;
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

export type Layer = ImageLayer | FillLayer;

/** Partial update payload covering fields from any layer type. */
export type LayerChanges = Partial<ImageLayer> & Partial<FillLayer>;

export interface Project {
  version: 1;
  canvasWidth: number;
  canvasHeight: number;
  /** Stacking order: index 0 = bottom (back), last index = top (front). */
  layers: Layer[];
}

export function normalizeProject(project: Project): Project {
  return {
    ...project,
    layers: project.layers.map((layer, index) => ({
      ...layer,
      name: layer.name ?? `Layer ${index + 1}`,
      visible: layer.visible ?? true,
      blendMode: layer.blendMode ?? "normal",
    })),
  };
}
