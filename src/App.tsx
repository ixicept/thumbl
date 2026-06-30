import { useState } from "react";
import { Assets } from "pixi.js";
import { convertFileSrc } from "@tauri-apps/api/core";
import { PixiCanvas } from "./canvas/PixiCanvas";
import { openProject, pickImagePath, saveProjectAs } from "./project/io";
import { createEmptyProject, type Layer, type Project } from "./types/project";
import "./App.css";

function App() {
  const [project, setProject] = useState<Project>(createEmptyProject());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);

  function updateLayer(id: string, changes: Partial<Layer>) {
    setProject((p) => ({
      ...p,
      layers: p.layers.map((l) => (l.id === id ? { ...l, ...changes } : l)),
    }));
  }

  async function handleAddImage() {
    const path = await pickImagePath();
    if (!path) return;

    const texture = await Assets.load(convertFileSrc(path));
    const id = crypto.randomUUID();
    const layer: Layer = {
      id,
      type: "image",
      src: path,
      x: 40,
      y: 40,
      width: texture.width,
      height: texture.height,
      rotation: 0,
    };
    setProject((p) => ({ ...p, layers: [...p.layers, layer] }));
    setSelectedId(id);
  }

  async function handleSave() {
    const path = await saveProjectAs(project);
    if (path) setSavedPath(path);
  }

  async function handleOpen() {
    const loaded = await openProject();
    if (loaded) {
      setProject(loaded);
      setSelectedId(null);
      setSavedPath(null);
    }
  }

  return (
    <main className="app">
      <header className="toolbar">
        <h1>thumbl</h1>
        <button onClick={handleAddImage}>Add Image</button>
        <button onClick={handleSave}>Save Project</button>
        <button onClick={handleOpen}>Open Project</button>
        {savedPath && <span className="saved-path">Saved to {savedPath}</span>}
      </header>
      <div className="canvas-area">
        <PixiCanvas
          canvasWidth={project.canvasWidth}
          canvasHeight={project.canvasHeight}
          layers={project.layers}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onLayerChange={updateLayer}
        />
      </div>
    </main>
  );
}

export default App;
