import { useEffect, useRef, useState } from "react";
import "./MenuBar.css";

export interface MenuItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  shortcut?: string;
}

interface MenuBarProps {
  title: string;
  menus: { label: string; items: MenuItem[] }[];
}

export function MenuBar({ title, menus }: MenuBarProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="menu-bar" ref={rootRef}>
      {title && <span className="menu-bar-title">{title}</span>}
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
              {menu.items.map((item) => (
                <button
                  key={item.label}
                  className="menu-item"
                  disabled={item.disabled}
                  onClick={() => {
                    setOpenMenu(null);
                    item.onClick();
                  }}
                >
                  <span>{item.label}</span>
                  {item.shortcut && (
                    <span className="menu-item-shortcut">{item.shortcut}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
