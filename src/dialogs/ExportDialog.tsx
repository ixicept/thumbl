import { useState } from "react";
import "./NewCanvasDialog.css";
import "./ExportDialog.css";

interface ExportDialogProps {
  canvasWidth: number;
  canvasHeight: number;
  onExport: (format: "png" | "jpeg", quality: number) => void;
  onCancel: () => void;
}

export function ExportDialog({ canvasWidth, canvasHeight, onExport, onCancel }: ExportDialogProps) {
  const [format, setFormat] = useState<"png" | "jpeg">("png");
  const [quality, setQuality] = useState(92);

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Export Image</h2>

        <p className="export-canvas-size">
          {canvasWidth} × {canvasHeight} px
        </p>

        <div className="export-format-row">
          {(["png", "jpeg"] as const).map((f) => (
            <button
              key={f}
              className={`export-format-btn${format === f ? " active" : ""}`}
              onClick={() => setFormat(f)}
            >
              {f.toUpperCase()}
            </button>
          ))}
        </div>

        {format === "jpeg" && (
          <div className="export-quality-row">
            <span className="export-quality-label">Quality</span>
            <input
              type="range"
              min={10}
              max={100}
              value={quality}
              onChange={(e) => setQuality(Number(e.target.value))}
              className="export-quality-slider"
            />
            <span className="export-quality-value">{quality}%</span>
          </div>
        )}

        <div className="dialog-actions">
          <button onClick={onCancel}>Cancel</button>
          <button
            className="primary"
            onClick={() => onExport(format, quality / 100)}
          >
            Export…
          </button>
        </div>
      </div>
    </div>
  );
}
