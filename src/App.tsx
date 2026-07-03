import { useEffect, useRef, useState } from "react";
import { useHistory } from "./useHistory";
import { save } from "@tauri-apps/plugin-dialog";
import { Assets } from "pixi.js";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { PixiCanvas, type PixiCanvasHandle } from "./canvas/PixiCanvas";
import { LayersPanel } from "./panels/LayersPanel";
import { PropertiesPanel } from "./panels/PropertiesPanel";
import { EffectsPanel } from "./panels/EffectsPanel";
import { BrowserPanel } from "./panels/BrowserPanel";
import { MenuBar } from "./menu/MenuBar";
import { ToolBar } from "./menu/ToolBar";
import { WelcomeScreen } from "./WelcomeScreen";
import { NewCanvasDialog } from "./dialogs/NewCanvasDialog";
import { ExportDialog } from "./dialogs/ExportDialog";
import { EmojiPicker } from "./dialogs/EmojiPicker";
import { ShortcutsDialog } from "./dialogs/ShortcutsDialog";
import { loadFonts, type FontFamily } from "./fonts";
import {
  openProject,
  openProjectFromPath,
  pickImagePath,
  saveProject,
  saveProjectAs,
} from "./project/io";
import { addRecentFile, getRecentFiles, removeRecentFile, type RecentFile } from "./project/recentFiles";
import type {
  BlendMode,
  ColorAdjustments,
  Layer,
  LayerChanges,
  Project,
  ShapeKind,
} from "./types/project";
import { DEFAULT_COLOR_ADJUSTMENTS } from "./types/project";
import "./App.css";

function basename(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || "Image";
}

function projectDisplayName(path: string): string {
  return basename(path).replace(/\.thumbl\.json$/i, "").replace(/\.json$/i, "") || "Untitled Project";
}

function App() {
  const { project, setProject, setProjectSilent, pushSnapshot, resetProject, undo, redo, canUndo, canRedo } = useHistory<Project>();
  const preChangeRef = useRef<Project | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [showNewCanvasDialog, setShowNewCanvasDialog] = useState(false);
  const [fonts, setFonts] = useState<FontFamily[]>([]);
  const [showBrowser, setShowBrowser] = useState(false);
  const [browserHeight, setBrowserHeight] = useState(260);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>(() => getRecentFiles());
  const [isDirty, setIsDirty] = useState(false);
  const [activeLeftTab, setActiveLeftTab] = useState<"layers" | "effects">("layers");
  const [showShortcuts, setShowShortcuts] = useState(false);
  const isResizingBrowser = useRef(false);
  const canvasRef = useRef<PixiCanvasHandle>(null);
  const canvasAreaRef = useRef<HTMLDivElement>(null);
  const selectionAnchorId = useRef<string | null>(null);
const dragToolRef = useRef<string | null>(null);
  const [dragVisual, setDragVisual] = useState<{ label: string; x: number; y: number } | null>(null);
  const [isDroppingOnCanvas, setIsDroppingOnCanvas] = useState(false);
  const [fileDragPos, setFileDragPos] = useState<{ x: number; y: number } | null>(null);
  const toolActionsRef = useRef<Record<string, (pos?: { x: number; y: number }) => void>>({});
  const addImageFromPathRef = useRef<(path: string, pos?: { x: number; y: number }) => Promise<void>>(async () => {});
  const deleteSelectedLayersRef = useRef<() => void>(() => {});
  const clipboardRef = useRef<Layer[]>([]);
  const copySelectedLayersRef = useRef<() => void>(() => {});
  const pasteLayersRef = useRef<() => void>(() => {});

  useEffect(() => {
    void loadFonts().then(setFonts);
  }, []);

  useEffect(() => {
    const webview = getCurrentWebviewWindow();
    const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

    const unlistenPromise = webview.onDragDropEvent((event) => {
      const payload = event.payload;
      const canvasEl = canvasAreaRef.current;
      if (!canvasEl) return;
      const rect = canvasEl.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;

      const toCss = (pos: { x: number; y: number }) => ({
        x: pos.x / dpr,
        y: pos.y / dpr,
      });

      const inCanvas = (pos: { x: number; y: number }) => {
        const c = toCss(pos);
        return c.x >= rect.left && c.x <= rect.right && c.y >= rect.top && c.y <= rect.bottom;
      };

      if (payload.type === "enter" || payload.type === "over") {
        const css = toCss(payload.position);
        const inside = inCanvas(payload.position);
        setIsDroppingOnCanvas(inside);
        setFileDragPos(inside ? {
          x: Math.max(rect.left, Math.min(rect.right, css.x)),
          y: Math.max(rect.top, Math.min(rect.bottom, css.y)),
        } : null);
      } else if (payload.type === "leave") {
        setIsDroppingOnCanvas(false);
        setFileDragPos(null);
      } else if (payload.type === "drop") {
        setIsDroppingOnCanvas(false);
        setFileDragPos(null);
        if (inCanvas(payload.position)) {
          const css = toCss(payload.position);
          const pos = canvasRef.current?.screenToNormalized(css.x, css.y) ?? undefined;
          const paths = (payload.paths as string[]).filter((p) => IMAGE_EXT.test(p));
          for (const path of paths) void addImageFromPathRef.current(path, pos);
        }
      }
    });

    return () => { void unlistenPromise.then((fn) => fn()); };
  }, []);

  // Keep refs fresh every render
  addImageFromPathRef.current = addImageFromPath;
  deleteSelectedLayersRef.current = deleteSelectedLayers;
  copySelectedLayersRef.current = copySelectedLayers;
  pasteLayersRef.current = pasteLayers;
  toolActionsRef.current = {
    text: (pos) => addTextLayer(pos),
    rect: (pos) => addShapeLayer("rect", pos),
    ellipse: (pos) => addShapeLayer("ellipse", pos),
    line: (pos) => addShapeLayer("line", pos),
    arrow: (pos) => addShapeLayer("arrow", pos),
    image: () => void handleImportImage(),
    emoji: () => setShowEmojiPicker(true),
  };

  function clampToCanvas(x: number, y: number) {
    const rect = canvasAreaRef.current?.getBoundingClientRect();
    if (!rect) return { x, y };
    return {
      x: Math.max(rect.left, Math.min(rect.right, x)),
      y: Math.max(rect.top, Math.min(rect.bottom, y)),
    };
  }

  function handleToolPointerDown(toolId: string, toolLabel: string, e: React.PointerEvent) {
    const startX = e.clientX;
    const startY = e.clientY;
    const pointerId = e.pointerId;
    let dragging = false;

    function onMove(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return;
      if (!dragging) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
        dragging = true;
        dragToolRef.current = toolId;
        const c = clampToCanvas(ev.clientX, ev.clientY);
        setDragVisual({ label: toolLabel, x: c.x, y: c.y });
      } else {
        const c = clampToCanvas(ev.clientX, ev.clientY);
        setDragVisual((v) => v ? { ...v, x: c.x, y: c.y } : null);
      }
    }

    function onUp(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (!dragging) return;
      dragToolRef.current = null;
      setDragVisual(null);
      const rect = canvasAreaRef.current?.getBoundingClientRect();
      if (rect && ev.clientX >= rect.left && ev.clientX <= rect.right &&
          ev.clientY >= rect.top && ev.clientY <= rect.bottom) {
        const pos = canvasRef.current?.screenToNormalized(ev.clientX, ev.clientY) ?? undefined;
        toolActionsRef.current[toolId]?.(pos);
      }
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  const selectedLayer = project?.layers.find((l) => l.id === selectedId) ?? null;

  function updateLayer(id: string, changes: LayerChanges) {
    setIsDirty(true);
    // Capture snapshot before the first change in this drag/edit session
    if (preChangeRef.current === null && project !== null) {
      preChangeRef.current = project;
    }
    // Update canvas immediately without pushing to history
    setProjectSilent((p) =>
      p ? { ...p, layers: p.layers.map((l) => l.id === id ? ({ ...l, ...changes } as Layer) : l) } : p
    );
    // Commit the pre-change snapshot to history 600 ms after the last update
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      if (preChangeRef.current !== null) {
        pushSnapshot(preChangeRef.current);
        preChangeRef.current = null;
      }
    }, 600);
  }

  function reorderLayer(fromIndex: number, toIndex: number) {
    setProject((p) => {
      if (!p) return p;
      const layers = [...p.layers];
      const [moved] = layers.splice(fromIndex, 1);
      layers.splice(toIndex, 0, moved);
      return { ...p, layers };
    });
    setIsDirty(true);
  }

  function deleteLayer(id: string) {
    setProject((p) =>
      p ? { ...p, layers: p.layers.filter((l) => l.id !== id) } : p
    );
    setSelectedIds((prev) => prev.filter((sid) => sid !== id));
    setIsDirty(true);
  }

  function toggleLayerVisible(id: string) {
    setProject((p) =>
      p ? { ...p, layers: p.layers.map((l) => l.id === id ? { ...l, visible: !l.visible } : l) } : p
    );
    setIsDirty(true);
  }

  function batchSetVisible(ids: string[], visible: boolean) {
    setProject((p) =>
      p ? { ...p, layers: p.layers.map((l) => ids.includes(l.id) ? { ...l, visible } : l) } : p
    );
    setIsDirty(true);
  }

  function batchReorder(ids: string[], overId: string) {
    setProject((p) => {
      if (!p) return p;
      const layers = p.layers;
      const selected = layers.filter((l) => ids.includes(l.id));
      const remaining = layers.filter((l) => !ids.includes(l.id));
      const overIdx = remaining.findIndex((l) => l.id === overId);
      if (overIdx === -1) return p;
      // Determine direction: if selected group's average index is below the target,
      // we're moving up the stack → insert after; otherwise insert before.
      const avgOrigIdx = ids.reduce((sum, id) => sum + layers.findIndex((l) => l.id === id), 0) / ids.length;
      const overOrigIdx = layers.findIndex((l) => l.id === overId);
      const insertIdx = avgOrigIdx < overOrigIdx ? overIdx + 1 : overIdx;
      return { ...p, layers: [...remaining.slice(0, insertIdx), ...selected, ...remaining.slice(insertIdx)] };
    });
    setIsDirty(true);
  }

  function changeLayerBlendMode(id: string, blendMode: BlendMode) {
    updateLayer(id, { blendMode });
  }

  function changeLayerColor(id: string, color: string) {
    updateLayer(id, { color });
  }

  function updateGlobalAdjustments(adj: ColorAdjustments) {
    setProject((p) => (p ? { ...p, globalAdjustments: adj } : p));
    setIsDirty(true);
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
    resetProject({
      version: 2,
      canvasWidth: width,
      canvasHeight: height,
      layers: [background],
      globalAdjustments: { ...DEFAULT_COLOR_ADJUSTMENTS },
    });
    setSelectedIds([]);
    setFilePath(null);
    setIsDirty(false);
    setShowNewCanvasDialog(false);
  }

  async function addImageFromPath(path: string, pos?: { x: number; y: number }) {
    if (!project) return;
    const texture = await Assets.load(convertFileSrc(path));
    const id = crypto.randomUUID();
    const maxW = project.canvasWidth * 0.8;
    const maxH = project.canvasHeight * 0.8;
    const scale = Math.min(1, maxW / texture.width, maxH / texture.height);
    const normW = (texture.width * scale) / project.canvasWidth;
    const normH = (texture.height * scale) / project.canvasHeight;
    const layer: Layer = {
      id,
      type: "image",
      name: basename(path),
      visible: true,
      blendMode: "normal",
      src: path,
      x: pos?.x ?? 0,
      y: pos?.y ?? 0,
      width: normW,
      height: normH,
      rotation: 0,
    };
    setProject((p) => (p ? { ...p, layers: [...p.layers, layer] } : p));
    setSelectedIds([id]);
  }


  async function handleImportImage() {
    if (!project) return;
    const path = await pickImagePath();
    if (path) await addImageFromPath(path);
  }

  async function handleEmojiPick(_emoji: string, twemojiUrl: string) {
    setShowEmojiPicker(false);
    const path = await invoke<string>("download_image_to_temp", { url: twemojiUrl });
    await addImageFromPath(path);
  }

  function addLayer(layer: Layer) {
    setProject((p) => (p ? { ...p, layers: [...p.layers, layer] } : p));
    setSelectedIds([layer.id]);
    setIsDirty(true);
  }

  function addTextLayer(pos?: { x: number; y: number }) {
    if (!project) return;
    addLayer({
      id: crypto.randomUUID(),
      type: "text",
      name: "Text",
      visible: true,
      blendMode: "normal",
      text: "Your text",
      x: pos?.x ?? 0,
      y: pos?.y ?? 0,
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

  function addShapeLayer(shapeKind: ShapeKind, pos?: { x: number; y: number }) {
    if (!project) return;
    const base = {
      id: crypto.randomUUID(),
      type: "shape" as const,
      name: shapeKind.charAt(0).toUpperCase() + shapeKind.slice(1),
      visible: true,
      blendMode: "normal" as const,
      strokeWidth: 4,
    };
    if (shapeKind === "line" || shapeKind === "arrow") {
      const cx = pos?.x ?? 0;
      const cy = pos?.y ?? 0;
      const half = 150 / project.canvasWidth;
      addLayer({
        ...base,
        shapeKind,
        x1: cx - half,
        y1: cy,
        x2: cx + half,
        y2: cy,
        strokeColor: "#000000",
      });
    } else {
      const normW = 300 / project.canvasWidth;
      const normH = 200 / project.canvasHeight;
      addLayer({
        ...base,
        shapeKind,
        x: pos?.x ?? 0,
        y: pos?.y ?? 0,
        width: normW,
        height: normH,
        rotation: 0,
        fill: "#4f9eff",
        strokeColor: "#000000",
      });
    }
  }

  async function handleExport(format: "png" | "jpeg", quality: number) {
    setShowExportDialog(false);
    if (!canvasRef.current) return;
    const ext = format === "jpeg" ? "jpg" : "png";
    const path = await save({
      filters: [{ name: "Image", extensions: [ext] }],
      defaultPath: `thumbnail.${ext}`,
    });
    if (!path) return;
    const dataUrl = await canvasRef.current.exportImage(format, quality);
    await invoke("save_image_file", { dataUrl, path });
  }

  async function handleSave() {
    if (!project) return;
    if (filePath) {
      await saveProject(project, filePath);
      setIsDirty(false);
      setRecentFiles(addRecentFile(filePath, projectDisplayName(filePath)));
    } else {
      const path = await saveProjectAs(project);
      if (path) {
        setFilePath(path);
        setIsDirty(false);
        setRecentFiles(addRecentFile(path, projectDisplayName(path)));
      }
    }
  }


  async function handleOpen() {
    const result = await openProject();
    if (result) {
      resetProject(result.project);
      setFilePath(result.path);
      setSelectedIds([]);
      setIsDirty(false);
      setRecentFiles(addRecentFile(result.path, projectDisplayName(result.path)));
    }
  }

  async function handleOpenRecent(path: string) {
    const result = await openProjectFromPath(path);
    if (result) {
      resetProject(result.project);
      setFilePath(result.path);
      setSelectedIds([]);
      setIsDirty(false);
      setRecentFiles(addRecentFile(result.path, projectDisplayName(result.path)));
    } else {
      setRecentFiles(removeRecentFile(path));
    }
  }

  function deleteSelectedLayers() {
    if (selectedIds.length === 0) return;
    setProject((p) =>
      p ? { ...p, layers: p.layers.filter((l) => !selectedIds.includes(l.id)) } : p
    );
    setSelectedIds([]);
    setIsDirty(true);
  }

  function deselectAll() {
    setSelectedIds([]);
  }

  function onMarqueeSelect(rect: { x1: number; y1: number; x2: number; y2: number }) {
    if (!project) return;
    const ids = project.layers
      .filter((l) => {
        if (l.type === "fill") return false;
        if (l.type === "shape" && (l.shapeKind === "line" || l.shapeKind === "arrow")) {
          const inR = (x: number, y: number) => x >= rect.x1 && x <= rect.x2 && y >= rect.y1 && y <= rect.y2;
          return inR(l.x1 ?? 0, l.y1 ?? 0) || inR(l.x2 ?? 0, l.y2 ?? 0);
        }
        if (l.type === "text") {
          return l.x >= rect.x1 && l.x <= rect.x2 && l.y >= rect.y1 && l.y <= rect.y2;
        }
        const x = l.x ?? 0, y = l.y ?? 0, w = l.width ?? 0, h = l.height ?? 0;
        return (x - w / 2) < rect.x2 && (x + w / 2) > rect.x1 && (y - h / 2) < rect.y2 && (y + h / 2) > rect.y1;
      })
      .map((l) => l.id);
    if (ids.length > 0) setSelectedIds(ids);
  }

  function copySelectedLayers() {
    if (!project || selectedIds.length === 0) return;
    clipboardRef.current = project.layers.filter(
      (l) => selectedIds.includes(l.id) && l.type !== "fill"
    );
  }

  function pasteLayers() {
    const toPaste = clipboardRef.current;
    if (!toPaste.length) return;
    const OFFSET = 0.03;
    const newLayers: Layer[] = toPaste.map((l) => {
      const id = crypto.randomUUID();
      if (l.type === "shape" && (l.shapeKind === "line" || l.shapeKind === "arrow")) {
        return { ...l, id, x1: (l.x1 ?? 0) + OFFSET, y1: (l.y1 ?? 0) + OFFSET, x2: (l.x2 ?? 0) + OFFSET, y2: (l.y2 ?? 0) + OFFSET };
      }
      if (l.type === "image" || l.type === "text" || l.type === "shape") {
        return { ...l, id, x: (l.x ?? 0) + OFFSET, y: (l.y ?? 0) + OFFSET };
      }
      return { ...l, id };
    });
    clipboardRef.current = newLayers;
    setProject((p) => (p ? { ...p, layers: [...p.layers, ...newLayers] } : p));
    setSelectedIds(newLayers.map((l) => l.id));
    setIsDirty(true);
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isTyping =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      if (!isTyping && (e.key === "Backspace" || e.key === "Delete") && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        deleteSelectedLayersRef.current();
        return;
      }

      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;

      // Block browser/webview shortcuts that would wipe app state
      if (["r", "R", "F5", "w", "W", "f", "F", "p", "P", "u", "U"].includes(e.key)) {
        e.preventDefault();
        return;
      }

      if (e.key === "a" || e.key === "A") {
        if (!isTyping && project) {
          e.preventDefault();
          setSelectedIds(project.layers.filter((l) => l.type !== "fill").map((l) => l.id));
        }
        return;
      }

      if (e.key === "n") {
        e.preventDefault();
        setShowNewCanvasDialog(true);
      } else if (e.key === "o") {
        e.preventDefault();
        void handleOpen();
      } else if (e.key === "s") {
        e.preventDefault();
        void handleSave();
      } else if (e.key === "t") {
        e.preventDefault();
        addTextLayer();
      } else if (e.key === "b") {
        e.preventDefault();
        setShowBrowser((v) => !v);
      } else if (e.key === "e") {
        e.preventDefault();
        if (project) setShowExportDialog(true);
      } else if (e.key === "c") {
        if (!isTyping) { e.preventDefault(); copySelectedLayersRef.current(); }
      } else if (e.key === "x") {
        if (!isTyping) { e.preventDefault(); copySelectedLayersRef.current(); deleteSelectedLayersRef.current(); }
      } else if (e.key === "v") {
        if (!isTyping) { e.preventDefault(); pasteLayersRef.current(); }
      } else if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (e.key === "y" || (e.key === "z" && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, filePath]);

  const projectName = filePath ? projectDisplayName(filePath) : project ? "Untitled Project" : "";
  const title = isDirty && project ? `${projectName} | edited` : projectName;

  return (
    <main className="app">
      <MenuBar
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

              { label: "", separator: true, onClick: () => {} },
              ...(recentFiles.length > 0
                ? recentFiles.map((f) => ({
                    label: f.name,
                    onClick: () => void handleOpenRecent(f.path),
                  }))
                : [{ label: "No recent files", disabled: true, onClick: () => {} }]),
              { label: "", separator: true, onClick: () => {} },
              {
                label: "Save Project",
                shortcut: "Ctrl+S",
                onClick: () => void handleSave(),
                disabled: !project,
              },
              {
                label: "Export Image...",
                shortcut: "Ctrl+E",
                onClick: () => setShowExportDialog(true),
                disabled: !project,
              },
              { label: "Exit", onClick: () => void getCurrentWindow().close() },
            ],
          },
          {
            label: "Edit",
            items: [
              { label: "Undo", shortcut: "Ctrl+Z", onClick: undo, disabled: !canUndo },
              { label: "Redo", shortcut: "Ctrl+Y", onClick: redo, disabled: !canRedo },
              {
                label: "Delete Layer",
                onClick: deleteSelectedLayers,
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
            label: "View",
            items: [
              {
                label: showBrowser ? "Hide Browser" : "Show Browser",
                shortcut: "Ctrl+B",
                onClick: () => setShowBrowser((v) => !v),
              },
            ],
          },
          {
            label: "Settings",
            items: [
              {
                label: "Keyboard Shortcuts...",
                onClick: () => setShowShortcuts(true),
              },
            ],
          },
        ]}
      />
      {project && (
        <ToolBar
          activeTab={activeLeftTab}
          onTabChange={(id) => setActiveLeftTab(id as "layers" | "effects")}
          tabs={[
            { id: "layers", label: "Layers", icon: null },
            { id: "effects", label: "Tools", icon: null },
          ]}
          title={title}
        />
      )}
      {project ? (
        <div className="main-area">
        <div className="workspace">
          <aside className="layers-panel" onClick={(e) => { if (!(e.target as HTMLElement).closest(".layer-row")) setSelectedIds([]); }}>
            {activeLeftTab === "layers" ? (
              <LayersPanel
                layers={project.layers}
                selectedIds={selectedIds}
                onSelect={(id) => {
                  selectionAnchorId.current = id;
                  setSelectedIds(id ? [id] : []);
                }}
                onCtrlSelect={(id) => {
                  selectionAnchorId.current = id;
                  setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
                }}
                onRangeSelect={(id) => {
                  const layers = project.layers;
                  const anchorIdx = selectionAnchorId.current ? layers.findIndex((l) => l.id === selectionAnchorId.current) : -1;
                  const targetIdx = layers.findIndex((l) => l.id === id);
                  if (anchorIdx === -1) { setSelectedIds([id]); selectionAnchorId.current = id; return; }
                  const [start, end] = anchorIdx < targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx];
                  setSelectedIds(layers.slice(start, end + 1).map((l) => l.id));
                }}
                onReorder={reorderLayer}
                onBatchReorder={batchReorder}
                onToggleVisible={toggleLayerVisible}
                onBatchSetVisible={batchSetVisible}
                onDelete={(id) => {
                  if (selectedIds.includes(id) && selectedIds.length > 1) deleteSelectedLayers();
                  else deleteLayer(id);
                }}
                onBlendModeChange={changeLayerBlendMode}
                onColorChange={changeLayerColor}
                onRename={(id, name) => updateLayer(id, { name })}
              />
            ) : (
              <EffectsPanel
                onAddText={addTextLayer}
                onAddShape={addShapeLayer}
                onImportImage={() => void handleImportImage()}
                onOpenEmoji={() => setShowEmojiPicker(true)}
                onToolPointerDown={handleToolPointerDown}
              />
            )}
          </aside>
          <div
            className={`canvas-area${isDroppingOnCanvas ? " canvas-area-drop-target" : ""}`}
            ref={canvasAreaRef}
          >
            <PixiCanvas
              ref={canvasRef}
              canvasWidth={project.canvasWidth}
              canvasHeight={project.canvasHeight}
              layers={project.layers}
              selectedId={selectedId}
              globalAdjustments={project.globalAdjustments}
              onSelect={(id) => { selectionAnchorId.current = id; setSelectedIds(id ? [id] : []); }}
              onShiftSelect={(id) => { setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]); }}
              onLayerChange={updateLayer}
              onMarqueeSelect={onMarqueeSelect}
            />
          </div>
          <aside className="properties-panel">
            <PropertiesPanel
              layer={selectedLayer}
              selectedCount={selectedIds.length}
              fonts={fonts}
              canvasWidth={project.canvasWidth}
              canvasHeight={project.canvasHeight}
              globalAdjustments={project.globalAdjustments}
              onChange={updateLayer}
              onGlobalChange={updateGlobalAdjustments}
            />
          </aside>
        </div>

        {showBrowser && (
          <>
            <div
              className="browser-resize-handle"
              onMouseDown={(e) => {
                e.preventDefault();
                isResizingBrowser.current = true;
                const startY = e.clientY;
                const startH = browserHeight;
                const onMove = (ev: MouseEvent) => {
                  if (!isResizingBrowser.current) return;
                  const delta = startY - ev.clientY;
                  setBrowserHeight(Math.max(120, Math.min(700, startH + delta)));
                };
                const onUp = () => {
                  isResizingBrowser.current = false;
                  window.removeEventListener("mousemove", onMove);
                  window.removeEventListener("mouseup", onUp);
                };
                window.addEventListener("mousemove", onMove);
                window.addEventListener("mouseup", onUp);
              }}
            />
            <div className="browser-panel-wrap" style={{ height: browserHeight }}>
              <BrowserPanel
                onImport={(path) => void addImageFromPath(path)}
              />
            </div>
          </>
        )}
        </div>
      ) : (
        <WelcomeScreen
          recentFiles={recentFiles}
          onNewCanvas={() => setShowNewCanvasDialog(true)}
          onOpen={() => void handleOpen()}
          onOpenRecent={(path) => void handleOpenRecent(path)}
        />
      )}
      {showNewCanvasDialog && (
        <NewCanvasDialog
          onCreate={handleNewCanvas}
          onCancel={() => setShowNewCanvasDialog(false)}
        />
      )}
      {showExportDialog && project && (
        <ExportDialog
          canvasWidth={project.canvasWidth}
          canvasHeight={project.canvasHeight}
          onExport={(fmt, q) => void handleExport(fmt, q)}
          onCancel={() => setShowExportDialog(false)}
        />
      )}
      {showEmojiPicker && (
        <EmojiPicker
          onPick={(emoji, url) => void handleEmojiPick(emoji, url)}
          onCancel={() => setShowEmojiPicker(false)}
        />
      )}
      {showShortcuts && (
        <ShortcutsDialog onClose={() => setShowShortcuts(false)} />
      )}
      {dragVisual && (
        <div className="drag-ghost" style={{ left: dragVisual.x + 14, top: dragVisual.y - 14 }}>
          {dragVisual.label}
        </div>
      )}
      {fileDragPos && (
        <div className="drag-ghost" style={{ left: fileDragPos.x + 14, top: fileDragPos.y - 14 }}>
          Image
        </div>
      )}
    </main>
  );
}

export default App;
