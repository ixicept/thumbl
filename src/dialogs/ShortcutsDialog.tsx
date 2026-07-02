import "./ShortcutsDialog.css";

const SHORTCUTS = [
  { group: "File", rows: [
    { action: "New Canvas",    keys: ["Ctrl", "N"] },
    { action: "Open Project",  keys: ["Ctrl", "O"] },
    { action: "Save",          keys: ["Ctrl", "S"] },
    { action: "Export Image",  keys: ["Ctrl", "E"] },
  ]},
  { group: "Edit", rows: [
    { action: "Undo",          keys: ["Ctrl", "Z"] },
    { action: "Redo",          keys: ["Ctrl", "Y"] },
    { action: "Delete Layer",  keys: ["Del"] },
  ]},
  { group: "Insert", rows: [
    { action: "Text",          keys: ["Ctrl", "T"] },
  ]},
  { group: "View", rows: [
    { action: "Toggle Browser", keys: ["Ctrl", "B"] },
  ]},
];

interface ShortcutsDialogProps {
  onClose: () => void;
}

export function ShortcutsDialog({ onClose }: ShortcutsDialogProps) {
  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="shortcuts-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="shortcuts-dialog-header">
          <span className="shortcuts-dialog-title">Keyboard Shortcuts</span>
          <button className="shortcuts-dialog-close" onClick={onClose}>✕</button>
        </div>
        <div className="shortcuts-dialog-body">
          {SHORTCUTS.map((group) => (
            <div key={group.group} className="shortcuts-group">
              <div className="shortcuts-group-label">{group.group}</div>
              {group.rows.map((row) => (
                <div key={row.action} className="shortcuts-row">
                  <span className="shortcuts-action">{row.action}</span>
                  <span className="shortcuts-keys">
                    {row.keys.map((k, i) => (
                      <span key={i}>
                        <kbd>{k}</kbd>
                        {i < row.keys.length - 1 && <span className="shortcuts-plus">+</span>}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
