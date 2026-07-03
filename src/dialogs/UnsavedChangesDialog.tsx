import "./NewCanvasDialog.css";

interface UnsavedChangesDialogProps {
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

export function UnsavedChangesDialog({ onSave, onDiscard, onCancel }: UnsavedChangesDialogProps) {
  return (
    <div className="dialog-overlay">
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Unsaved Changes</h2>
        <p style={{ fontSize: "0.85em", color: "#ccc", margin: "0 0 1.25em 0" }}>
          You have unsaved changes. What would you like to do?
        </p>
        <div className="dialog-actions">
          <button onClick={onCancel}>Cancel</button>
          <button onClick={onDiscard}>Discard</button>
          <button className="primary" onClick={onSave}>Save</button>
        </div>
      </div>
    </div>
  );
}
