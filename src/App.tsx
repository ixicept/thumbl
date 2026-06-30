import { useEffect, useState } from "react";
import { Assets } from "pixi.js";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { PixiCanvas } from "./canvas/PixiCanvas";
import { LayersPanel } from "./panels/LayersPanel";
import { MenuBar } from "./menu/MenuBar";
import { NewCanvasDialog } from "./dialogs/NewCanvasDialog";
import {
  openProject,
  pickImagePath,
  saveProject,
  saveProjectAs,
} from "./project/io";
import type { BlendMode, Layer, LayerChanges, Project } from "./types/project";
import "./App.css";

function basename(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || "Image";
}

function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [showNewCanvasDialog, setShowNewCanvasDialog] = useState(false);

  function updateLayer(id: string, changes: LayerChanges) {
    setProject((p) =>
      p
        ? {
            ...p,
            layers: p.layers.map((l) =>
              l.id === id ? ({ ...l, ...changes } as Layer) : l
            ),
          }
        : p
    );
  }

  function reorderLayer(fromIndex: number, toIndex: number) {
    setProject((p) => {
      if (!p) return p;
      const layers = [...p.layers];
      const [moved] = layers.splice(fromIndex, 1);
      layers.splice(toIndex, 0, moved);
      return { ...p, layers };
    });
  }

  function deleteLayer(id: string) {
    setProject((p) =>
      p ? { ...p, layers: p.layers.filter((l) => l.id !== id) } : p
    );
    setSelectedId((current) => (current === id ? null : current));
  }

  function toggleLayerVisible(id: string) {
    setProject((p) =>
      p
        ? {
            ...p,
            layers: p.layers.map((l) =>
              l.id === id ? { ...l, visible: !l.visible } : l
            ),
          }
        : p
    );
  }

  function changeLayerBlendMode(id: string, blendMode: BlendMode) {
    updateLayer(id, { blendMode });
  }

  function changeLayerColor(id: string, color: string) {
    updateLayer(id, { color });
  }

  function handleNewCanvas(width: number, height: number) {
    const background: Layer = {
      id: crypto.randomUUID(),
      type: "fill",
      name: "Background",
      visible: true,
      blendMode: "normal",
      color: "#ffffff",
    };
    setProject({
      version: 1,
      canvasWidth: width,
      canvasHeight: height,
      layers: [background],
    });
    setSelectedId(null);
    setFilePath(null);
    setShowNewCanvasDialog(false);
  }

  async function handleImportImage() {
    if (!project) return;
    const path = await pickImagePath();
    if (!path) return;

    const texture = await Assets.load(convertFileSrc(path));
    const id = crypto.randomUUID();
    const layer: Layer = {
      id,
      type: "image",
      name: basename(path),
      visible: true,
      blendMode: "normal",
      src: path,
      x: 40,
      y: 40,
      width: texture.width,
      height: texture.height,
      rotation: 0,
    };
    setProject((p) => (p ? { ...p, layers: [...p.layers, layer] } : p));
    setSelectedId(id);
  }

  async function handleSave() {
    if (!project) return;
    if (filePath) {
      await saveProject(project, filePath);
    } else {
      const path = await saveProjectAs(project);
      if (path) setFilePath(path);
    }
  }

  async function handleSaveAs() {
    if (!project) return;
    const path = await saveProjectAs(project);
    if (path) setFilePath(path);
  }

  async function handleOpen() {
    const result = await openProject();
    if (result) {
      setProject(result.project);
      setFilePath(result.path);
      setSelectedId(null);
    }
  }

  function deleteSelectedLayer() {
    if (selectedId) deleteLayer(selectedId);
  }

  function deselectAll() {
    setSelectedId(null);
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;
      if (e.key === "n") {
        e.preventDefault();
        setShowNewCanvasDialog(true);
      } else if (e.key === "o") {
        e.preventDefault();
        void handleOpen();
      } else if (e.key === "s" && e.shiftKey) {
        e.preventDefault();
        void handleSaveAs();
      } else if (e.key === "s") {
        e.preventDefault();
        void handleSave();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, filePath]);

  const title = `thumbl${filePath ? ` — ${basename(filePath)}` : ""}`;

  return (
    <main className="app">
      <MenuBar
        title={title}
        menus={[
          {
            label: "File",
            items: [
              {
                label: "New Canvas...",
                shortcut: "Ctrl+N",
                onClick: () => setShowNewCanvasDialog(true),
              },
              { label: "Open Project...", shortcut: "Ctrl+O", onClick: () => void handleOpen() },
              {
                label: "Save",
                shortcut: "Ctrl+S",
                onClick: () => void handleSave(),
                disabled: !project,
              },
              {
                label: "Save As...",
                shortcut: "Ctrl+Shift+S",
                onClick: () => void handleSaveAs(),
                disabled: !project,
              },
              {
                label: "Import Image...",
                onClick: () => void handleImportImage(),
                disabled: !project,
              },
              { label: "Exit", onClick: () => void getCurrentWindow().close() },
            ],
          },
          {
            label: "Edit",
            items: [
              {
                label: "Delete Layer",
                onClick: deleteSelectedLayer,
                disabled: !selectedId,
              },
              {
                label: "Deselect",
                onClick: deselectAll,
                disabled: !selectedId,
              },
            ],
          },
        ]}
      />
      {project ? (
        <div className="workspace">
          <aside className="layers-panel">
            <LayersPanel
              layers={project.layers}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onReorder={reorderLayer}
              onToggleVisible={toggleLayerVisible}
              onDelete={deleteLayer}
              onBlendModeChange={changeLayerBlendMode}
              onColorChange={changeLayerColor}
            />
          </aside>
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
        </div>
      ) : (
        <div className="empty-state">
          <p>No canvas open</p>
          <button onClick={() => setShowNewCanvasDialog(true)}>New Canvas</button>
          <button onClick={() => void handleOpen()}>Open Project</button>
        </div>
      )}
      {showNewCanvasDialog && (
        <NewCanvasDialog
          onCreate={handleNewCanvas}
          onCancel={() => setShowNewCanvasDialog(false)}
        />
      )}
    </main>
  );
}

export default App;
