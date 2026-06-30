export interface ImageLayer {
  id: string;
  type: "image";
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export type Layer = ImageLayer;

export interface Project {
  version: 1;
  canvasWidth: number;
  canvasHeight: number;
  layers: Layer[];
}

export function createEmptyProject(): Project {
  return {
    version: 1,
    canvasWidth: 1280,
    canvasHeight: 720,
    layers: [],
  };
}
