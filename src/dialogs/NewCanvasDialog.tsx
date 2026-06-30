import { useState } from "react";
import "./NewCanvasDialog.css";

const PRESETS = [
  { name: "YouTube Thumbnail", width: 1280, height: 720 },
  { name: "Full HD", width: 1920, height: 1080 },
  { name: "Square", width: 1080, height: 1080 },
  { name: "Instagram Post", width: 1080, height: 1350 },
];

interface NewCanvasDialogProps {
  onCreate: (width: number, height: number) => void;
  onCancel: () => void;
}

export function NewCanvasDialog({ onCreate, onCancel }: NewCanvasDialogProps) {
  const [width, setWidth] = useState(1280);
  const [height, setHeight] = useState(720);

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>New Canvas</h2>

        <div className="preset-grid">
          {PRESETS.map((preset) => (
            <button
              key={preset.name}
              className="preset-button"
              onClick={() => {
                setWidth(preset.width);
                setHeight(preset.height);
              }}
            >
              <span className="preset-name">{preset.name}</span>
              <span className="preset-size">
                {preset.width} × {preset.height}
              </span>
            </button>
          ))}
        </div>

        <div className="custom-size">
          <label>
            Width
            <input
              type="number"
              min={1}
              value={width}
              onChange={(e) => setWidth(Number(e.target.value))}
            />
          </label>
          <label>
            Height
            <input
              type="number"
              min={1}
              value={height}
              onChange={(e) => setHeight(Number(e.target.value))}
            />
          </label>
        </div>

        <div className="dialog-actions">
          <button onClick={onCancel}>Cancel</button>
          <button
            className="primary"
            onClick={() => onCreate(width, height)}
            disabled={width < 1 || height < 1}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
