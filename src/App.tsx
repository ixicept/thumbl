import { useEffect, useState } from "react";
import { Assets } from "pixi.js";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { PixiCanvas } from "./canvas/PixiCanvas";
import { LayersPanel } from "./panels/LayersPanel";
import { PropertiesPanel } from "./panels/PropertiesPanel";
import { MenuBar } from "./menu/MenuBar";
import { NewCanvasDialog } from "./dialogs/NewCanvasDialog";
import { loadFonts, type FontFamily } from "./fonts";
import {
  openProject,
  pickImagePath,
  saveProject,
  saveProjectAs,
} from "./project/io";
import type {
  BlendMode,
  Layer,
  LayerChanges,
  Project,
  ShapeKind,
} from "./types/project";
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
  const [fonts, setFonts] = useState<FontFamily[]>([]);

  useEffect(() => {
    void loadFonts().then(setFonts);
  }, []);

  const selectedLayer = project?.layers.find((l) => l.id === selectedId) ?? null;

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

  function addLayer(layer: Layer) {
    setProject((p) => (p ? { ...p, layers: [...p.layers, layer] } : p));
    setSelectedId(layer.id);
  }

  function addTextLayer() {
    if (!project) return;
    addLayer({
      id: crypto.randomUUID(),
      type: "text",
      name: "Text",
      visible: true,
      blendMode: "normal",
      text: "Your text",
      x: project.canvasWidth / 2 - 100,
      y: project.canvasHeight / 2 - 30,
      rotation: 0,
      fontFamily: fonts.some((f) => f.family === "Impact")
        ? "Impact"
        : fonts[0]?.family ?? "Arial",
      fontSize: 72,
      fill: "#ffffff",
      fontWeight: 400,
      italic: false,
      align: "left",
      stroke: { color: "#000000", width: 6 },
    });
  }

  function addShapeLayer(shapeKind: ShapeKind) {
    if (!project) return;
    const cx = project.canvasWidth / 2;
    const cy = project.canvasHeight / 2;
    const base = {
      id: crypto.randomUUID(),
      type: "shape" as const,
      name: shapeKind.charAt(0).toUpperCase() + shapeKind.slice(1),
      visible: true,
      blendMode: "normal" as const,
      strokeWidth: 4,
    };
    if (shapeKind === "line" || shapeKind === "arrow") {
      addLayer({
        ...base,
        shapeKind,
        x1: cx - 150,
        y1: cy,
        x2: cx + 150,
        y2: cy,
        strokeColor: "#000000",
      });
    } else {
      addLayer({
        ...base,
        shapeKind,
        x: cx - 150,
        y: cy - 100,
        width: 300,
        height: 200,
        rotation: 0,
        fill: "#4f9eff",
        strokeColor: "#000000",
      });
    }
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
      } else if (e.key === "t") {
        e.preventDefault();
        addTextLayer();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, filePath]);

  const title = filePath ? basename(filePath) : "";

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
          {
            label: "Insert",
            items: [
              { label: "Text", shortcut: "Ctrl+T", onClick: addTextLayer, disabled: !project },
              { label: "Rectangle", onClick: () => addShapeLayer("rect"), disabled: !project },
              { label: "Ellipse", onClick: () => addShapeLayer("ellipse"), disabled: !project },
              { label: "Line", onClick: () => addShapeLayer("line"), disabled: !project },
              { label: "Arrow", onClick: () => addShapeLayer("arrow"), disabled: !project },
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
              onRename={(id, name) => updateLayer(id, { name })}
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
          <aside className="properties-panel">
            {selectedLayer ? (
              <PropertiesPanel
                layer={selectedLayer}
                fonts={fonts}
                canvasWidth={project.canvasWidth}
                canvasHeight={project.canvasHeight}
                onChange={updateLayer}
              />
            ) : (
              <p className="properties-panel-empty">No layer selected</p>
            )}
          </aside>
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
