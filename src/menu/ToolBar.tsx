import type React from "react";
import "./ToolBar.css";

export interface Tab {
  id: string;
  label: string;
  icon: React.ReactNode;
}

interface ToolBarProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (id: string) => void;
}

export function ToolBar({ tabs, activeTab, onTabChange }: ToolBarProps) {
  return (
    <div className="tool-bar">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`tool-bar-tab${activeTab === tab.id ? " tool-bar-tab-active" : ""}`}
          onClick={() => onTabChange(tab.id)}
        >
          {tab.icon && <span className="tool-bar-tab-icon">{tab.icon}</span>}
          <span className="tool-bar-tab-label">{tab.label}</span>
        </button>
      ))}
    </div>
  );
}
