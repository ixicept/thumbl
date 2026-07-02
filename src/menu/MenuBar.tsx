import React, { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./MenuBar.css";

export interface MenuItem {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  shortcut?: string;
  separator?: boolean;
}

interface MenuBarProps {
  menus: { label: string; items: MenuItem[] }[];
}

export function MenuBar({ menus }: MenuBarProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const win = getCurrentWindow();

  useEffect(() => {
    void win.isMaximized().then(setIsMaximized);
    const unlisten = win.onResized(() => {
      void win.isMaximized().then(setIsMaximized);
    });
    return () => { void unlisten.then((f) => f()); };
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleMouseDown(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest("button, input, select, textarea")) return;
    if (e.button !== 0) return;
    void win.startDragging();
  }

  function handleDoubleClick(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest("button, input, select, textarea")) return;
    void win.toggleMaximize();
  }

  return (
    <div
      className="menu-bar"
      ref={rootRef}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
    >
      <span className="menu-bar-app-name">thumbl</span>

      <div className="menu-bar-menus">
        {menus.map((menu) => (
          <div key={menu.label} className="menu-root">
            <button
              className={`menu-label${openMenu === menu.label ? " menu-label-active" : ""}`}
              onClick={() =>
                setOpenMenu((current) => (current === menu.label ? null : menu.label))
              }
            >
              {menu.label}
            </button>
            {openMenu === menu.label && (
              <div className="menu-dropdown">
                {menu.items.map((item, i) =>
                  item.separator ? (
                    <hr key={i} className="menu-separator" />
                  ) : (
                    <button
                      key={item.label}
                      className="menu-item"
                      disabled={item.disabled}
                      onClick={() => {
                        setOpenMenu(null);
                        item.onClick?.();
                      }}
                    >
                      <span>{item.label}</span>
                      {item.shortcut && (
                        <span className="menu-item-shortcut">{item.shortcut}</span>
                      )}
                    </button>
                  )
                )}
              </div>
            )}
          </div>
        ))}
      </div>


      <div className="menu-bar-window-controls">
        <button className="wc-btn" onClick={() => void win.minimize()} title="Minimize">
          <svg width="10" height="1" viewBox="0 0 10 1"><line x1="0" y1="0.5" x2="10" y2="0.5" stroke="currentColor" strokeWidth="1.2"/></svg>
        </button>
        <button className="wc-btn" onClick={() => void win.toggleMaximize()} title={isMaximized ? "Restore" : "Maximize"}>
          {isMaximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1">
              <rect x="2" y="0" width="8" height="8"/>
              <polyline points="0,2 0,10 8,10"/>
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1">
              <rect x="0" y="0" width="10" height="10"/>
            </svg>
          )}
        </button>
        <button className="wc-btn wc-btn-close" onClick={() => void win.close()} title="Close">
          <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
            <line x1="0" y1="0" x2="10" y2="10"/><line x1="10" y1="0" x2="0" y2="10"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
