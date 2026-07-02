import type { ShapeKind } from "../types/project";
import "./EffectsPanel.css";

interface EffectsPanelProps {
  disabled: boolean;
  onAddText: () => void;
  onAddShape: (kind: ShapeKind) => void;
  onImportImage: () => void;
  onOpenEmoji: () => void;
}

interface EffectItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}

interface EffectGroup {
  label: string;
  items: EffectItem[];
}

export function EffectsPanel({ disabled, onAddText, onAddShape, onImportImage, onOpenEmoji }: EffectsPanelProps) {
  const groups: EffectGroup[] = [
    {
      label: "Text",
      items: [
        {
          id: "text",
          label: "Text",
          icon: (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 7 4 4 20 4 20 7"/>
              <line x1="9" y1="20" x2="15" y2="20"/>
              <line x1="12" y1="4" x2="12" y2="20"/>
            </svg>
          ),
          onClick: onAddText,
        },
      ],
    },
    {
      label: "Shapes",
      items: [
        {
          id: "rect",
          label: "Rectangle",
          icon: (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="5" width="18" height="14" rx="1"/>
            </svg>
          ),
          onClick: () => onAddShape("rect"),
        },
        {
          id: "ellipse",
          label: "Ellipse",
          icon: (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <ellipse cx="12" cy="12" rx="10" ry="7"/>
            </svg>
          ),
          onClick: () => onAddShape("ellipse"),
        },
        {
          id: "line",
          label: "Line",
          icon: (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" y1="20" x2="20" y2="4"/>
            </svg>
          ),
          onClick: () => onAddShape("line"),
        },
        {
          id: "arrow",
          label: "Arrow",
          icon: (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="19" x2="19" y2="5"/>
              <polyline points="9 5 19 5 19 15"/>
            </svg>
          ),
          onClick: () => onAddShape("arrow"),
        },
      ],
    },
    {
      label: "Media",
      items: [
        {
          id: "image",
          label: "Image",
          icon: (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
          ),
          onClick: onImportImage,
        },
        {
          id: "emoji",
          label: "Emoji",
          icon: (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
              <line x1="9" y1="9" x2="9.01" y2="9"/>
              <line x1="15" y1="9" x2="15.01" y2="9"/>
            </svg>
          ),
          onClick: onOpenEmoji,
        },
      ],
    },
  ];

  return (
    <div className="effects-panel">
      {groups.map((group) => (
        <div key={group.label} className="effects-group">
          <div className="effects-group-header">{group.label}</div>
          <div className="effects-group-items">
            {group.items.map((item) => (
              <button
                key={item.id}
                className="effects-item"
                disabled={disabled}
                onClick={item.onClick}
                title={item.label}
              >
                <span className="effects-item-icon">{item.icon}</span>
                <span className="effects-item-label">{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
